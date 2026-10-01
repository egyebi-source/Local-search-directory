-- Billing state is not the app's to change (PRD Module 10).
-- The runtime role may write only the descriptive organization columns;
-- trial_ends_at, plan_status, locked_at and delete_after keep their
-- database defaults and can only be changed by the owner role (migrations,
-- and later the Stripe webhook / lifecycle functions). A bug or injection
-- in app code therefore can't extend a trial or mark an org as paid.
REVOKE INSERT, UPDATE ON organizations FROM app_user;
--> statement-breakpoint
GRANT INSERT (id, name, website_domain, service_area, category, primary_goal, ad_spend_range, website_manager)
  ON organizations TO app_user;
--> statement-breakpoint
GRANT UPDATE (name, website_domain, service_area, category, primary_goal, ad_spend_range, website_manager)
  ON organizations TO app_user;
