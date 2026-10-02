CREATE TABLE "digest_sends" (
	"org_id" uuid NOT NULL,
	"week" date NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_sends_org_id_week_pk" PRIMARY KEY("org_id","week")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_digest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_sends" ADD CONSTRAINT "digest_sends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE digest_sends ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE digest_sends FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY digest_sends_tenant ON digest_sends FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON digest_sends TO app_user;
--> statement-breakpoint
GRANT UPDATE (recipients) ON digest_sends TO app_user;
--> statement-breakpoint
-- Ids of orgs that should get this week's email: access not expired, at
-- least two days of checks, not sent yet this week. Nothing else.
CREATE FUNCTION orgs_due_for_digest(p_limit int)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.id FROM organizations o
    WHERE (o.plan_status IN ('active', 'past_due') OR (o.plan_status = 'trialing' AND o.trial_ends_at > now()))
      AND (SELECT count(DISTINCT r.day) FROM rank_checks r WHERE r.org_id = o.id) >= 2
      AND NOT EXISTS (SELECT 1 FROM digest_sends d WHERE d.org_id = o.id AND d.week = date_trunc('week', now() AT TIME ZONE 'UTC')::date)
    ORDER BY o.id LIMIT p_limit
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orgs_due_for_digest(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orgs_due_for_digest(int) TO app_user;
