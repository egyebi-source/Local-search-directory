CREATE TABLE "competitor_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"taken_on" date NOT NULL,
	"data_source" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_reports" ADD CONSTRAINT "competitor_reports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_reports_org_idx" ON "competitor_reports" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_org_domain_idx" ON "competitors" USING btree ("org_id","domain");--> statement-breakpoint
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE competitors FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE competitor_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE competitor_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY competitors_tenant ON competitors FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
CREATE POLICY competitor_reports_tenant ON competitor_reports FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON competitors TO app_user;
--> statement-breakpoint
-- Report history is append-only.
GRANT SELECT, INSERT ON competitor_reports TO app_user;
