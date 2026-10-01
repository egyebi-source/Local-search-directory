import type { Insight } from "@/server/ai/insights";
import type { AssessmentResult } from "@/server/assessment/result";
import { t } from "@/lib/i18n/en";

const a = t.assessment;
const usd = (n: number | null) => (n === null || n <= 0 ? "—" : `$${n.toFixed(2)}`);

export function SampleDataBanner({ source }: { source: AssessmentResult["dataSource"] }) {
  if (source !== "sandbox") return null;
  return (
    <p role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      {a.sample}
    </p>
  );
}

export function MetricTiles({ m }: { m: AssessmentResult["metrics"] }) {
  const tiles = [
    { label: a.metrics.advertisers, value: String(m.advertisers) },
    { label: a.metrics.topCpc, value: usd(m.topCpcUsd) },
    { label: a.metrics.yourPosition, value: m.yourPosition === null ? a.metrics.notRanked : `#${m.yourPosition}` },
    { label: a.metrics.rescue, value: String(m.rescueTargets) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <dt className="text-sm text-slate-600 dark:text-slate-400">{tile.label}</dt>
          <dd className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function InsightCards({ insights, lockedCount = 0 }: { insights: Insight[]; lockedCount?: number }) {
  return (
    <ol className="flex flex-col gap-3">
      {insights.map((i, n) => (
        <li key={n} className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <h3 className="font-semibold">{i.title}</h3>
          <p className="mt-1 text-slate-700 dark:text-slate-300">{i.detail}</p>
        </li>
      ))}
      {/* Locked items carry no content at all: the text never leaves the server. */}
      {Array.from({ length: lockedCount }, (_, n) => (
        <li
          key={`locked-${n}`}
          className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 p-5 text-slate-500 dark:border-slate-700 dark:text-slate-400"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          {a.lockedItem}
        </li>
      ))}
    </ol>
  );
}

function Table({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={i === 0 ? "px-4 py-2 font-medium" : "px-4 py-2 text-right font-medium"}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length} className="px-4 py-3 text-slate-500">
                {a.none}
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((cell, j) => (
                  <td key={j} className={j === 0 ? "px-4 py-2" : "px-4 py-2 text-right tabular-nums"}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Full results — only ever rendered for members of the organization. */
export function FullDetails({ r }: { r: AssessmentResult }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{a.rescueTitle}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">{a.rescueBody}</p>
        <Table
          caption={a.rescueTitle}
          head={[a.colKeyword, a.colPosition, a.colSearches, a.colCpc]}
          rows={r.rescueTargets.map((k) => [k.keyword, `#${k.position}`, k.monthlySearches.toLocaleString("en-US"), usd(k.cpcUsd)])}
        />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{a.competitorsTitle}</h2>
        <Table caption={a.competitorsTitle} head={["Website", a.colAds]} rows={r.competitors.map((c) => [c.domain, c.ads])} />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{a.keywordsTitle}</h2>
        <Table
          caption={a.keywordsTitle}
          head={[a.colKeyword, a.colSearches, a.colCpc]}
          rows={r.topKeywords.map((k) => [k.keyword, k.monthlySearches.toLocaleString("en-US"), usd(k.cpcUsd)])}
        />
        <p className="text-xs text-slate-500 dark:text-slate-400">{a.estimateNote}</p>
      </section>
    </div>
  );
}
