import { cookies } from "next/headers";
import Link from "next/link";
import { InsightCards, MetricTiles, SampleDataBanner } from "@/components/assessment/parts";
import { Logo } from "@/components/marketing/logo";
import { t } from "@/lib/i18n/en";
import { toTeaser } from "@/server/assessment/result";
import { getSnapshot } from "@/server/assessment/snapshots";
import { DRAFT_COOKIE } from "@/server/onboarding/drafts";

const a = t.assessment;

// Public teaser. Only the output of toTeaser() is rendered, so locked
// findings, rescue targets and competitor names never reach the browser.
export default async function AssessmentPage({ params }: PageProps<"/assessment/[id]">) {
  const { id } = await params;
  const result = await getSnapshot(id);
  const teaser = result ? toTeaser(result) : null;
  const canUnlock = Boolean((await cookies()).get(DRAFT_COOKIE));

  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-4xl items-center px-4 py-5">
        <Link href="/" className="text-slate-900 dark:text-white">
          <Logo className="text-lg" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 pb-16">
        {!teaser ? (
          <div className="flex flex-col items-start gap-4 py-12">
            <h1 className="text-2xl font-semibold">{a.expired}</h1>
            <Link href="/" className="font-medium text-amber-700 underline dark:text-amber-400">
              {a.ownCta}
            </Link>
          </div>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{a.title(teaser.domain)}</h1>
              <p className="mt-1 text-slate-600 dark:text-slate-400">{a.subtitle(teaser.primaryKeyword)}</p>
            </div>
            <SampleDataBanner source={teaser.dataSource} />
            <MetricTiles m={teaser.metrics} />
            <section className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold">{a.insightsTitle}</h2>
              <InsightCards insights={teaser.insights} lockedCount={teaser.lockedInsights} />
            </section>
            <section className="flex flex-col items-center gap-3 rounded-2xl bg-slate-950 px-6 py-10 text-center text-white">
              <p className="max-w-lg text-lg">{a.locked(teaser.lockedInsights)}</p>
              {canUnlock ? (
                <Link
                  href={`/login?callbackUrl=${encodeURIComponent("/onboarding/complete")}`}
                  className="rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  {a.unlock}
                </Link>
              ) : (
                <Link
                  href="/"
                  className="rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                >
                  {a.ownCta}
                </Link>
              )}
              <p className="text-sm text-slate-400">{a.unlockNote}</p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
