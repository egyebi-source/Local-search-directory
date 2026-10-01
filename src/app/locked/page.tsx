import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n/en";
import { withOrg } from "@/server/db/tenant";
import { currentOrganization, orgAccess, requireUser } from "@/server/org/current";
import { signOutAction } from "../(app)/app/actions";

// Shown instead of the dashboard once a trial ends unpaid. Reveals nothing
// about the org's data — only the lock message.
export default async function LockedPage() {
  const user = await requireUser();
  const { current } = await currentOrganization(user);
  if (!current) redirect("/onboarding");
  const access = await withOrg(user.id, current.id, (tx) => orgAccess(tx, current.id));
  if (access.kind !== "locked") redirect("/app");

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-3 text-center">
        <h1 className="text-2xl font-semibold">{t.trial.lockedTitle}</h1>
        <p>{t.trial.lockedBody}</p>
        <p className="text-sm opacity-80">{current.role === "owner" ? t.trial.billingSoon : t.trial.lockedMember}</p>
        <form action={signOutAction}>
          <Button type="submit" variant="ghost" size="sm">
            {t.common.signOut}
          </Button>
        </form>
      </Card>
    </main>
  );
}
