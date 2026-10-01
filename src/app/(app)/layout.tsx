import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/en";
import { withOrg } from "@/server/db/tenant";
import { currentOrganization, orgAccess, requireUser } from "@/server/org/current";
import { signOutAction, switchOrgAction } from "./app/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const { orgs, current } = await currentOrganization(user);
  // No organization yet: finish sign-up from saved answers if there are any.
  if (!current) redirect("/onboarding/complete");

  const access = await withOrg(user.id, current.id, (tx) => orgAccess(tx, current.id));
  if (access.kind === "locked") redirect("/locked");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/app" className="font-semibold">
            {t.appName}
          </Link>
          <nav className="flex gap-3 text-sm">
            <Link href="/app">{t.app.nav.overview}</Link>
            <Link href="/app/team">{t.app.nav.team}</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {orgs.length > 1 ? (
              <form action={switchOrgAction} className="flex items-center gap-2">
                <label htmlFor="orgId" className="sr-only">
                  {t.app.switchOrg}
                </label>
                <select
                  id="orgId"
                  name="orgId"
                  defaultValue={current.id}
                  className="h-8 rounded-md border border-neutral-300 bg-transparent px-2 text-sm dark:border-neutral-700"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="outline">
                  {t.app.switchOrg}
                </Button>
              </form>
            ) : (
              <span className="text-sm">{current.name}</span>
            )}
            <form action={signOutAction}>
              <Button type="submit" size="sm" variant="ghost">
                {t.common.signOut}
              </Button>
            </form>
          </div>
        </div>
      </header>
      {access.kind === "trialing" ? (
        <div className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="mx-auto w-full max-w-5xl px-4 py-2 text-sm">{t.trial.daysLeft(access.daysLeft)}</p>
        </div>
      ) : null}
      {/* Locked orgs never get here: the layout and withCurrentOrg() both send them to /locked. */}
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

