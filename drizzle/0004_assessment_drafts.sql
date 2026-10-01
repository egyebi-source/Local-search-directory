CREATE TABLE "assessment_drafts" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"answers" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assessment_drafts_expires_at_idx" ON "assessment_drafts" USING btree ("expires_at");--> statement-breakpoint
-- No UPDATE: a draft is written once, read once, then deleted.
GRANT SELECT, INSERT, DELETE ON assessment_drafts TO app_user;
