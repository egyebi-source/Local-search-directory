CREATE TYPE "public"."agency_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TABLE "agencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan_status" "plan_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone DEFAULT now() + interval '14 days' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_connect_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_by_user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agency_locations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agency_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"created_by_agency" boolean NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" text
);
--> statement-breakpoint
CREATE TABLE "agency_members" (
	"agency_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "agency_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agency_members_agency_id_user_id_pk" PRIMARY KEY("agency_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "agency_connect_codes" ADD CONSTRAINT "agency_connect_codes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_connect_codes" ADD CONSTRAINT "agency_connect_codes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_locations" ADD CONSTRAINT "agency_locations_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_locations" ADD CONSTRAINT "agency_locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agency_members" ADD CONSTRAINT "agency_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agency_connect_codes_hash_idx" ON "agency_connect_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "agency_connect_codes_org_idx" ON "agency_connect_codes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "agency_locations_agency_idx" ON "agency_locations" USING btree ("agency_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agency_locations_one_active_idx" ON "agency_locations" USING btree ("org_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "agency_members_user_idx" ON "agency_members" USING btree ("user_id");--> statement-breakpoint
-- Agencies (PRD Module 11). The app role can read what the rules below
-- allow and nothing else; every change goes through an agency_* function
-- that checks who is asking.
CREATE FUNCTION app_my_agency_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT agency_id FROM agency_members WHERE user_id = app_current_user_id() $$;
--> statement-breakpoint
CREATE FUNCTION app_agency_role(p_agency uuid) RETURNS agency_role
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT role FROM agency_members WHERE agency_id = p_agency AND user_id = app_current_user_id() $$;
--> statement-breakpoint
CREATE FUNCTION agency_has_access(p_agency uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM agencies a WHERE a.id = p_agency
    AND (a.plan_status IN ('active', 'past_due') OR (a.plan_status = 'trialing' AND a.trial_ends_at > now()))) $$;
--> statement-breakpoint
-- A location has access if its own plan allows it, or its agency's does.
CREATE FUNCTION org_has_access(p_org uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org
      AND (o.plan_status IN ('active', 'past_due') OR (o.plan_status = 'trialing' AND o.trial_ends_at > now())))
    OR EXISTS (SELECT 1 FROM agency_locations l WHERE l.org_id = p_org AND l.ended_at IS NULL AND agency_has_access(l.agency_id)) $$;
--> statement-breakpoint
-- The agency through which the signed-in user may open a location, if any:
-- they're on that agency's team, the link is active, and the agency's own
-- plan is in good standing.
CREATE FUNCTION agency_can_open(p_org uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT l.agency_id FROM agency_locations l
    JOIN agency_members m ON m.agency_id = l.agency_id AND m.user_id = app_current_user_id()
    WHERE l.org_id = p_org AND l.ended_at IS NULL AND agency_has_access(l.agency_id)
    LIMIT 1 $$;
--> statement-breakpoint
ALTER TABLE agencies ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agencies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_locations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_locations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_connect_codes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agency_connect_codes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Links: the agency's team sees its own; a location sees the link to itself.
CREATE POLICY agency_locations_select ON agency_locations FOR SELECT
  USING (agency_id IN (SELECT app_my_agency_ids()) OR org_id = app_current_org_id());
--> statement-breakpoint
-- Agencies: the team sees its agency; a location sees the agency managing it (name and plan only matter).
CREATE POLICY agencies_select ON agencies FOR SELECT
  USING (id IN (SELECT app_my_agency_ids())
    OR id IN (SELECT l.agency_id FROM agency_locations l WHERE l.org_id = app_current_org_id() AND l.ended_at IS NULL));
--> statement-breakpoint
CREATE POLICY agency_members_select ON agency_members FOR SELECT
  USING (agency_id IN (SELECT app_my_agency_ids()));
--> statement-breakpoint
CREATE POLICY agency_connect_codes_tenant ON agency_connect_codes FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT ON agencies, agency_members, agency_locations TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT ON agency_connect_codes TO app_user;
--> statement-breakpoint
CREATE FUNCTION agency_create(p_name text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_id uuid := gen_random_uuid(); v_name text := trim(coalesce(p_name, ''));
BEGIN
  IF app_current_user_id() IS NULL THEN RAISE EXCEPTION 'not signed in' USING ERRCODE = '42501'; END IF;
  IF length(v_name) < 2 OR length(v_name) > 80 THEN RAISE EXCEPTION 'invalid name' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM agency_members WHERE user_id = app_current_user_id() AND role = 'owner') >= 3 THEN
    RAISE EXCEPTION 'agency limit' USING ERRCODE = '22023';
  END IF;
  INSERT INTO agencies (id, name) VALUES (v_id, v_name);
  INSERT INTO agency_members (agency_id, user_id, role) VALUES (v_id, app_current_user_id(), 'owner');
  RETURN v_id;
END $$;
--> statement-breakpoint
-- The agency sets up a new location for a client. The location is its own
-- organization; it has no trial of its own and is covered by the agency.
CREATE FUNCTION agency_add_location(p_agency uuid, p_name text, p_website text, p_area text, p_category text, p_country country)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_org uuid := gen_random_uuid();
BEGIN
  IF app_agency_role(p_agency) IS NULL THEN RAISE EXCEPTION 'not on this agency' USING ERRCODE = '42501'; END IF;
  IF NOT agency_has_access(p_agency) THEN RAISE EXCEPTION 'agency locked' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(p_name, ''))) NOT BETWEEN 2 AND 120 OR length(coalesce(p_website, '')) > 253
     OR length(coalesce(p_area, '')) > 120 OR length(coalesce(p_category, '')) > 80 THEN
    RAISE EXCEPTION 'invalid location' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM agency_locations WHERE agency_id = p_agency AND ended_at IS NULL)
     >= (CASE WHEN (SELECT plan_status FROM agencies WHERE id = p_agency) = 'trialing' THEN 10 ELSE 200 END) THEN
    -- Each location costs us daily data checks; a free trial covers up to 10.
    RAISE EXCEPTION 'location limit' USING ERRCODE = '22023';
  END IF;
  INSERT INTO organizations (id, name, website_domain, service_area, category, country, countries, trial_ends_at)
    VALUES (v_org, trim(p_name), nullif(p_website, ''), nullif(p_area, ''), nullif(p_category, ''), p_country, ARRAY[p_country], now());
  INSERT INTO agency_locations (id, agency_id, org_id, created_by_agency) VALUES (gen_random_uuid(), p_agency, v_org, true);
  INSERT INTO audit_log (id, org_id, actor_user_id, action, metadata_json)
    VALUES (gen_random_uuid(), v_org, app_current_user_id(), 'agency.location_created', jsonb_build_object('agency_id', p_agency));
  RETURN v_org;
END $$;
--> statement-breakpoint
-- The agency connects an existing account with a code its owner gave them.
-- Returns NULL for a wrong, used or expired code, or a location already managed.
CREATE FUNCTION agency_connect(p_agency uuid, p_code_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_code agency_connect_codes%ROWTYPE;
BEGIN
  IF app_agency_role(p_agency) IS NULL THEN RAISE EXCEPTION 'not on this agency' USING ERRCODE = '42501'; END IF;
  IF NOT agency_has_access(p_agency) THEN RAISE EXCEPTION 'agency locked' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_code FROM agency_connect_codes
    WHERE code_hash = p_code_hash AND used_at IS NULL AND expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM agency_locations WHERE org_id = v_code.org_id AND ended_at IS NULL) THEN RETURN NULL; END IF;
  IF (SELECT count(*) FROM agency_locations WHERE agency_id = p_agency AND ended_at IS NULL)
     >= (CASE WHEN (SELECT plan_status FROM agencies WHERE id = p_agency) = 'trialing' THEN 10 ELSE 200 END) THEN
    RAISE EXCEPTION 'location limit' USING ERRCODE = '22023';
  END IF;
  UPDATE agency_connect_codes SET used_at = now() WHERE id = v_code.id;
  INSERT INTO agency_locations (id, agency_id, org_id, created_by_agency) VALUES (gen_random_uuid(), p_agency, v_code.org_id, false);
  INSERT INTO audit_log (id, org_id, actor_user_id, action, metadata_json)
    VALUES (gen_random_uuid(), v_code.org_id, app_current_user_id(), 'agency.connected', jsonb_build_object('agency_id', p_agency));
  RETURN v_code.org_id;
END $$;
--> statement-breakpoint
-- The agency's owner stops managing a location. A location the agency set
-- up that nobody else has joined is locked and scheduled for deletion.
CREATE FUNCTION agency_end_location(p_agency uuid, p_org uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app_agency_role(p_agency) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'agency owners only' USING ERRCODE = '42501'; END IF;
  UPDATE agency_locations SET ended_at = now(), ended_by = 'agency'
    WHERE agency_id = p_agency AND org_id = p_org AND ended_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO audit_log (id, org_id, actor_user_id, action, metadata_json)
    VALUES (gen_random_uuid(), p_org, app_current_user_id(), 'agency.ended_by_agency', jsonb_build_object('agency_id', p_agency));
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = p_org) THEN
    UPDATE organizations SET plan_status = 'locked', locked_at = coalesce(locked_at, now()),
      delete_after = coalesce(delete_after, now() + interval '30 days') WHERE id = p_org;
  END IF;
  RETURN true;
END $$;
--> statement-breakpoint
-- A location's owner removes the agency's access to the current organization.
CREATE FUNCTION org_end_agency() RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_agency uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = app_current_org_id() AND user_id = app_current_user_id() AND role = 'owner') THEN
    RAISE EXCEPTION 'owners only' USING ERRCODE = '42501';
  END IF;
  UPDATE agency_locations SET ended_at = now(), ended_by = 'location'
    WHERE org_id = app_current_org_id() AND ended_at IS NULL RETURNING agency_id INTO v_agency;
  IF v_agency IS NULL THEN RETURN false; END IF;
  INSERT INTO audit_log (id, org_id, actor_user_id, action, metadata_json)
    VALUES (gen_random_uuid(), app_current_org_id(), app_current_user_id(), 'agency.ended_by_location', jsonb_build_object('agency_id', v_agency));
  RETURN true;
