CREATE TYPE "public"."prospect_status" AS ENUM('new', 'opened', 'claimed');--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"city" text NOT NULL,
	"country" "country" NOT NULL,
	"keyword" text NOT NULL,
	"data_source" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_suppressions" (
	"domain_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"business_name" text NOT NULL,
	"domain" text NOT NULL,
	"report" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"status" "prospect_status" DEFAULT 'new' NOT NULL,
	"opened_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"claimed_org_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_claimed_org_id_organizations_id_fk" FOREIGN KEY ("claimed_org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_token_hash_idx" ON "prospects" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "prospects_campaign_idx" ON "prospects" USING btree ("campaign_id");--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_is_platform_admin() TO app_user;
--> statement-breakpoint
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY campaigns_admin ON campaigns FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
ALTER TABLE prospects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prospects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY prospects_admin ON prospects FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
--> statement-breakpoint
ALTER TABLE prospect_suppressions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE prospect_suppressions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY prospect_suppressions_admin ON prospect_suppressions FOR SELECT USING (app_is_platform_admin());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON campaigns TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON prospects TO app_user;
--> statement-breakpoint
GRANT UPDATE (token_hash, expires_at) ON prospects TO app_user;
--> statement-breakpoint
GRANT SELECT ON prospect_suppressions TO app_user;
--> statement-breakpoint
-- Public claim page: one prospect by its link token, if still valid.
-- Records the first open. Returns nothing for unknown/expired links.
CREATE FUNCTION claim_lookup(p_token_hash text)
  RETURNS TABLE (business_name text, domain text, report jsonb, keyword text, city text, category text, country country, status prospect_status)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
#variable_conflict use_column
BEGIN
  UPDATE prospects SET status = 'opened', opened_at = now()
    WHERE token_hash = p_token_hash AND status = 'new' AND expires_at > now();
  RETURN QUERY
    SELECT p.business_name, p.domain, p.report, c.keyword, c.city, c.category, c.country, p.status
    FROM prospects p JOIN campaigns c ON c.id = p.campaign_id
    WHERE p.token_hash = p_token_hash AND p.expires_at > now();
END $$;
--> statement-breakpoint
-- "Not interested": delete the prospect and remember the domain (hashed)
-- so it is never contacted again.
CREATE FUNCTION claim_opt_out(p_token_hash text, p_domain_hash text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_id uuid;
BEGIN
  DELETE FROM prospects WHERE token_hash = p_token_hash AND status <> 'claimed' RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN false; END IF;
  INSERT INTO prospect_suppressions (domain_hash) VALUES (p_domain_hash) ON CONFLICT DO NOTHING;
  RETURN true;
END $$;
--> statement-breakpoint
-- Mark a prospect claimed by a newly created org (once).
CREATE FUNCTION claim_complete(p_token_hash text, p_org uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  UPDATE prospects SET status = 'claimed', claimed_at = now(), claimed_org_id = p_org
    WHERE token_hash = p_token_hash AND status <> 'claimed' AND expires_at > now();
  RETURN FOUND;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION claim_lookup(text), claim_opt_out(text, text), claim_complete(text, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION claim_lookup(text), claim_opt_out(text, text), claim_complete(text, uuid) TO app_user;
