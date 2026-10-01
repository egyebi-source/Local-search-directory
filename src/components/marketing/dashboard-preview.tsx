// Illustration of the product on the landing page. Example data only.
// No inline style attributes anywhere: the page CSP forbids them.

const WEEKS = [612, 640, 598, 671, 702, 688, 735, 760, 742, 801, 846, 893];
const W = 320;
const H = 96;
const PAD = 6;

function linePath(values: number[]) {
  const min = Math.min(...values) * 0.95;
  const max = Math.max(...values) * 1.02;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (values.length - 1);
  const y = (v: number) => H - PAD - ((v - min) / (max - min)) * (H - PAD * 2);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  return {
    line: pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" "),
    area: `M${pts[0][0]},${H - PAD} ` + pts.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join(" ") + ` L${pts.at(-1)![0]},${H - PAD} Z`,
    points: pts,
  };
}

const TARGETS = [
  { keyword: "collision repair near me", position: 14, cpc: "$11.40" },
  { keyword: "bumper repair ottawa", position: 17, cpc: "$8.95" },
  { keyword: "auto body shop kanata", position: 22, cpc: "$7.20" },
];

export function DashboardPreview() {
  const chart = linePath(WEEKS);
  return (
    <figure className="w-full rounded-2xl bg-white p-4 text-slate-900 shadow-2xl ring-1 ring-slate-900/10 sm:p-5 dark:bg-slate-900 dark:text-slate-100 dark:ring-white/10">
      <figcaption className="mb-4 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Your week at a glance</span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Example
        </span>
      </figcaption>

      <dl className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: "Clicks from Google", value: "893", note: "▲ 18% vs. last month" },
          { label: "Calls & form leads", value: "41", note: "▲ 9 this week" },
          { label: "Rivals' ad spend*", value: "$4.2k", note: "per month, your keywords" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-slate-50 p-2.5 sm:p-3 dark:bg-slate-800/60">
            <dt className="text-[11px] leading-tight text-slate-600 sm:text-xs dark:text-slate-400">{s.label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums sm:text-2xl">{s.value}</dd>
            <dd className="mt-0.5 text-[10px] leading-tight text-slate-500 sm:text-[11px] dark:text-slate-400">{s.note}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
        <p className="mb-1 text-xs text-slate-600 dark:text-slate-400">Weekly clicks from Google, last 12 weeks</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly clicks rising from 612 to 893 over 12 weeks">
          {[0.33, 0.66].map((f) => (
            <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f} className="stroke-slate-200 dark:stroke-slate-700" strokeWidth="1" />
          ))}
          <path d={chart.area} className="fill-amber-500/15" />
          <path d={chart.line} fill="none" className="stroke-amber-500" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {chart.points.map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="8" className="fill-transparent">
              <title>{`Week ${i + 1}: ${WEEKS[i]} clicks`}</title>
            </circle>
          ))}
          <circle cx={chart.points.at(-1)![0]} cy={chart.points.at(-1)![1]} r="4" className="fill-amber-500 stroke-white dark:stroke-slate-900" strokeWidth="2" />
        </svg>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Rescue targets — you&apos;re on page 2, rivals pay for these
        </p>
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {TARGETS.map((t) => (
            <li key={t.keyword} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate">{t.keyword}</span>
              <span className="shrink-0 tabular-nums text-xs text-slate-600 dark:text-slate-400">
                #{t.position} · {t.cpc}/click
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-3 text-[10px] text-slate-500 dark:text-slate-400">*Estimate based on public ad data.</p>
    </figure>
  );
}
