CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_event_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX organizations_stripe_subscription_idx ON organizations (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stripe_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Apply one verified Stripe event to an organization. The app verifies the
-- webhook signature first; this function adds: once per event id, events
-- older than the last applied one are ignored, and an old subscription
-- can't lock an org that has moved to a new one. Returns what happened.
CREATE FUNCTION billing_apply(
  p_event_id text, p_type text, p_event_at timestamptz, p_org uuid,
  p_customer text, p_subscription text, p_status plan_status, p_interval text, p_period_end timestamptz
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  v_org organizations%ROWTYPE;
BEGIN
  IF p_status = 'trialing' THEN RAISE EXCEPTION 'invalid billing status' USING ERRCODE = '22023'; END IF;
  INSERT INTO stripe_events (id, type) VALUES (p_event_id, p_type) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  SELECT * INTO v_org FROM organizations
    WHERE (p_org IS NOT NULL AND id = p_org)
       OR (p_org IS NULL AND p_subscription IS NOT NULL AND stripe_subscription_id = p_subscription)
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown_org'; END IF;
  IF v_org.billing_event_at IS NOT NULL AND p_event_at < v_org.billing_event_at THEN RETURN 'stale'; END IF;
  IF v_org.stripe_subscription_id IS NOT NULL AND p_subscription IS NOT NULL
     AND v_org.stripe_subscription_id <> p_subscription AND p_status = 'locked' THEN
    RETURN 'old_subscription';
  END IF;

  UPDATE organizations SET
    plan_status = p_status,
    stripe_customer_id = coalesce(p_customer, stripe_customer_id),
    stripe_subscription_id = coalesce(p_subscription, stripe_subscription_id),
    billing_interval = coalesce(p_interval, billing_interval),
    current_period_end = coalesce(p_period_end, current_period_end),
    billing_event_at = p_event_at,
    locked_at = CASE WHEN p_status = 'locked' THEN coalesce(locked_at, now()) ELSE NULL END,
    delete_after = CASE WHEN p_status = 'locked' THEN coalesce(delete_after, now() + interval '30 days') ELSE NULL END
  WHERE id = v_org.id;
  RETURN 'applied';
END $$;
--> statement-breakpoint
-- Internal only: never callable by the app role directly.
REVOKE ALL ON FUNCTION billing_apply(text, text, timestamptz, uuid, text, text, plan_status, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
-- The Stripe webhook signing secret, readable only by the database owner.
-- Set at deploy time from STRIPE_WEBHOOK_SECRET (scripts/migrate.mjs).
CREATE TABLE billing_secrets (id int PRIMARY KEY CHECK (id = 1), webhook_secret text NOT NULL);
--> statement-breakpoint
ALTER TABLE billing_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The only way billing state changes: the raw Stripe webhook body and its
-- Stripe-Signature header. The database itself checks the HMAC signature
-- (and a 5-minute timestamp window) with a secret the app role can't read,
-- so even a bug in app code can't mark an organization as paid.
CREATE FUNCTION billing_webhook(p_payload text, p_signature text) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
DECLARE
  v_secret text;
  v_t text;
  v_expected text;
  v_ok boolean := false;
  v_part text;
  v_event jsonb;
  v_obj jsonb;
  v_type text;
  v_status plan_status;
  v_org uuid;
  v_sub text;
  v_interval text;
  v_period bigint;
BEGIN
  SELECT webhook_secret INTO v_secret FROM billing_secrets WHERE id = 1;
  IF v_secret IS NULL THEN RETURN 'not_configured'; END IF;
  FOREACH v_part IN ARRAY string_to_array(coalesce(p_signature, ''), ',') LOOP
    IF split_part(v_part, '=', 1) = 't' THEN v_t := split_part(v_part, '=', 2); END IF;
  END LOOP;
  IF v_t IS NULL OR v_t !~ '^[0-9]{1,12}$' OR abs(extract(epoch FROM now()) - v_t::bigint) > 300 THEN RETURN 'bad_signature'; END IF;
  v_expected := encode(hmac(v_t || '.' || p_payload, v_secret, 'sha256'), 'hex');
  FOREACH v_part IN ARRAY string_to_array(p_signature, ',') LOOP
    IF split_part(v_part, '=', 1) = 'v1' AND split_part(v_part, '=', 2) = v_expected THEN v_ok := true; END IF;
  END LOOP;
  IF NOT v_ok THEN RETURN 'bad_signature'; END IF;

  v_event := p_payload::jsonb;
  v_type := v_event->>'type';
  v_obj := v_event->'data'->'object';

  IF v_type = 'checkout.session.completed' THEN
    IF v_obj->>'mode' <> 'subscription' OR coalesce(v_obj->>'client_reference_id', '') !~ '^[0-9a-f-]{36}$' THEN RETURN 'ignored'; END IF;
    RETURN billing_apply(v_event->>'id', v_type, to_timestamp((v_event->>'created')::bigint), (v_obj->>'client_reference_id')::uuid,
      v_obj->>'customer', v_obj->>'subscription', 'active', NULL, NULL);
  ELSIF v_type IN ('customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted') THEN
    v_status := CASE
      WHEN v_type = 'customer.subscription.deleted' THEN 'locked'
      WHEN v_obj->>'status' IN ('active', 'trialing') THEN 'active'
      WHEN v_obj->>'status' = 'past_due' THEN 'past_due'
      WHEN v_obj->>'status' IN ('unpaid', 'canceled', 'incomplete_expired', 'paused') THEN 'locked'
      ELSE NULL END;
    IF v_status IS NULL THEN RETURN 'ignored'; END IF;  -- e.g. 'incomplete': wait for the next event
    v_sub := v_obj->>'id';
    v_org := CASE WHEN coalesce(v_obj->'metadata'->>'org_id', '') ~ '^[0-9a-f-]{36}$' THEN (v_obj->'metadata'->>'org_id')::uuid END;
    v_interval := v_obj->'items'->'data'->0->'price'->'recurring'->>'interval';
    v_period := coalesce((v_obj->'items'->'data'->0->>'current_period_end')::bigint, (v_obj->>'current_period_end')::bigint);
    RETURN billing_apply(v_event->>'id', v_type, to_timestamp((v_event->>'created')::bigint), v_org,
      v_obj->>'customer', v_sub, v_status, CASE WHEN v_interval IN ('month', 'year') THEN v_interval END,
      CASE WHEN v_period IS NOT NULL THEN to_timestamp(v_period) END);
  END IF;
  RETURN 'ignored';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION billing_webhook(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing_webhook(text, text) TO app_user;
