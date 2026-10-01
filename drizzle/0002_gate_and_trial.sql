CREATE TYPE "public"."ad_spend_range" AS ENUM('none', 'under_500', '500_2000', '2000_5000', 'over_5000');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('trialing', 'active', 'past_due', 'locked');--> statement-breakpoint
CREATE TYPE "public"."primary_goal" AS ENUM('calls', 'form_leads', 'walk_ins', 'lower_ad_spend');--> statement-breakpoint
CREATE TYPE "public"."website_manager" AS ENUM('self', 'agency', 'nobody');--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "primary_goal" "primary_goal";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "ad_spend_range" "ad_spend_range";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "website_manager" "website_manager";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_status" "plan_status" DEFAULT 'trialing' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "delete_after" timestamp with time zone;