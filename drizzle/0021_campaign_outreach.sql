ALTER TABLE "prospects" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "email_source" text;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "analyzed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "prospects" ADD COLUMN "contact_channel" text;--> statement-breakpoint
-- Staff (admins, enforced by the existing RLS policy) may record contact
-- details, the deeper check and the outreach log. Nothing else changes.
GRANT UPDATE (phone, email, email_source, analysis, analyzed_at, contacted_at, contact_channel) ON prospects TO app_user;
--> statement-breakpoint
-- The claim page also shows the top fixes from the deeper check. It never
-- returns contact details or the outreach log.
DROP FUNCTION claim_lookup(text);
--> statement-breakpoint
CREATE FUNCTION claim_lookup(p_token_hash text)
  RETURNS TABLE (business_name text, domain text, report jsonb, keyword text, city text, category text, country country, status prospect_status, fixes jsonb)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
#variable_conflict use_column
BEGIN
  UPDATE prospects SET status = 'opened', opened_at = now()
    WHERE token_hash = p_token_hash AND status = 'new' AND expires_at > now();
  RETURN QUERY
    SELECT p.business_name, p.domain, p.report, c.keyword, c.city, c.category, c.country, p.status, p.analysis -> 'fixes'
    FROM prospects p JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.token_hash = p_token_hash AND p.expires_at > now();
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION claim_lookup(text) TO app_user;