END $$;
--> statement-breakpoint
-- The agency's location list (names and websites only; numbers are read per
-- location through the normal row-level-secured path).
CREATE FUNCTION agency_locations_for(p_agency uuid)
  RETURNS TABLE (org_id uuid, name text, website_domain text, service_area text, created_by_agency boolean, started_at timestamptz, owners int)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  IF app_agency_role(p_agency) IS NULL THEN RAISE EXCEPTION 'not on this agency' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
    SELECT o.id, o.name, o.website_domain, o.service_area, l.created_by_agency, l.started_at,
      (SELECT count(*)::int FROM memberships m WHERE m.org_id = o.id AND m.role = 'owner')
    FROM agency_locations l JOIN organizations o ON o.id = l.org_id
    WHERE l.agency_id = p_agency AND l.ended_at IS NULL
    ORDER BY o.name;
END $$;
--> statement-breakpoint
-- Background jobs: a location covered by its agency keeps being checked.
CREATE OR REPLACE FUNCTION orgs_due_for_rank_checks(p_limit int)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.id FROM organizations o
    WHERE org_has_access(o.id)
      AND EXISTS (
        SELECT 1 FROM tracked_searches t
        WHERE t.org_id = o.id AND t.active
          AND NOT EXISTS (
            SELECT 1 FROM rank_checks r
            WHERE r.tracked_search_id = t.id AND r.day = (now() AT TIME ZONE 'UTC')::date))
    ORDER BY o.id
    LIMIT p_limit
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION orgs_due_for_digest(p_limit int)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.id FROM organizations o
    WHERE org_has_access(o.id)
      AND (SELECT count(DISTINCT r.day) FROM rank_checks r WHERE r.org_id = o.id) >= 2
      AND NOT EXISTS (SELECT 1 FROM digest_sends d WHERE d.org_id = o.id AND d.week = date_trunc('week', now() AT TIME ZONE 'UTC')::date)
    ORDER BY o.id LIMIT p_limit
  $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION orgs_due_for_seo_snapshot(p_limit int)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.id FROM organizations o
    WHERE org_has_access(o.id)
      AND o.website_domain IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM seo_snapshots s WHERE s.org_id = o.id AND s.taken_on > (now() AT TIME ZONE 'UTC')::date - 7)
    ORDER BY o.id LIMIT p_limit
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_my_agency_ids(), app_agency_role(uuid), agency_has_access(uuid), org_has_access(uuid), agency_can_open(uuid),
  agency_create(text), agency_add_location(uuid, text, text, text, text, country), agency_connect(uuid, text),
  agency_end_location(uuid, uuid), org_end_agency(), agency_locations_for(uuid) FROM PUBLIC;
--> statement-breakpoint
-- agency_has_access and org_has_access are used only inside these functions and the job functions; the app can't call them.
GRANT EXECUTE ON FUNCTION app_my_agency_ids(), app_agency_role(uuid), agency_can_open(uuid),
  agency_create(text), agency_add_location(uuid, text, text, text, text, country), agency_connect(uuid, text),
  agency_end_location(uuid, uuid), org_end_agency(), agency_locations_for(uuid) TO app_user;
