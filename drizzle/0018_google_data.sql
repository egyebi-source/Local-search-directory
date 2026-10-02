CREATE TYPE "public"."google_connection_status" AS ENUM('active', 'needs_reauth', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."google_property_type" AS ENUM('gsc', 'ga4');--> statement-breakpoint
CREATE TABLE "ga4_daily" (
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"sessions" integer NOT NULL,
	"users" integer NOT NULL,
	"key_events" real NOT NULL,
	CONSTRAINT "ga4_daily_org_id_date_channel_pk" PRIMARY KEY("org_id","date","channel")
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"connected_by_user_id" uuid,
	"granted_scopes" text[] NOT NULL,
	"refresh_token_ciphertext" text NOT NULL,
	"token_iv" text NOT NULL,
	"token_auth_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"status" "google_connection_status" DEFAULT 'active' NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"sync_started_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_daily" (
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" real NOT NULL,
	"position" real NOT NULL,
	CONSTRAINT "gsc_daily_org_id_date_pk" PRIMARY KEY("org_id","date")
);
--> statement-breakpoint
CREATE TABLE "gsc_query_daily" (
	"org_id" uuid NOT NULL,
	"date" date NOT NULL,
	"query" text NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"position" real NOT NULL,
	CONSTRAINT "gsc_query_daily_org_id_date_query_pk" PRIMARY KEY("org_id","date","query")
);
--> statement-breakpoint
CREATE TABLE "linked_properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"type" "google_property_type" NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"source" "google_property_type" NOT NULL,
	"status" text NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ga4_daily" ADD CONSTRAINT "ga4_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_daily" ADD CONSTRAINT "gsc_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_daily" ADD CONSTRAINT "gsc_query_daily_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_properties" ADD CONSTRAINT "linked_properties_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linked_properties" ADD CONSTRAINT "linked_properties_connection_id_google_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."google_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_org_idx" ON "google_connections" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "linked_properties_org_type_idx" ON "linked_properties" USING btree ("org_id","type");--> statement-breakpoint
CREATE INDEX "sync_runs_org_idx" ON "sync_runs" USING btree ("org_id","started_at");--> statement-breakpoint
-- Row-level security: every Google table belongs to one organization.
ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE google_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE linked_properties ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE linked_properties FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE gsc_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE gsc_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE gsc_query_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE gsc_query_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ga4_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ga4_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY google_connections_tenant ON google_connections FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
CREATE POLICY linked_properties_tenant ON linked_properties FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
CREATE POLICY gsc_daily_tenant ON gsc_daily FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
CREATE POLICY gsc_query_daily_tenant ON gsc_query_daily FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
CREATE POLICY ga4_daily_tenant ON ga4_daily FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
CREATE POLICY sync_runs_tenant ON sync_runs FOR ALL
  USING (org_id = app_current_org_id()) WITH CHECK (org_id = app_current_org_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON google_connections, linked_properties, gsc_daily, gsc_query_daily, ga4_daily TO app_user;
--> statement-breakpoint
-- Sync history is append-only.
GRANT SELECT, INSERT ON sync_runs TO app_user;
--> statement-breakpoint
-- The daily sync claims a few organizations at a time: connected, active,
-- in good standing (own plan or agency), not yet synced today, and not
-- already being synced (15-minute lease). Returns ids only.
CREATE FUNCTION google_claim_orgs_for_sync(p_limit int) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
BEGIN
  RETURN QUERY
    WITH due AS (
      SELECT c.id FROM google_connections c
      WHERE c.status = 'active'
        AND (c.last_synced_at IS NULL OR c.last_synced_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
        AND (c.sync_started_at IS NULL OR c.sync_started_at < now() - interval '15 minutes')
        AND EXISTS (SELECT 1 FROM linked_properties p WHERE p.connection_id = c.id)
        AND org_has_access(c.org_id)
      ORDER BY c.last_synced_at NULLS FIRST
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
    )
    UPDATE google_connections c SET sync_started_at = now() FROM due WHERE c.id = due.id RETURNING c.org_id;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION google_claim_orgs_for_sync(int) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION google_claim_orgs_for_sync(int) TO app_user;
