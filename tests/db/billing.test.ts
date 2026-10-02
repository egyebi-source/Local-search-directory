import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/stripe/webhook/route";
import { BillingForbiddenError, handleWebhook, startCheckout, type BillingGateway } from "@/server/billing/stripe";
import { getDb } from "@/server/db/client";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

const SECRET = "whsec_testsecret1234567890";
let seq = 0;

function event(type: string, object: Record<string, unknown>, createdOffset = 0) {
  seq++;
  return JSON.stringify({ id: `evt_test_${Date.now()}_${seq}`, type, created: Math.floor(Date.now() / 1000) + createdOffset, data: { object } });
}
const sign = (payload: string, secret = SECRET, timestamp?: number) =>
  Stripe.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });

function fakeGateway() {
  const calls: Stripe.Checkout.SessionCreateParams[] = [];
  const gateway: BillingGateway = {
    createCheckout: async (p) => (calls.push(p), { url: "https://checkout.stripe.com/c/test" }),
    createPortal: async () => ({ url: "https://billing.stripe.com/p/test" }),
  };
  return { gateway, calls };
}

describe.runIf(hasDb)("card billing", () => {
  let owner: { id: string; email: string };
  let member: { id: string };
  let orgId: string;
  const org = async () => (await asOwner((c) => c.query("SELECT * FROM organizations WHERE id = $1", [orgId]))).rows[0];

  beforeAll(async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
    await asOwner((c) => c.query("INSERT INTO billing_secrets (id, webhook_secret) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET webhook_secret = $1", [SECRET]));
    owner = await createUser("payer");
    member = await createUser("payer-member");
    orgId = await createOrganization(owner.id, { name: "Acme Collision" });
    await asOwner((c) => c.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'member')", [orgId, member.id]));
  });
  beforeEach(() =>
    asOwner((c) =>
      c.query(
        "UPDATE organizations SET plan_status = 'trialing', trial_ends_at = now() + interval '7 days', stripe_customer_id = NULL, stripe_subscription_id = NULL, billing_event_at = NULL, locked_at = NULL, delete_after = NULL WHERE id = $1",
        [orgId],
      ),
    ),
  );
  afterAll(() => vi.unstubAllEnvs());

  it("checkout uses the admin-set price, and the first charge waits for the trial to end", async () => {
    const { gateway, calls } = fakeGateway();
    const url = await withOrg(owner.id, orgId, (tx, ctx) => startCheckout(tx, ctx, owner, "annual", gateway));
    expect(url).toBe("https://checkout.stripe.com/c/test");
    const p = calls[0];
    expect(p.client_reference_id).toBe(orgId);
    expect(p.line_items?.[0].price_data).toMatchObject({ currency: "usd", unit_amount: 39900, recurring: { interval: "year" } });
    expect(p.subscription_data?.metadata).toEqual({ org_id: orgId });
    expect(p.subscription_data?.trial_end).toBeGreaterThan(Date.now() / 1000 + 6 * 86400);
    expect(p.customer_email).toBe(owner.email);
  });

  it("only owners can start checkout", async () => {
    const { gateway, calls } = fakeGateway();
    await expect(withOrg(member.id, orgId, (tx, ctx) => startCheckout(tx, ctx, { email: "m@x.test" }, "monthly", gateway))).rejects.toBeInstanceOf(BillingForbiddenError);
    expect(calls).toHaveLength(0);
  });

  it("a signed checkout + subscription event activates the account, once", async () => {
    const done = event("checkout.session.completed", { mode: "subscription", client_reference_id: orgId, customer: "cus_1", subscription: "sub_1" });
    expect(await handleWebhook(done, sign(done))).toBe("applied");
    expect(await handleWebhook(done, sign(done))).toBe("duplicate");
    const sub = event("customer.subscription.updated", {
      id: "sub_1", customer: "cus_1", status: "active", metadata: { org_id: orgId },
      items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400, price: { recurring: { interval: "month" } } }] },
    }, 1);
    expect(await handleWebhook(sub, sign(sub))).toBe("applied");
    expect(await org()).toMatchObject({ plan_status: "active", stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", billing_interval: "month" });
  });

  it("forged, tampered, expired or unsigned events change nothing", async () => {
    const body = event("checkout.session.completed", { mode: "subscription", client_reference_id: orgId, customer: "cus_x", subscription: "sub_x" });
    expect(await handleWebhook(body, sign(body, "whsec_wrongsecret"))).toBe("bad_signature");
    expect(await handleWebhook(body.replace("cus_x", "cus_y"), sign(body))).toBe("bad_signature");
    expect(await handleWebhook(body, sign(body, SECRET, Math.floor(Date.now() / 1000) - 600))).toBe("bad_signature");
    expect(await handleWebhook(body, null)).toBe("bad_signature");
    expect((await org()).plan_status).toBe("trialing");
  });

  it("the app can't mark itself paid: no direct access to the billing internals", async () => {
    await expectDbError(
      getDb().execute(sql`SELECT billing_apply('evt_x', 't', now(), ${orgId}::uuid, 'c', 's', 'active', 'month', now())`),
      /permission denied/,
    );
    await expectDbError(getDb().execute(sql`SELECT * FROM billing_secrets`), /permission denied/);
    await expectDbError(withOrg(owner.id, orgId, (tx) => tx.execute(sql`UPDATE organizations SET plan_status = 'active'`)), /permission denied/);
  });

  it("failed payment → past due; cancelled → locked with deletion scheduled in 30 days", async () => {
    const start = event("checkout.session.completed", { mode: "subscription", client_reference_id: orgId, customer: "cus_2", subscription: "sub_2" });
    await handleWebhook(start, sign(start));
    const late = event("customer.subscription.updated", { id: "sub_2", customer: "cus_2", status: "past_due", metadata: { org_id: orgId } }, 1);
    expect(await handleWebhook(late, sign(late))).toBe("applied");
    expect((await org()).plan_status).toBe("past_due");
    const gone = event("customer.subscription.deleted", { id: "sub_2", customer: "cus_2", status: "canceled", metadata: { org_id: orgId } }, 2);
    expect(await handleWebhook(gone, sign(gone))).toBe("applied");
    const o = await org();
    expect(o.plan_status).toBe("locked");
    expect((new Date(o.delete_after).getTime() - Date.now()) / 86_400_000).toBeCloseTo(30, 0);
  });

  it("out-of-order and old-subscription events can't undo a newer state", async () => {
    const start = event("checkout.session.completed", { mode: "subscription", client_reference_id: orgId, customer: "cus_3", subscription: "sub_new" }, 10);
    await handleWebhook(start, sign(start));
    const older = event("customer.subscription.updated", { id: "sub_new", customer: "cus_3", status: "past_due", metadata: { org_id: orgId } }, 0);
    expect(await handleWebhook(older, sign(older))).toBe("stale");
    const oldSub = event("customer.subscription.deleted", { id: "sub_old", customer: "cus_3", status: "canceled", metadata: { org_id: orgId } }, 20);
    expect(await handleWebhook(oldSub, sign(oldSub))).toBe("old_subscription");
    expect((await org()).plan_status).toBe("active");
  });

  it("the webhook endpoint rejects bad signatures before touching the database", async () => {
    const body = event("checkout.session.completed", { mode: "subscription", client_reference_id: orgId });
    const res = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": "t=1,v1=bad" } }));
    expect(res.status).toBe(400);
    const ok = await POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", body, headers: { "stripe-signature": sign(body) } }));
    expect(ok.status).toBe(200);
  });
});
