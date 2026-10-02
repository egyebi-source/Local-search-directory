"use client";

import { useEffect, useId, useRef, useState } from "react";

// Line chart for daily progress. One y-axis; ranks are drawn with #1 at the
// top ("up is better"); missing values (not found) are gaps, never zeros.
// Hover/keyboard crosshair with one tooltip for every series, numbered
// markers for logged changes, and a table view so nothing depends on hover.

export type TrendSeries = { name: string; color: "--viz-1" | "--viz-2"; values: (number | null)[] };
export type TrendMarker = { day: string; n: number; label: string };

type Props = {
  title: string;
  days: string[];
  series: TrendSeries[];
  kind: "rank" | "count";
  markers?: TrendMarker[];
};

const H = 200;
const PAD = { top: 22, right: 44, bottom: 24, left: 40 };
const RANK_FLOOR = 20; // we check the top 20

const fmtDay = (d: string, long = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(long ? { year: "numeric" } : {}), timeZone: "UTC" });

function fmtValue(kind: Props["kind"], v: number | null) {
  if (v === null) return kind === "rank" ? "Not in top 20" : "—";
  return kind === "rank" ? `#${v}` : v.toLocaleString("en-US");
}

function niceMax(n: number) {
  if (n <= 10) return 10;
  const p = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / p) * p;
}

export function TrendChart({ title, days, series, kind, markers = [] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const descId = useId();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = days.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const [lo, hi] = kind === "rank" ? [1, RANK_FLOOR] : [0, niceMax(Math.max(1, ...all))];
  const plotW = width - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  // Ranks: #1 at the top. Counts: 0 at the bottom.
  const y = (v: number) => (kind === "rank" ? PAD.top + ((v - lo) / (hi - lo)) * plotH : PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH);
  const ticks = kind === "rank" ? [1, 5, 10, 15, 20] : [0, hi / 2, hi];
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  function path(values: (number | null)[]) {
    let d = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(Math.min(v, hi)).toFixed(1)}`;
      pen = true;
    });
    return d;
  }

  function pick(clientX: number) {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const rel = (clientX - rect.left - PAD.left) / plotW;
    setHover(Math.max(0, Math.min(n - 1, Math.round(rel * (n - 1)))));
  }

  const last = n - 1;
  const hoverMarkers = hover === null ? [] : markers.filter((m) => m.day === days[hover]);
  const tipLeft = hover === null ? 0 : Math.min(Math.max(x(hover) - 80, 0), width - 170);

  return (
    <div className="viz-root flex flex-col gap-2">
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--viz-ink-2)" }} aria-label="Legend">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded" style={{ background: `var(${s.color})` }} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div ref={wrap} className="relative w-full" style={{ touchAction: "pan-y" }}>
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={title}
          aria-describedby={descId}
          tabIndex={0}
          className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
          style={{ background: "var(--viz-surface)" }}
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onFocus={() => setHover(last)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? last) - 1));
            else if (e.key === "ArrowRight") setHover((h) => Math.min(last, (h ?? 0) + 1));
            else return;
            e.preventDefault();
          }}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)" className="tabular-nums">
                {kind === "rank" ? (t === RANK_FLOOR ? "20+" : `#${t}`) : t.toLocaleString("en-US")}
              </text>
            </g>
          ))}
          {n > 0 ? (
            <>
              <text x={x(0)} y={H - 6} fontSize={11} fill="var(--viz-muted)">
                {fmtDay(days[0])}
              </text>
              <text x={x(last)} y={H - 6} fontSize={11} textAnchor="end" fill="var(--viz-muted)">
                {fmtDay(days[last])}
              </text>
            </>
          ) : null}

          {/* Logged changes: hairline + numbered badge above the plot. */}
          {markers.map((m) => {
            const i = dayIndex.get(m.day);
            if (i === undefined) return null;
            return (
              <g key={`${m.day}-${m.n}`}>
                <line x1={x(i)} x2={x(i)} y1={PAD.top - 4} y2={PAD.top + plotH} stroke="var(--viz-axis)" strokeWidth={1} />
                <circle cx={x(i)} cy={PAD.top - 11} r={8} fill="var(--viz-surface)" stroke="var(--viz-axis)" strokeWidth={1} />
                <text x={x(i)} y={PAD.top - 7.5} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--viz-ink-2)">
                  {m.n}
                </text>
              </g>
            );
          })}

          {series.map((s) => (
            <path key={s.name} d={path(s.values)} fill="none" stroke={`var(${s.color})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {/* End dots + value at the end of each line (text in ink, not series color).
              Labels that would collide aren't stacked: equal values share one label,
              and a too-close second label is left to the tooltip and table. */}
          {(() => {
            const placed: { y: number; text: string }[] = [];
            return series.map((s) => {
              const v = s.values[last];
              if (v === null || v === undefined) return null;
              const cy = y(Math.min(v, hi));
              const text = fmtValue(kind, v);
              const clash = placed.find((p) => Math.abs(p.y - cy) < 14);
              if (!clash) placed.push({ y: cy, text });
              return (
                <g key={`end-${s.name}`}>
                  <circle cx={x(last)} cy={cy} r={4} fill={`var(${s.color})`} stroke="var(--viz-surface)" strokeWidth={2} />
                  {clash ? null : (
                    <text x={x(last) + 8} y={cy + 4} fontSize={12} fontWeight={600} fill="var(--viz-ink)">
                      {text}
                    </text>
                  )}
                </g>
              );
            });
          })()}

          {hover !== null ? (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--viz-muted)" strokeWidth={1} />
              {series.map((s) => {
                const v = s.values[hover];
                return v === null || v === undefined ? null : (
                  <circle key={s.name} cx={x(hover)} cy={y(Math.min(v, hi))} r={4} fill={`var(${s.color})`} stroke="var(--viz-surface)" strokeWidth={2} />
                );
              })}
            </g>
          ) : null}
        </svg>

        {hover !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-0 w-40 rounded-md bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-black/10 dark:bg-slate-900 dark:ring-white/10"
            style={{ left: tipLeft, transform: "translateY(-100%)" }}
          >
            <p className="mb-1 text-slate-500 dark:text-slate-400">{fmtDay(days[hover], true)}</p>
            {series.map((s) => (
              <p key={s.name} className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: `var(${s.color})` }} />
                <strong className="text-slate-900 dark:text-white">{fmtValue(kind, s.values[hover] ?? null)}</strong>
                <span className="text-slate-500 dark:text-slate-400">{s.name}</span>
              </p>
            ))}
            {hoverMarkers.map((m) => (
              <p key={m.n} className="mt-1 text-slate-600 dark:text-slate-300">
                ({m.n}) {m.label}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <p id={descId} className="sr-only">
        {series.map((s) => `${s.name}: ${fmtValue(kind, s.values[0] ?? null)} on ${fmtDay(days[0] ?? "", true)}, ${fmtValue(kind, s.values[last] ?? null)} on ${fmtDay(days[last] ?? "", true)}.`).join(" ")}
      </p>
      <details className="text-xs text-slate-600 dark:text-slate-400">
        <summary className="cursor-pointer select-none">Show as a table</summary>
        <div className="mt-2 max-h-56 overflow-auto rounded-md ring-1 ring-slate-200 dark:ring-slate-800">
          <table className="w-full text-left">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-900">
              <tr>
                <th scope="col" className="px-2 py-1 font-medium">Date</th>
                {series.map((s) => (
                  <th key={s.name} scope="col" className="px-2 py-1 text-right font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1">{fmtDay(d, true)}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-2 py-1 text-right tabular-nums">
                      {fmtValue(kind, s.values[i] ?? null)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
