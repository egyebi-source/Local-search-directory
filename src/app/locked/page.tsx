import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PlanPicker } from "@/components/billing/plan-picker";
import { t } from "@/lib/i18n/en";
import { getPricing, monthsFree, usd } from "@/server/billing/pricing";
import { billingEnabled } from "@/server/billing/stripe";
import { withOrg } from "@/server/db/tenant";
import { currentOrganization, orgAccess, requireUser } from "@/server/org/current";
import { signOutAction } from "../(app)/app/actions";

// Shown instead of the dashboard once a trial ends unpaid. Reveals nothing
// about the org's data — only the lock message.
export default async function LockedPage() {
  const user = await requireUser();
  const { current } = await currentOrganization(user);
  // No organization yet: finish sign-up from saved answers if there are any.
  if (!current) redirect("/onboarding/complete");
  const access = await withOrg(user.id, current.id, (tx) => orgAccess(tx, current.id));
  if (access.kind !== "locked") redirect("/app");
  const p = await getPricing();
  const canPay = current.role === "owner" && billingEnabled();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-3 text-center">
        <h1 className="text-2xl font-semibold">{t.trial.lockedTitle}</h1>
        <p>{t.trial.lockedBody}</p>
        {canPay ? (
          <div className="text-left">
            <PlanPicker monthly={usd(p.monthlyCents)} annual={usd(p.annualCents)} annualNote={`${monthsFree(p)} months free`} />
          </div>
        ) : (
          <p className="text-sm opacity-80">{current.role === "owner" ? t.trial.billingSoon : t.trial.lockedMember}</p>
        )}
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            {t.common.signOut}
          </Button>
        </form>
      </Card>
    </main>
  );
}
