import Link from "next/link";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/en";
import { isDemoEmail } from "@/server/demo/demo";
import { requireUser } from "@/server/org/current";
import { signOutAction } from "../(app)/app/actions";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/agency" className="font-semibold">
            {t.appName} <span className="font-normal opacity-70">for agencies</span>
          </Link>
          <nav className="flex gap-3 text-sm">
            <Link href="/agency">All locations</Link>
            <Link href="/help#agency-start">Help</Link>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm opacity-80">{user.email}</span>
            <form action={signOutAction}>
              <Button type="submit" size="sm" variant="ghost">
                {t.common.signOut}
              </Button>
            </form>
          </div>
        </div>
      </header>
      {isDemoEmail(user.email) ? (
        <div className="border-b border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100">
          <p className="mx-auto w-full max-w-6xl px-4 py-2 text-sm">
            Demo account: the agency, businesses and numbers are fictional. <Link href="/demo" className="underline">Back to the demo menu</Link>
          </p>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
