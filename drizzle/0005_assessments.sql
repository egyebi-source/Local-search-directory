CREATE TYPE "public"."country" AS ENUM('CA', 'US');--> statement-breakpoint
CREATE TABLE "api_spend_daily" (
	"day" date NOT NULL,
	"provider" text NOT NULL,
	"micros" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "api_spend_daily_day_provider_pk" PRIMARY KEY("day","provider")
);
--> statement-breakpoint
CREATE TABLE "org_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"result_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"domain" text NOT NULL,
	"country" "country" NOT NULL,
	"result_json" jsonb NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "country" "country";--> statement-breakpoint
ALTER TABLE "org_assessments" ADD CONSTRAINT "org_assessments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_assessments_org_id_idx" ON "org_assessments" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "public_snapshots_cache_key_idx" ON "public_snapshots" USING btree ("cache_key","created_at");--> statement-breakpoint
ALTER TABLE org_assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE org_assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_assessments_tenant ON org_assessments FOR ALL
  USING (org_id = app_current_org_id())
  WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON org_assessments TO app_user;
--> statement-breakpoint
-- Snapshots are written once and only read by their unguessable id.
GRANT SELECT, INSERT, DELETE ON public_snapshots TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON api_spend_daily TO app_user;
--> statement-breakpoint
GRANT INSERT (country) ON organizations TO app_user;
--> statement-breakpoint
GRANT UPDATE (country) ON organizations TO app_user;
