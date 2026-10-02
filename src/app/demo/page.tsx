import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/marketing/logo";
import { demoEnabled } from "@/server/demo/demo";
import { enterAsAdminAction, enterAsOwnerAction, openClaimPageAction } from "./actions";

export const metadata: Metadata = { title: "Demo", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Choice({ title, body, action, cta }: { title: string; body: string; action: () => Promise<void>; cta: string }) {
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white p-6 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="flex-1 text-sm text-slate-600 dark:text-slate-400">{body}</p>
      <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2.5 font-semibold text-slate-950 hover:bg-amber-400">
        {cta}
      </button>
    </form>
  );
}

// Preview-only tour of the product on fictional data. 404 on production.
export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  if (!demoEnabled()) notFound();
  const { missing } = await searchParams;
  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-5xl items-center px-4 py-5">
        <Link href="/" className="text-slate-900 dark:text-white">
          <Logo className="text-lg" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-16">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Product demo</h1>
          <p className="mt-2 max-w-2xl text-slate-600 dark:text-slate-400">
            Everything here is fictional: a made-up shop with 60 days of history, made-up competitors, test accounts. No emails are sent and
            no real businesses are involved.
          </p>
        </div>
        {missing ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            Demo data isn&apos;t loaded on this deployment yet.
          </p>
        ) : null}
        <div className="grid gap-4 md:grid-cols-3">
          <Choice
            title="1. A shop owner's dashboard"
            body="Acme Collision (Demo), 60 days after signing up: Google Maps spot #9 → #4, reviews 48 → 97, and the changes that did it."
            action={enterAsOwnerAction}
            cta="Enter as the shop owner"
          />
          <Choice
            title="2. A claim page"
            body="What a shop receives in a 'claim your ranking' campaign: their Maps spot, review gap and Google position, before signing up."
            action={openClaimPageAction}
            cta="Open a sample claim page"
          />
          <Choice
            title="3. TorqueRank admin"
            body="Your staff view: the funnel, customers, spending, and a sample campaign of 8 fictional Ottawa shops."
            action={enterAsAdminAction}
            cta="Enter as admin"
          />
        </div>
      </main>
    </div>
  );
}
