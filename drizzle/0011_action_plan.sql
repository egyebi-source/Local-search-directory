CREATE TYPE "public"."action_kind" AS ENUM('review_request', 'review_reply', 'gbp_profile', 'gbp_post', 'page_title', 'new_page');--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('open', 'done', 'dismissed');--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "action_kind" NOT NULL,
	"title" text NOT NULL,
	"why" text NOT NULL,
	"content" text NOT NULL,
	"keyword" text,
	"value_usd_month" integer,
	"status" "action_status" DEFAULT 'open' NOT NULL,
	"source" text NOT NULL,
	"change_id" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_change_id_site_changes_id_fk" FOREIGN KEY ("change_id") REFERENCES "public"."site_changes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_items_org_status_idx" ON "action_items" USING btree ("org_id","status");--> statement-breakpoint
ALTER TABLE action_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE action_items FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY action_items_tenant ON action_items FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON action_items TO app_user;
--> statement-breakpoint
-- The app may only change an item's status, never rewrite its content.
GRANT UPDATE (status, done_at, change_id) ON action_items TO app_user;
