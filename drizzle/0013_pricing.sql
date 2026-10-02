CREATE TABLE "pricing" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"monthly_cents" integer NOT NULL,
	"annual_cents" integer NOT NULL,
	"agency_cents" integer NOT NULL,
	"agency_min_locations" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by_user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "pricing" ADD CONSTRAINT "pricing_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE pricing ADD CONSTRAINT pricing_single_row CHECK (id = 1);
--> statement-breakpoint
-- Starting prices (US dollars): $39.99/month, $399/year, agencies $29.99 per location, 5 minimum.
INSERT INTO pricing (id, monthly_cents, annual_cents, agency_cents, agency_min_locations) VALUES (1, 3999, 39900, 2999, 5);
--> statement-breakpoint
GRANT SELECT ON pricing TO app_user;
--> statement-breakpoint
CREATE FUNCTION admin_set_pricing(p_monthly int, p_annual int, p_agency int, p_min int, p_reason text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE v_old pricing%ROWTYPE;
BEGIN
  IF NOT app_is_platform_admin() THEN RAISE EXCEPTION 'not a platform admin' USING ERRCODE = '42501'; END IF;
  IF length(trim(coalesce(p_reason, ''))) < 5 THEN RAISE EXCEPTION 'reason required' USING ERRCODE = '22023'; END IF;
  IF p_monthly < 100 OR p_monthly > 100000 THEN RAISE EXCEPTION 'monthly price must be between $1 and $1,000' USING ERRCODE = '22023'; END IF;
  IF p_annual < p_monthly OR p_annual > p_monthly * 12 THEN RAISE EXCEPTION 'annual price must be between 1 and 12 monthly payments' USING ERRCODE = '22023'; END IF;
  IF p_agency < 100 OR p_agency > p_monthly THEN RAISE EXCEPTION 'agency price must be between $1 and the monthly price' USING ERRCODE = '22023'; END IF;
  IF p_min < 1 OR p_min > 100 THEN RAISE EXCEPTION 'agency minimum must be 1-100 locations' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_old FROM pricing WHERE id = 1 FOR UPDATE;
  UPDATE pricing SET monthly_cents = p_monthly, annual_cents = p_annual, agency_cents = p_agency, agency_min_locations = p_min,
    updated_at = now(), updated_by_user_id = app_current_user_id() WHERE id = 1;
  INSERT INTO admin_audit_log (id, admin_user_id, action, target_org_id, reason, details)
    VALUES (gen_random_uuid(), app_current_user_id(), 'pricing.changed', NULL, left(trim(p_reason), 300),
      jsonb_build_object(
        'from', jsonb_build_object('monthly', v_old.monthly_cents, 'annual', v_old.annual_cents, 'agency', v_old.agency_cents, 'agency_min', v_old.agency_min_locations),
        'to', jsonb_build_object('monthly', p_monthly, 'annual', p_annual, 'agency', p_agency, 'agency_min', p_min)));
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION admin_set_pricing(int, int, int, int, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION admin_set_pricing(int, int, int, int, text) TO app_user;
