import Link from "next/link";
import type { ReactNode } from "react";
import { TrendChart } from "@/components/charts/trend-chart";
import { loadDashboard, type Dashboard } from "@/server/dashboard/dashboard";
import { withCurrentOrg } from "@/server/org/current";
import { SnapshotButton } from "./snapshot-button";

// The SEO dashboard: every panel has its numbers and a plain-English note
// on what they mean and what to do.

const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
const rank = (n: number | null | undefined) => (n === null || n === undefined ? "Not in top 20" : `#${n}`);
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Change({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={`ml-1.5 text-xs font-medium ${up ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

function Panel({ title, note, children, className = "", link }: { title: string; note: string; children: ReactNode; className?: string; link?: { href: string; label: string } }) {
  return (
    <section className={`flex flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800 ${className}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="flex flex-1 flex-col gap-4">{children}</div>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/60 dark:text-amber-100">
        <span className="font-semibold">What this means: </span>
        {note}
        {link ? (
          <>
            {" "}
            <Link href={link.href} className="font-semibold underline">
              {link.label} →
            </Link>
          </>
        ) : null}
      </p>
    </section>
  );
}

function Stat({ label, value, change, sub }: { label: string; value: string; change?: ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold">
        {value}
        {change}
      </p>
      {sub ? <p className="text-xs text-slate-500 dark:text-slate-400">{sub}</p> : null}
    </div>
  );
}

function Overview({ d }: { d: Dashboard }) {
  const o = d.overview;
  return (
    <Panel title="SEO overview" note={d.notes.overview} className="lg:col-span-2">
      {o ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Visitors from Google / month (est.)" value={num(o.trafficEst)} change={<Change value={o.trafficChange} />} />
            <Stat label="Searches you rank for" value={num(o.keywords)} change={<Change value={o.keywordsChange} />} sub="In Google's top 100" />
            <Stat label="Value of that traffic / month" value={`$${num(o.trafficValueUsd)}`} sub="What the clicks would cost as ads" />
            <Stat label="Searches you run ads on" value={num(o.paidKeywords)} sub={o.paidKeywords === 0 ? "No Google Ads found" : undefined} />
          </div>
          {d.trafficTrend.length > 1 ? (
            <TrendChart
              title="Estimated visitors from Google per month, by week"
              kind="count"
              days={d.trafficTrend.map((t) => t.day)}
              series={[{ name: "Visitors / month (est.)", color: "--viz-1", values: d.trafficTrend.map((t) => t.value) }]}
            />
          ) : null}
        </>
      ) : (
        <SnapshotButton />
      )}
    </Panel>
  );
}

function Maps({ d }: { d: Dashboard }) {
  const l = d.local;
  return (
    <Panel title="Google Maps" note={d.notes.local} link={{ href: "/app/progress", label: "See progress" }}>
      {l ? (
        <div className="grid grid-cols-2 gap-4">
          <Stat label={`Your spot for "${l.keyword}"`} value={rank(l.mapRank)} sub="Top 3 get most calls" />
          <Stat label="Your reviews" value={num(l.reviews)} sub={`Top 3 average: ${num(l.leaderAvgReviews)}`} />
          <Stat label="Your rating" value={l.rating === null ? "—" : `${l.rating.toFixed(1)}★`} />
        </div>
      ) : (
        <p className="text-sm text-slate-500">No checks yet.</p>
      )}
    </Panel>
  );
}

