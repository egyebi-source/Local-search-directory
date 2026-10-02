import "server-only";
import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { getDb } from "@/server/db/client";
import { organizations } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";
import { serverEnv } from "@/server/env";
import { appBaseUrl } from "@/server/url";
import { getPricing } from "./pricing";

// Card billing with Stripe Checkout (we never see card numbers) and the
// Stripe customer portal (change card, switch plan, cancel). Prices come
// from the admin-editable pricing table at checkout time, so existing
// subscribers keep the price they signed up at.

export class BillingNotConfiguredError extends Error {}
export class BillingForbiddenError extends Error {}

export type Plan = "monthly" | "annual";

/** What we need from Stripe; swapped for a fake in tests. */
export type BillingGateway = {
  createCheckout(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
  createPortal(params: Stripe.BillingPortal.SessionCreateParams): Promise<{ url: string }>;
};

export function billingEnabled(): boolean {
  const env = serverEnv();
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
}

export function stripeGateway(): BillingGateway {
  const env = serverEnv();
  const key = env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingNotConfiguredError();
  // Never take real money from a preview or local copy.
  if (key.startsWith("sk_live_") && env.VERCEL_ENV !== "production") throw new BillingNotConfiguredError();
  const stripe = new Stripe(key);
  return {
    createCheckout: (p) => stripe.checkout.sessions.create(p),
    createPortal: (p) => stripe.billingPortal.sessions.create(p),
  };
}

const MIN_TRIAL_SECONDS = 48 * 60 * 60; // Stripe needs a trial end at least 2 days out.

/**
 * Checkout for the current org. Owners only. If the free trial still has
 * time left, the first charge happens when the trial ends.
 */
export async function startCheckout(
  tx: Tx,
  ctx: { orgId: string; role: "owner" | "member" },
  user: { email: string },
  plan: Plan,
  gateway: BillingGateway,
  now = new Date(),
): Promise<string> {
  if (ctx.role !== "owner") throw new BillingForbiddenError();
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org) throw new BillingForbiddenError();
  const p = await getPricing();
  const amount = plan === "monthly" ? p.monthlyCents : p.annualCents;
  const trialLeft = Math.floor((org.trialEndsAt.getTime() - now.getTime()) / 1000);
  const base = appBaseUrl();

  const session = await gateway.createCheckout({
    mode: "subscription",
    client_reference_id: ctx.orgId,
    ...(org.stripeCustomerId ? { customer: org.stripeCustomerId } : { customer_email: user.email }),
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: amount,
          recurring: { interval: plan === "monthly" ? "month" : "year" },
          product_data: { name: plan === "monthly" ? "TorqueRank Monthly" : "TorqueRank Annual" },
        },
      },
    ],
    subscription_data: {
      metadata: { org_id: ctx.orgId },
      ...(org.planStatus === "trialing" && trialLeft > MIN_TRIAL_SECONDS ? { trial_end: Math.floor(org.trialEndsAt.getTime() / 1000) } : {}),
    },
    metadata: { org_id: ctx.orgId },
    billing_address_collection: "required",
    allow_promotion_codes: true,
    ...(serverEnv().STRIPE_TAX === "on" ? { automatic_tax: { enabled: true } } : {}),
    success_url: `${base}/app/billing?done=1`,
    cancel_url: `${base}/app/billing`,
  });
  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return session.url;
}

/** Stripe's page to change card, switch plan or cancel. Owners with a subscription only. */
export async function startPortal(tx: Tx, ctx: { orgId: string; role: "owner" | "member" }, gateway: BillingGateway): Promise<string> {
  if (ctx.role !== "owner") throw new BillingForbiddenError();
  const [org] = await tx.select({ customer: organizations.stripeCustomerId }).from(organizations).where(eq(organizations.id, ctx.orgId));
  if (!org?.customer) throw new BillingForbiddenError();
  const portal = await gateway.createPortal({ customer: org.customer, return_url: `${appBaseUrl()}/app/billing` });
  return portal.url;
}

export type WebhookResult = "applied" | "duplicate" | "stale" | "unknown_org" | "old_subscription" | "ignored" | "bad_signature" | "not_configured";

/**
 * Hand the raw webhook body and signature to the database, which checks the
 * signature with its own copy of the secret before changing anything.
 */
export async function handleWebhook(payload: string, signature: string | null): Promise<WebhookResult> {
  if (!signature || payload.length > 512 * 1024) return "bad_signature";
  const r = await getDb().execute<{ result: WebhookResult }>(sql`SELECT billing_webhook(${payload}, ${signature}) AS result`);
  return r.rows[0].result;
}
