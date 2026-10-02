import Link from "next/link";
import { TrendChart, type TrendMarker } from "@/components/charts/trend-chart";
import { t } from "@/lib/i18n/en";
import { withCurrentOrg } from "@/server/org/current";
import { TRACKED_SEARCH_LIMIT } from "@/server/tracking/checks";
import { checkOn, countGain, loadProgress, rankGain, type Check, type SearchProgress } from "@/server/tracking/progress";
import { deleteChangeAction, stopTrackingAction } from "./actions";
import { AddChangeForm, AddSearchForm, CheckNowForm } from "./forms";

const p = t.progress;

const fmtDay = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const rank = (n: number | null | undefined) => (n === null || n === undefined ? p.notFound : `#${n}`);
const num = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toLocaleString("en-US"));
const star = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toFixed(1)}★`);

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-slate-400">—</span>;
  if (value === 0) return <span className="text-slate-500">{p.same}</span>;
  return value > 0 ? (
    <span className="font-semibold text-green-700">{p.up(value)}</span>
  ) : (
    <span className="font-semibold text-red-700">{p.down(-value)}</span>
  );
}

function Comparison({ from, to }: { from: Check | null; to: Check | null }) {
  const rows: [string, string, string, number | null][] = [
    [p.mapSpot, rank(from?.mapRank), rank(to?.mapRank), from && to ? rankGain(from.mapRank, to.mapRank) : null],
    [p.googleSpot, rank(from?.organicRank), rank(to?.organicRank), from && to ? rankGain(from.organicRank, to.organicRank) : null],
    [p.reviews, num(from?.reviews), num(to?.reviews), countGain(from?.reviews ?? null, to?.reviews ?? null)],
    [p.rating, star(from?.rating), star(to?.rating), null],
    [p.leaders, num(from?.leaderAvgReviews), num(to?.leaderAvgReviews), null],
  ];
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-slate-600">
        <tr>
          <th scope="col" className="py-2 pr-4 font-medium" />
          <th scope="col" className="py-2 pr-4 font-medium">
            {p.before}
            {from ? <span className="block text-xs font-normal">{fmtDay(from.day)}</span> : null}
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            {p.now}
            {to ? <span className="block text-xs font-normal">{fmtDay(to.day)}</span> : null}
          </th>
          <th scope="col" className="py-2 font-medium">
            {p.change}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map(([label, a, b, d]) => (
          <tr key={label}>
            <th scope="row" className="py-2 pr-4 font-normal text-slate-600">
              {label}
            </th>
            <td className="py-2 pr-4 tabular-nums">{a}</td>
            <td className="py-2 pr-4 tabular-nums">{b}</td>
            <td className="py-2 tabular-nums">
              <Delta value={d} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SearchCard({ s, markers }: { s: SearchProgress; markers: TrendMarker[] }) {
  const sample = s.history.some((c) => c.dataSource === "sandbox");
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">&ldquo;{s.keyword}&rdquo;</h2>
        <form action={stopTrackingAction}>
          <input type="hidden" name="id" value={s.id} />
          <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-800">
            {p.stop}
          </button>
        </form>
      </div>
      {sample ? <p className="text-xs text-gold-700">{p.sample}</p> : null}
      {s.history.length > 1 ? (
        <TrendChart
          title={`Google Maps spot and Google position for "${s.keyword}", by day`}
          kind="rank"
          days={s.history.map((c) => c.day)}
          series={[
            { name: p.mapSpot, color: "--viz-1", values: s.history.map((c) => c.mapRank) },
            { name: p.googleSpot, color: "--viz-2", values: s.history.map((c) => c.organicRank) },
          ]}
          markers={markers.filter((m) => m.day >= s.history[0].day)}
        />
      ) : null}
      {s.history.length ? <Comparison from={s.before} to={s.now} /> : <p className="text-sm text-slate-500">{p.tooEarly}</p>}
    </section>
  );
}

export default async function ProgressPage() {
  const data = await withCurrentOrg((tx, ctx) => loadProgress(tx, ctx.orgId));
  const today = new Date().toISOString().slice(0, 10);
  const main = data.searches[0];
  // Changes are numbered oldest first; the same numbers appear on the charts.
  const numbered = [...data.changes].sort((a, b) => a.madeOn.localeCompare(b.madeOn));
  const changeNo = new Map(numbered.map((c, i) => [c.id, i + 1]));
  // A change logged on a day without a check snaps to the next checked day.
  const markersFor = (s: SearchProgress): TrendMarker[] =>
    numbered.flatMap((c) => {
      const day = s.history.find((h) => h.day >= c.madeOn)?.day;
      return day ? [{ day, n: changeNo.get(c.id)!, label: c.title }] : [];
    });

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">{p.title}</h1>
        <p className="max-w-2xl text-slate-600">{p.intro}</p>
        <Link href="/app/digest" className="text-sm font-medium text-gold-700 underline">
          {p.digestLink}
        </Link>
      </div>

      {main && main.history.length > 1 && main.history.some((c) => c.reviews !== null) ? (
        <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold">{p.reviewsChart}</h2>
          <TrendChart
            title={p.reviewsChart}
            kind="count"
            days={main.history.map((c) => c.day)}
            series={[
              { name: p.reviews, color: "--viz-1", values: main.history.map((c) => c.reviews) },
              { name: p.leaders, color: "--viz-2", values: main.history.map((c) => c.leaderAvgReviews) },
            ]}
            markers={markersFor(main)}
          />
        </section>
      ) : null}

      {data.searches.length ? (
        <div className="flex flex-col gap-4">
          {data.searches.map((s) => (
            <SearchCard key={s.id} s={s} markers={markersFor(s)} />
          ))}
          <CheckNowForm />
        </div>
      ) : (
        <p className="text-slate-600">{p.empty}</p>
      )}

      {data.searches.length < TRACKED_SEARCH_LIMIT ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">{p.addTitle}</h2>
          <p className="text-sm text-slate-600">{p.limit(TRACKED_SEARCH_LIMIT)}</p>
          <AddSearchForm />
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold">{p.changesTitle}</h2>
          <p className="text-sm text-slate-600">{p.changesIntro}</p>
        </div>
        <AddChangeForm today={today} />
        {data.changes.length === 0 ? (
          <p className="text-sm text-slate-500">{p.noChanges}</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {data.changes.map((c) => {
              const at = main ? checkOn(main.history, c.madeOn) : null;
              const later = main?.now && main.now.day > c.madeOn ? main.now : null;
              return (
                <li key={c.id} className="flex flex-col gap-2 rounded-xl bg-white p-4 ring-1 ring-slate-200">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ring-1 ring-slate-300">
                          {changeNo.get(c.id)}
                        </span>
                        {c.title}
                      </p>
                      <p className="text-xs text-slate-500">{fmtDay(c.madeOn)}</p>
                      {c.note ? <p className="mt-1 text-sm text-slate-700">{c.note}</p> : null}
                    </div>
                    <form action={deleteChangeAction}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit" className="text-xs text-slate-500 underline hover:text-slate-800">
                        {p.changeDelete}
                      </button>
                    </form>
                  </div>
                  {main ? (
                    <p className="text-sm">
                      <span className="text-slate-600">
                        {p.afterChange} ({main.keyword}):{" "}
                      </span>
                      {at && later ? (
                        <>
                          {p.mapSpot} {rank(at.mapRank)} → {rank(later.mapRank)} <Delta value={rankGain(at.mapRank, later.mapRank)} />
                          {" · "}
                          {p.reviews} {num(at.reviews)} → {num(later.reviews)} <Delta value={countGain(at.reviews, later.reviews)} />
                        </>
                      ) : (
                        <span className="text-slate-500">{p.tooEarly}</span>
                      )}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
