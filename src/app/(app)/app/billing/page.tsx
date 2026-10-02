import { eq } from "drizzle-orm";
import { ManageBillingButton, PlanPicker } from "@/components/billing/plan-picker";
import { accessState } from "@/server/billing/access";
import { getPricing, monthsFree, usd } from "@/server/billing/pricing";
import { billingEnabled } from "@/server/billing/stripe";
import { organizations } from "@/server/db/schema";
import { withCurrentOrg } from "@/server/org/current";

const fmt = (d: Date) => d.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" });

export default async function BillingPage({ searchParams }: PageProps<"/app/billing">) {
  const { done } = await searchParams;
  const { org, role } = await withCurrentOrg(async (tx, ctx) => ({
    org: (await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId)))[0],
    role: ctx.role,
  }));
  const p = await getPricing();
  const state = accessState(org);
  const subscribed = Boolean(org.stripeSubscriptionId) && (org.planStatus === "active" || org.planStatus === "past_due");
  const free = monthsFree(p);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Billing</h1>
      {done && !subscribed ? (
        <p role="status" className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-900 dark:bg-green-950 dark:text-green-100">
          Thanks! We&apos;re confirming your payment with Stripe; this page updates within a minute.
        </p>
      ) : null}

      <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h2 className="font-semibold">Your plan</h2>
        <p className="mt-1 text-slate-700 dark:text-slate-300">
          {subscribed
            ? `${org.billingInterval === "year" ? "Annual" : "Monthly"} plan${org.currentPeriodEnd ? `, renews ${fmt(org.currentPeriodEnd)}` : ""}.`
            : state.kind === "trialing"
              ? `Free trial: ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} left (ends ${fmt(org.trialEndsAt)}).`
              : "No active plan."}
        </p>
        {org.planStatus === "past_due" ? (
          <p className="mt-2 text-sm text-red-700 dark:text-red-400">Your last payment didn&apos;t go through. Update your card to keep your dashboard.</p>
        ) : null}
      </section>

      {role !== "owner" ? (
        <p className="text-slate-600 dark:text-slate-400">Only an owner of this business can manage billing.</p>
      ) : !billingEnabled() ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Card payments aren&apos;t switched on yet on this site. Prices: {usd(p.monthlyCents)}/month or {usd(p.annualCents)}/year (USD).
        </p>
      ) : subscribed ? (
        <ManageBillingButton />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold">Choose a plan</h2>
          {state.kind === "trialing" ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">You won&apos;t be charged until your free trial ends on {fmt(org.trialEndsAt)}.</p>
          ) : null}
          <PlanPicker monthly={usd(p.monthlyCents)} annual={usd(p.annualCents)} annualNote={free > 0 ? `${free} months free` : "Billed yearly"} />
        </section>
      )}
    </div>
  );
}
