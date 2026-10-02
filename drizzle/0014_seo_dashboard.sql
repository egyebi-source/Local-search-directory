CREATE TABLE "seo_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"taken_on" date NOT NULL,
	"data_source" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_checks" ADD COLUMN "ai_overview" boolean;--> statement-breakpoint
ALTER TABLE "rank_checks" ADD COLUMN "ai_cited" boolean;--> statement-breakpoint
ALTER TABLE "seo_snapshots" ADD CONSTRAINT "seo_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_snapshots_org_day_idx" ON "seo_snapshots" USING btree ("org_id","taken_on");--> statement-breakpoint
ALTER TABLE seo_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE seo_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY seo_snapshots_tenant ON seo_snapshots FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON seo_snapshots TO app_user;
--> statement-breakpoint
-- Orgs with access whose last dashboard snapshot is a week old (or missing). Ids only.
CREATE FUNCTION orgs_due_for_seo_snapshot(p_limit int)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT o.id FROM organizations o
    WHERE (o.plan_status IN ('active', 'past_due') OR (o.plan_status = 'trialing' AND o.trial_ends_at > now()))
      AND o.website_domain IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM seo_snapshots s WHERE s.org_id = o.id AND s.taken_on > (now() AT TIME ZONE 'UTC')::date - 7)
    ORDER BY o.id LIMIT p_limit
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION orgs_due_for_seo_snapshot(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orgs_due_for_seo_snapshot(int) TO app_user;
