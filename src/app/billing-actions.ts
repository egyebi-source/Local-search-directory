"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { BillingForbiddenError, BillingNotConfiguredError, startCheckout, startPortal, stripeGateway } from "@/server/billing/stripe";
import { withCurrentOrg } from "@/server/org/current";
import { consumeRateLimit } from "@/server/security/rate-limit";

export type BillingState = { error?: string };
const planSchema = z.enum(["monthly", "annual"]);

// Usable from the billing page and from the locked screen (allowLocked),
// so an owner whose trial ended can still subscribe.

export async function checkoutAction(_prev: BillingState, form: FormData): Promise<BillingState> {
  const plan = planSchema.safeParse(form.get("plan"));
  if (!plan.success) return { error: "Choose a plan." };
  let url: string;
  try {
    url = await withCurrentOrg(
      async (tx, ctx, user) => {
        if (!(await consumeRateLimit({ name: "checkout:org", limit: 10, windowSeconds: 60 * 60 }, ctx.orgId))) {
          throw new BillingForbiddenError();
        }
        return startCheckout(tx, ctx, user, plan.data, stripeGateway());
      },
      { allowLocked: true },
    );
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) return { error: "Card payments aren't switched on yet. Contact us and we'll unlock your account." };
    if (err instanceof BillingForbiddenError) return { error: "Only an owner of this business can manage billing." };
    console.warn("[billing] checkout failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't open the payment page. Please try again." };
  }
  redirect(url);
}

export async function portalAction(): Promise<BillingState> {
  let url: string;
  try {
    url = await withCurrentOrg((tx, ctx) => startPortal(tx, ctx, stripeGateway()), { allowLocked: true });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) return { error: "Card payments aren't switched on yet." };
    if (err instanceof BillingForbiddenError) return { error: "Only an owner of this business can manage billing." };
    console.warn("[billing] portal failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't open the billing page. Please try again." };
  }
  redirect(url);
}
