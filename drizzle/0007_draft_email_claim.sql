ALTER TABLE "assessment_drafts" ADD COLUMN "email_hash" text;--> statement-breakpoint
ALTER TABLE "assessment_drafts" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "assessment_drafts_email_hash_idx" ON "assessment_drafts" USING btree ("email_hash","claimed_at");--> statement-breakpoint
-- The app may tag a draft with an email (and nothing else): no other UPDATE.
GRANT UPDATE (email_hash, claimed_at) ON assessment_drafts TO app_user;
