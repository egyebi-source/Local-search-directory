CREATE TABLE "admin_audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"target_org_id" uuid,
	"reason" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_log_created_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE platform_admins FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY platform_admins_self ON platform_admins FOR SELECT USING (user_id = app_current_user_id());
--> statement-breakpoint
GRANT SELECT ON platform_admins TO app_user;
--> statement-breakpoint
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE admin_audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- No policy and no grant: only the admin_* functions below touch it.
CREATE FUNCTION app_is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = app_current_user_id()) $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_is_platform_admin() FROM PUBLIC;
--> statement-breakpoint
-- Business and operations numbers. Aggregates only, plus the customer list
-- (business name, website, status, owner email). Never Google data.
CREATE FUNCTION admin_overview() RETURNS jsonb
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'assessments_30d', (SELECT count(*) FROM public_snapshots WHERE created_at > now() - interval '30 days'),
    'orgs_total', (SELECT count(*) FROM organizations),
    'orgs_trialing', (SELECT count(*) FROM organizations WHERE plan_status = 'trialing' AND trial_ends_at > now()),
    'orgs_active', (SELECT count(*) FROM organizations WHERE plan_status IN ('active', 'past_due')),
    'orgs_locked', (SELECT count(*) FROM organizations WHERE plan_status = 'locked' OR (plan_status = 'trialing' AND trial_ends_at <= now())),
    'orgs_tracking', (SELECT count(DISTINCT org_id) FROM tracked_searches WHERE active),
    'orgs_logged_change', (SELECT count(DISTINCT org_id) FROM site_changes),
    'checks_today', (SELECT count(*) FROM rank_checks WHERE day = (now() AT TIME ZONE 'UTC')::date),
    'spend_today', (SELECT coalesce(jsonb_object_agg(provider, micros), '{}'::jsonb) FROM api_spend_daily
                    WHERE day = (now() AT TIME ZONE 'UTC')::date),
    'daily', (SELECT coalesce(jsonb_agg(d ORDER BY d->>'day' DESC), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'day', g.day::date,
        'assessments', (SELECT count(*) FROM public_snapshots s WHERE s.created_at::date = g.day::date),
        'signups', (SELECT count(*) FROM organizations o WHERE o.created_at::date = g.day::date),
        'spend_micros', (SELECT coalesce(sum(micros), 0) FROM api_spend_daily a WHERE a.day = g.day::date)) AS d
      FROM generate_series((now() - interval '13 days')::date, now()::date, interval '1 day') AS g(day)) x)
  );
END $$;
--> statement-breakpoint
CREATE FUNCTION admin_customers(p_limit int)
  RETURNS TABLE (id uuid, name text, website_domain text, category text, service_area text, plan_status text,
                 trial_ends_at timestamptz, created_at timestamptz, owner_email text, members int,
                 tracked int, last_check date, changes int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.website_domain, o.category, o.service_area, o.plan_status::text, o.trial_ends_at, o.created_at,
      (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.org_id = o.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1),
      (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id),
      (SELECT count(*)::int FROM tracked_searches t WHERE t.org_id = o.id AND t.active),
      (SELECT max(r.day) FROM rank_checks r WHERE r.org_id = o.id),
      (SELECT count(*)::int FROM site_changes c WHERE c.org_id = o.id)
    FROM organizations o
    ORDER BY o.created_at DESC
    LIMIT least(greatest(p_limit, 1), 500);
END $$;
--> statement-breakpoint
-- Give an org more trial days (also re-opens an expired trial). Audited.
CREATE FUNCTION admin_extend_trial(p_org uuid, p_days int, p_reason text) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  v_old organizations%ROWTYPE;
  v_new timestamptz;
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  IF p_days < 1 OR p_days > 30 THEN RAISE EXCEPTION 'days must be 1-30' USING ERRCODE = '22023'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'reason required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_old FROM organizations WHERE id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no such organization' USING ERRCODE = '22023'; END IF;
  IF v_old.plan_status IN ('active', 'past_due') THEN RAISE EXCEPTION 'organization is on a paid plan' USING ERRCODE = '22023'; END IF;
  v_new := greatest(v_old.trial_ends_at, now()) + make_interval(days => p_days);
  UPDATE organizations SET trial_ends_at = v_new, plan_status = 'trialing', locked_at = NULL, delete_after = NULL WHERE id = p_org;
  INSERT INTO admin_audit_log (id, admin_user_id, action, target_org_id, reason, details)
    VALUES (gen_random_uuid(), app_current_user_id(), 'trial.extended', p_org, left(trim(p_reason), 300),
            jsonb_build_object('days', p_days, 'from', v_old.trial_ends_at, 'to', v_new, 'previous_status', v_old.plan_status));
  RETURN v_new;
END $$;
--> statement-breakpoint
CREATE FUNCTION admin_audit_recent(p_limit int)
  RETURNS TABLE (created_at timestamptz, admin_email text, action text, org_name text, reason text, details jsonb)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT l.created_at, u.email, l.action, o.name, l.reason, l.details
    FROM admin_audit_log l
    LEFT JOIN users u ON u.id = l.admin_user_id
    LEFT JOIN organizations o ON o.id = l.target_org_id
    ORDER BY l.created_at DESC LIMIT least(greatest(p_limit, 1), 200);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_overview() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_customers(int) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_extend_trial(uuid, int, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_audit_recent(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_overview(), admin_customers(int), admin_extend_trial(uuid, int, text), admin_audit_recent(int) TO app_user;
