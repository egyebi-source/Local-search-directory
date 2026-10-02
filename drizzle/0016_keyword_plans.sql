CREATE TABLE "keyword_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"built_on" date NOT NULL,
	"data_source" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keyword_plans" ADD CONSTRAINT "keyword_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "keyword_plans_org_idx" ON "keyword_plans" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE keyword_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE keyword_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY keyword_plans_tenant ON keyword_plans FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON keyword_plans TO app_user;
