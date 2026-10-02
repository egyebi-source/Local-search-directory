import type { Insight } from "@/server/ai/insights";
import type { AssessmentResult, LocalSummary, LocalVisibility, Market } from "@/server/assessment/result";
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

const L = a.local;
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const star = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}★`);

/** Map position and review gap: the numbers that decide who gets local calls. */
export function LocalTiles({ l, m }: { l: LocalSummary; m: AssessmentResult["metrics"] }) {
  const tiles = [
    {
      label: L.mapRank,
      value: l.yourRank === null ? L.notInMaps : `#${l.yourRank}`,
      note: L.top3,
      bad: l.yourRank === null || l.yourRank > 3,
    },
    {
      label: L.yourReviews,
      value: l.you ? num(l.you.reviews) : "—",
      note: `${L.leaderReviews}: ${num(l.leaderAvgReviews)} · ${star(l.leaderAvgRating)}`,
      bad: (l.you?.reviews ?? 0) < (l.leaderAvgReviews ?? 0),
    },
    {
      label: a.metrics.yourPosition,
      value: m.yourPosition === null ? a.metrics.notRanked : `#${m.yourPosition}`,
      note: null,
      bad: m.yourPosition === null || m.yourPosition > 3,
    },
    { label: L.directories, value: String(l.directoriesInTop10), note: L.directoriesNote, bad: false },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <dt className="text-sm text-slate-600 dark:text-slate-400">{tile.label}</dt>
          <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tile.bad ? "text-red-700 dark:text-red-400" : ""}`}>{tile.value}</dd>
          {tile.note ? <dd className="mt-1 text-xs text-slate-500 dark:text-slate-400">{tile.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** Names of the map leaders: members only. */
export function LeadersTable({ l }: { l: LocalVisibility }) {
  const rows = [
    ...l.leaders.map((x) => [`#${x.rank}`, x.name, star(x.rating), num(x.reviews)]),
    ...(l.you ? [[l.yourRank === null ? "—" : `#${l.yourRank}`, `${l.you.name} (you)`, star(l.you.rating), num(l.you.reviews)]] : []),
  ];
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">{L.leadersTitle}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">{L.leadersBody(l.keyword)}</p>
      <Table caption={L.leadersTitle} head={[L.colRank, L.colBusiness, L.rating, L.colReviews]} rows={rows} />
    </section>
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
  const others = r.otherMarkets ?? [];
  return (
    <div className="flex flex-col gap-10">
      {others.length ? <h2 className="text-2xl font-semibold">{a.marketTitle(a.countryNames[r.country])}</h2> : null}
      {r.local ? <LeadersTable l={r.local} /> : null}
      <MarketDetails r={r} />
      {others.map((m) => (
        <section key={m.country} className="flex flex-col gap-6 border-t border-slate-200 pt-8 dark:border-slate-800">
          <h2 className="text-2xl font-semibold">{a.marketTitle(a.countryNames[m.country])}</h2>
          <MetricTiles m={m.metrics} />
          <MarketDetails r={m} />
        </section>
      ))}
    </div>
  );
}

function MarketDetails({ r }: { r: Market }) {
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