function Position({ d }: { d: Dashboard }) {
  return (
    <Panel title="Position tracking" note={d.notes.position} className="lg:col-span-2" link={d.actions.some((a) => a.kind === "new_page") ? { href: "/app/actions", label: "See the fix" } : undefined}>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2">
          <Stat label="Visibility (your tracked searches)" value={d.visibilityNow === null ? "—" : `${d.visibilityNow}%`} change={<Change value={d.visibilityChange} suffix=" pts" />} sub="100% = #1 for every tracked search" />
          {d.visibilityTrend.length > 1 ? (
            <TrendChart
              title="Visibility on your tracked searches, by day"
              kind="percent"
              days={d.visibilityTrend.map((v) => v.day)}
              series={[{ name: "Visibility", color: "--viz-1", values: d.visibilityTrend.map((v) => v.value) }]}
            />
          ) : null}
        </div>
        <div>
          <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">Searches you rank for, by position{d.latest ? ` (week of ${fmtDay(d.latest.takenOn)})` : ""}</p>
          {d.buckets.length ? (
            <dl className="grid grid-cols-2 gap-3">
              {d.buckets.map((b) => (
                <div key={b.label} className="rounded-lg p-3 ring-1 ring-slate-200 dark:ring-slate-800">
                  <dt className="text-xs text-slate-600 dark:text-slate-400">{b.label}</dt>
                  <dd className="text-2xl font-semibold">{num(b.count)}</dd>
                  {b.new !== null ? (
                    <dd className="text-xs text-slate-600 dark:text-slate-400">
                      <span className="text-green-700 dark:text-green-400">new {b.new}</span> · <span className="text-red-700 dark:text-red-400">lost {b.lost}</span>
                    </dd>
                  ) : null}
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-slate-500">After your first site check.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function TopKeywords({ d }: { d: Dashboard }) {
  return (
    <Panel title="Top searches" note={d.notes.keywords}>
      {d.topKeywords.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Searches that bring you the most visitors</caption>
            <thead className="text-xs text-slate-600 dark:text-slate-400">
              <tr>
                <th scope="col" className="py-1.5 pr-2 font-medium">Search</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-medium">Position</th>
                <th scope="col" className="py-1.5 text-right font-medium">Searches/mo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {d.topKeywords.map((k) => (
                <tr key={k.keyword}>
                  <td className="py-1.5 pr-2">{k.keyword}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">#{k.position}</td>
                  <td className="py-1.5 text-right tabular-nums">{num(k.searches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">After your first site check.</p>
      )}
    </Panel>
  );
}

function Ai({ d }: { d: Dashboard }) {
  return (
    <Panel title="AI search visibility" note={d.notes.ai}>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Searches with a Google AI answer" value={`${d.ai.shown} of ${d.ai.searches.length}`} />
        <Stat label="AI answers that mention you" value={`${d.ai.cited} of ${d.ai.shown}`} />
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {d.ai.searches.map((s) => (
          <li key={s.keyword} className="flex justify-between gap-2">
            <span>&ldquo;{s.keyword}&rdquo;</span>
            <span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">
              {s.shown === null ? "not checked" : !s.shown ? "no AI answer" : s.cited ? "✓ mentions you" : "✗ doesn't mention you"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">ChatGPT and other AI assistants: coming later.</p>
    </Panel>
  );
}

function Health({ d }: { d: Dashboard }) {
  const a = d.audit;
  return (
    <Panel title="Site health" note={d.notes.audit} link={a?.issues.length ? { href: "/app/actions", label: "Your action plan" } : undefined}>
      {a ? (
        <>
          <div className="flex items-end gap-3">
            <Stat label={`Score (${a.pages} page${a.pages === 1 ? "" : "s"} checked)`} value={a.score === null ? "—" : `${a.score}/100`} />
          </div>
          {a.score !== null ? (
            <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="h-2 w-full" role="meter" aria-valuenow={a.score} aria-valuemin={0} aria-valuemax={100} aria-label="Site health score">
              <rect width={100} height={4} rx={2} className="fill-slate-100 dark:fill-slate-800" />
              <rect width={a.score} height={4} rx={2} className={a.score >= 80 ? "fill-green-600" : a.score >= 60 ? "fill-amber-500" : "fill-red-600"} />
            </svg>
          ) : null}
          <ul className="flex flex-col gap-1.5 text-sm">
            {a.issues.slice(0, 6).map((i) => (
              <li key={i.check} className="flex justify-between gap-2">
                <span>
                  <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">{i.area}</span>
                  {i.label}
                </span>
                <span className="shrink-0 tabular-nums text-slate-600 dark:text-slate-400">{i.pages}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-slate-500">After your first site check.</p>
      )}
    </Panel>
  );
}

function NextSteps({ d }: { d: Dashboard }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-slate-950 p-5 text-white">
      <h2 className="text-base font-semibold">Your next steps</h2>
      {d.actions.length ? (
        <ol className="flex flex-1 flex-col gap-3">
          {d.actions.map((a, i) => (
            <li key={a.id} className="rounded-lg bg-slate-900 p-4 ring-1 ring-slate-800">
              <p className="text-xs text-amber-400">Step {i + 1}{a.valueUsdMonth ? ` · worth ~$${a.valueUsdMonth.toLocaleString("en-US")}/mo` : ""}</p>
              <p className="mt-1 font-medium">{a.title}</p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-300">Your action plan is empty.</p>
      )}
      <Link href="/app/actions" className="self-start rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400">
        Open your action plan
      </Link>
    </section>
  );
}

export default async function DashboardPage() {
  const d = await withCurrentOrg((tx, ctx) => loadDashboard(tx, ctx.orgId));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">SEO dashboard</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {d.business.name}
            {d.business.domain ? ` · ${d.business.domain}` : ""}
            {d.latest ? ` · site check of ${fmtDay(d.latest.takenOn)}, refreshed weekly` : ""}
          </p>
        </div>
      </div>
      {d.sample ? (
        <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          Sample data: some numbers come from our data provider&apos;s test data and aren&apos;t about your business.
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Overview d={d} />
        <Maps d={d} />
        <Position d={d} />
        <TopKeywords d={d} />
        <Ai d={d} />
        <Health d={d} />
        <NextSteps d={d} />
      </div>
      <p className="text-xs text-slate-500">
        Visitor and value figures are estimates from public search data, not your own analytics. Connect Google Analytics (coming soon) for exact numbers.
      </p>
    </div>
  );
}
