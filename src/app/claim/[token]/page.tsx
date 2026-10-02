import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { lookupClaim, type ProspectReport } from "@/server/campaigns/campaigns";
import { optOutAction } from "./actions";
import { ClaimForm } from "./claim-form";

// Private links: never indexed, never cached, no referrer leaks.
export const metadata: Metadata = { title: "Your Google ranking report", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const rank = (n: number | null) => (n === null ? "Not in the top 20" : `#${n}`);
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));

function Stat({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${bad ? "text-red-700 dark:text-red-400" : ""}`}>{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p> : null}
    </div>
  );
}

export default async function ClaimPage({ params }: PageProps<"/claim/[token]">) {
  const { token } = await params;
  const claim = await lookupClaim(token);

  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-4xl items-center px-4 py-5">
        <Link href="/" className="text-slate-900 dark:text-white">
          <Logo className="text-lg" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 pb-16">
        {!claim ? (
          <div className="flex flex-col items-start gap-4 py-12">
            <h1 className="text-2xl font-semibold">This link has expired or doesn&apos;t exist.</h1>
            <Link href="/" className="font-medium text-amber-700 underline dark:text-amber-400">
              Get a free assessment instead
            </Link>
          </div>
        ) : (
          (() => {
            const r = claim.report as ProspectReport;
            const behind = (r.reviews ?? 0) < (r.leaderAvgReviews ?? 0);
            return (
              <>
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Google ranking report · {claim.category} in {claim.city}
                  </p>
                  <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{claim.businessName}</h1>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">
                    When people search &ldquo;{claim.keyword}&rdquo; on Google, here&apos;s where you stand (checked{" "}
                    {new Date(`${r.checkedOn}T12:00:00Z`).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}).
                  </p>
                </div>
                {r.dataSource === "sandbox" ? (
                  <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
                    Sample data: this is a test report.
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Stat label="Your spot in Google Maps" value={rank(r.mapRank)} note="The top 3 get most of the calls" bad={r.mapRank === null || r.mapRank > 3} />
                  <Stat label="Your Google reviews" value={num(r.reviews)} note={`Top 3 average: ${num(r.leaderAvgReviews)}`} bad={behind} />
                  <Stat label="Your Google position" value={rank(r.organicRank)} bad={r.organicRank === null || r.organicRank > 3} />
                  <Stat label="Directory sites in Google's top 10" value={String(r.directoriesInTop10)} note="Sites like Yelp taking spots your website could hold" />
                </div>
                <section className="flex flex-col items-center gap-4 rounded-2xl bg-slate-950 px-6 py-10 text-center text-white">
                  <h2 className="max-w-xl text-xl font-semibold">
                    {claim.status === "claimed" ? "This report has been claimed." : "Claim your free dashboard to see who's ahead of you and what to fix first"}
                  </h2>
                  {claim.status === "claimed" ? (
                    <Link href="/login" className="rounded-lg bg-amber-500 px-6 py-3 font-semibold text-slate-950 hover:bg-amber-400">
                      Sign in
                    </Link>
                  ) : (
                    <>
                      <p className="max-w-xl text-slate-300">
                        We&apos;ll track your Google Maps spot, ranking and reviews every day, show you the businesses ahead of you, and measure what
                        each change you make actually does.
                      </p>
                      <ClaimForm token={token} domain={claim.domain} />
                    </>
                  )}
                </section>
                {claim.status !== "claimed" ? (
                  <form action={optOutAction} className="text-center">
                    <input type="hidden" name="token" value={token} />
                    <button type="submit" className="text-sm text-slate-500 underline hover:text-slate-800 dark:hover:text-slate-200">
                      Not interested? Delete this report and don&apos;t contact {claim.businessName} again.
                    </button>
                  </form>
                ) : null}
              </>
            );
          })()
        )}
      </main>
    </div>
  );
}
