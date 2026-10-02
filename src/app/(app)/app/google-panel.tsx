import Link from "next/link";
import { TrendChart } from "@/components/charts/trend-chart";
import { googleNote, type GoogleData, type QueryRow } from "@/server/google/metrics";

// The dashboard's "real numbers" panel: the business's own Search Console
// and GA4 data. Search text comes from Google users and is shown as text only.

const num = (n: number) => n.toLocaleString("en-US");
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });

function Change({ value, suffix = "%" }: { value: number | null; suffix?: string }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={`ml-1.5 text-xs font-medium ${up ? "text-green-700" : "text-red-700"}`}>
      {up ? "▲" : "▼"} {Math.abs(value)}
      {suffix}
    </span>
  );
}

function Stat({ label, value, change, sub }: { label: string; value: string; change?: React.ReactNode; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-600">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold">
        {value}
        {change}
      </p>
      {sub ? <p className="text-xs text-slate-500">{sub}</p> : null}
    </div>
  );
}

function Queries({ title, rows, empty }: { title: string; rows: QueryRow[]; empty: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-xs font-medium text-slate-600">{title}</p>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-600">
              <tr>
                <th className="py-1 pr-2 font-medium">Search</th>
                <th className="py-1 pr-2 text-right font-medium">Clicks</th>
                <th className="py-1 pr-2 text-right font-medium">Seen</th>
                <th className="py-1 text-right font-medium">Position</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.query} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 break-words">{q.query}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{num(q.clicks)}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">{num(q.impressions)}</td>
                  <td className="py-1.5 text-right tabular-nums">#{Math.round(q.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">{empty}</p>
      )}
    </div>
  );
}

export function GooglePanel({ g, canConnect }: { g: GoogleData; canConnect: boolean }) {
  const c = g.connection;
  const header = (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-base font-semibold">Your Google data</h2>
      {c ? (
        <p className="text-xs text-slate-600">
          From your own Search Console and Analytics
          {g.gsc ? ` · through ${fmtDay(g.gsc.through)}` : ""}
          {g.stale ? " · not updated for 2+ days" : ""} ·{" "}
          <Link href="/app/google" className="underline">
            Settings
          </Link>
        </p>
      ) : null}
    </div>
  );

  if (!c || (!g.gsc && !g.ga4)) {
    return (
      <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200 lg:col-span-3">
        {header}
        <p className="text-sm text-slate-700">
          {!c
            ? "See the real clicks Google sends you, the exact words people searched, and how many of them called or filled in a form."
            : c.status !== "active"
              ? "Google stopped sharing your data. Reconnect to start updating again."
              : !c.gsc && !c.ga4
                ? "Connected. Choose your website and GA4 property to start."
                : "Connected. Your numbers appear after tonight's update."}
        </p>
        {!c || c.status !== "active" || (!c.gsc && !c.ga4) ? (
          <Link href="/app/google" className="self-start rounded-md bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800">
            {canConnect ? (!c ? "Connect Google (read-only)" : c.status !== "active" ? "Reconnect Google" : "Choose website") : "See Google data settings"}
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-slate-200 lg:col-span-3">
      {header}
      {c.status !== "active" ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          Google stopped sharing your data, so these numbers aren&apos;t updating.{" "}
          <Link href="/app/google" className="font-semibold underline">
            Reconnect
          </Link>
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {g.gsc ? (
          <>
            <Stat label="Clicks from Google (28 days)" value={num(g.gsc.clicks)} change={<Change value={g.gsc.clicksChange} />} />
            <Stat label="Times you were seen" value={num(g.gsc.impressions)} change={<Change value={g.gsc.impressionsChange} />} sub={`${g.gsc.ctr}% clicked`} />
            <Stat
              label="Average position"
              value={g.gsc.position === null ? "—" : `#${g.gsc.position}`}
              change={<Change value={g.gsc.positionChange} suffix="" />}
              sub="Across all searches"
            />
          </>
        ) : null}
        {g.ga4 ? (
          <>
            <Stat label="Website visits (28 days)" value={num(g.ga4.sessions)} change={<Change value={g.ga4.sessionsChange} />} />
            <Stat
              label="From Google search"
              value={num(g.ga4.organicSessions)}
              sub={g.ga4.organicShare === null ? undefined : `${g.ga4.organicShare}% of visits`}
            />
            <Stat label="Key actions (calls, forms)" value={num(g.ga4.keyEvents)} change={<Change value={g.ga4.keyEventsChange} />} sub="GA4 key events" />
          </>
        ) : null}
      </div>
      {g.gsc && g.gsc.trend.length > 1 ? (
        <TrendChart
          title="Clicks from Google per day (Search Console)"
          kind="count"
          days={g.gsc.trend.map((t) => t.day)}
          series={[{ name: "Clicks", color: "--viz-1", values: g.gsc.trend.map((t) => t.clicks) }]}
        />
      ) : g.ga4 && g.ga4.trend.length > 1 ? (
        <TrendChart
          title="Website visits per day (GA4)"
          kind="count"
          days={g.ga4.trend.map((t) => t.day)}
          series={[
            { name: "All visits", color: "--viz-1", values: g.ga4.trend.map((t) => t.sessions) },
            { name: "From Google search", color: "--viz-2", values: g.ga4.trend.map((t) => t.organic) },
          ]}
        />
      ) : null}
      {g.gsc ? (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Queries title="What people searched to find you (28 days)" rows={g.gsc.topQueries} empty="No searches reported yet." />
          <Queries title="Quickest wins: seen often, just off the top 3" rows={g.gsc.almostThere} empty="None right now." />
        </div>
      ) : null}
      <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-950">
        <span className="font-semibold">What this means: </span>
        {googleNote(g)}
      </p>
    </section>
  );
}
