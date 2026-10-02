CREATE TABLE "rank_checks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"tracked_search_id" uuid NOT NULL,
	"day" date NOT NULL,
	"map_rank" integer,
	"organic_rank" integer,
	"rating" real,
	"reviews" integer,
	"leader_avg_rating" real,
	"leader_avg_reviews" integer,
	"source" text NOT NULL,
	"data_source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"made_on" date NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_searches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"country" "country" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_checks" ADD CONSTRAINT "rank_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_checks" ADD CONSTRAINT "rank_checks_tracked_search_id_tracked_searches_id_fk" FOREIGN KEY ("tracked_search_id") REFERENCES "public"."tracked_searches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_changes" ADD CONSTRAINT "site_changes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_searches" ADD CONSTRAINT "tracked_searches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_checks_search_day_idx" ON "rank_checks" USING btree ("tracked_search_id","day");--> statement-breakpoint
CREATE INDEX "rank_checks_org_day_idx" ON "rank_checks" USING btree ("org_id","day");--> statement-breakpoint
CREATE INDEX "site_changes_org_idx" ON "site_changes" USING btree ("org_id","made_on");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_searches_org_keyword_idx" ON "tracked_searches" USING btree ("org_id","keyword","country");--> statement-breakpoint
ALTER TABLE tracked_searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tracked_searches FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tracked_searches_tenant ON tracked_searches FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
ALTER TABLE rank_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rank_checks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rank_checks_tenant ON rank_checks FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
ALTER TABLE site_changes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE site_changes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY site_changes_tenant ON site_changes FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON tracked_searches TO app_user;
--> statement-breakpoint
GRANT UPDATE (active) ON tracked_searches TO app_user;
--> statement-breakpoint
-- Append-only: history (and the baseline) can't be rewritten by the app.
GRANT SELECT, INSERT ON rank_checks TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON site_changes TO app_user;
--> statement-breakpoint
-- The daily job runs without a signed-in user. This returns only the ids of
-- orgs that may be checked today (access not expired, something to check,
-- not yet checked today) and nothing else.
CREATE FUNCTION orgs_due_for_rank_checks(p_limit int)
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT o.id FROM organizations o
    WHERE (o.plan_status IN ('active', 'past_due') OR (o.plan_status = 'trialing' AND o.trial_ends_at > now()))
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
REVOKE ALL ON FUNCTION orgs_due_for_rank_checks(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION orgs_due_for_rank_checks(int) TO app_user;
