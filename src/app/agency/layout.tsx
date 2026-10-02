import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n/en";
import { isDemoEmail } from "@/server/demo/demo";
import { requireUser } from "@/server/org/current";
import { signOutAction } from "../(app)/app/actions";

export default async function AgencyLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-rose-100 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <Link href="/agency" aria-label={`${t.appName} for agencies`} className="flex items-center gap-2">
            <Logo />
            <span className="text-sm font-medium text-gold-700">for agencies</span>
          </Link>
          <nav className="flex gap-3 text-sm text-slate-700 [&_a:hover]:text-rose-700">
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
        <div className="border-b border-rose-300 bg-rose-50 text-rose-950">
          <p className="mx-auto w-full max-w-6xl px-4 py-2 text-sm">
            Demo account: the agency, businesses and numbers are fictional. <Link href="/demo" className="underline">Back to the demo menu</Link>
          </p>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
