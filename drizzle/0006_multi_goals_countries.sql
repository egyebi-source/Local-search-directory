ALTER TABLE "organizations" ADD COLUMN "goals" "primary_goal"[];--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "countries" "country"[];--> statement-breakpoint
GRANT INSERT (goals, countries) ON organizations TO app_user;
--> statement-breakpoint
GRANT UPDATE (goals, countries) ON organizations TO app_user;
