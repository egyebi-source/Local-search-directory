import "server-only";
import { eq } from "drizzle-orm";
import { listActions, type ActionItem } from "@/server/actions/plan";
import { organizations } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";
import { loadProgress, type SearchProgress } from "@/server/tracking/progress";
import { loadSnapshots, type Snapshot, type SnapshotData } from "./snapshot";

// Everything the SEO dashboard shows, computed from the org's own data,
// plus a plain-English note for each panel. Pure functions are exported
// for tests.

/** Approximate share of clicks by Google position (industry averages; used for "visibility"). */
const CTR = [0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.03, 0.025, 0.02];
export function ctrFor(position: number | null): number {
  if (position === null || position < 1) return 0;
  if (position <= 10) return CTR[position - 1];
  return position <= 20 ? 0.01 : 0;
}

/** 100% = #1 for every tracked search. */
export function visibility(positions: (number | null)[]): number | null {
  if (!positions.length) return null;
  const share = positions.reduce<number>((s, p) => s + ctrFor(p), 0) / (positions.length * CTR[0]);
  return Math.round(share * 1000) / 10;
}

export type Bucket = { label: string; max: number; count: number; new: number | null; lost: number | null };

/** Keywords per position band, with what's new and lost since the previous snapshot. */
export function buckets(latest: SnapshotData, prev: SnapshotData | null): Bucket[] {
  const bands = [
    ["Top 3", 3],
    ["Top 10", 10],
    ["Top 20", 20],
    ["Top 100", 100],
  ] as const;
  const within = (d: SnapshotData, max: number) => new Set(d.keywords.filter((k) => k.position <= max).map((k) => k.keyword));
  const totals = latest.overview?.buckets;
  return bands.map(([label, max]) => {
    const now = within(latest, max);
    const before = prev ? within(prev, max) : null;
    const count = totals ? { 3: totals.top3, 10: totals.top10, 20: totals.top20, 100: totals.top100 }[max] : now.size;
    return {
      label,
      max,
      count,
      new: before ? [...now].filter((k) => !before.has(k)).length : null,
      lost: before ? [...before].filter((k) => !now.has(k)).length : null,
    };
  });
}

const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);

export type Issue = { check: string; label: string; area: "Content" | "Speed" | "Technical" | "Images"; fix: string; pages: number };
const ISSUE_INFO: Record<string, Omit<Issue, "check" | "pages">> = {
  no_title: { label: "Missing page title", area: "Content", fix: "Add a title with your service and city, under 60 characters." },
  title_too_long: { label: "Page title too long", area: "Content", fix: "Shorten to under 60 characters so Google doesn't cut it off." },
  title_too_short: { label: "Page title too short", area: "Content", fix: "Say what you do and where, e.g. \"Collision Repair in Ottawa | Acme\"." },
  duplicate_title_tag: { label: "Same title on several pages", area: "Content", fix: "Give each page its own title." },
  no_description: { label: "Missing description", area: "Content", fix: "Add a 1–2 sentence description; it's the text under your link on Google." },
  no_h1_tag: { label: "Missing main heading", area: "Content", fix: "Add one main heading that says what the page is about." },
  low_content_rate: { label: "Very little text", area: "Content", fix: "Add a few paragraphs: what you do, where, and why customers choose you." },
  high_loading_time: { label: "Slow to load", area: "Speed", fix: "Compress large photos and remove unused plugins; ask your web person." },
  has_render_blocking_resources: { label: "Scripts delay the page", area: "Speed", fix: "Ask your web person to defer non-essential scripts." },
  large_page_size: { label: "Page is very large", area: "Speed", fix: "Compress images; most pages should be under 2 MB." },
  is_broken: { label: "Page is broken", area: "Technical", fix: "Fix or redirect it; broken pages lose rankings." },
  is_http: { label: "Not secure (http)", area: "Technical", fix: "Turn on HTTPS; browsers warn visitors otherwise." },
  no_favicon: { label: "No site icon", area: "Technical", fix: "Add a small logo icon; it shows next to your result on phones." },
  no_doctype: { label: "Page code is outdated", area: "Technical", fix: "Ask your web person to fix the page's HTML structure." },
  has_meta_refresh_redirect: { label: "Old-style redirect", area: "Technical", fix: "Replace with a normal (301) redirect." },
  no_image_alt: { label: "Images without descriptions", area: "Images", fix: "Describe each photo (\"repaired bumper on a 2019 Civic\")." },
};

export function issuesFrom(audit: SnapshotData["audit"]): Issue[] {
  if (!audit) return [];
  const counts = new Map<string, number>();
  for (const p of audit.pages) for (const c of p.failed) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts]
    .flatMap(([check, pages]) => (ISSUE_INFO[check] ? [{ check, pages, ...ISSUE_INFO[check] }] : []))
    .sort((a, b) => b.pages - a.pages);
}

export type Dashboard = {
  business: { name: string; domain: string | null };
  sample: boolean;
  latest: Snapshot | null;
  overview: {
    trafficEst: number;
    trafficChange: number | null;
    keywords: number;
    keywordsChange: number | null;
    trafficValueUsd: number;
    paidKeywords: number;
  } | null;
  trafficTrend: { day: string; value: number }[];
  visibilityTrend: { day: string; value: number | null }[];
  visibilityNow: number | null;
  visibilityChange: number | null;
  buckets: Bucket[];
  topKeywords: SnapshotData["keywords"];
  local: { mapRank: number | null; reviews: number | null; rating: number | null; leaderAvgReviews: number | null; keyword: string } | null;
  ai: { searches: { keyword: string; shown: boolean | null; cited: boolean | null }[]; shown: number; cited: number };
  audit: { score: number | null; pages: number; issues: Issue[] } | null;
  actions: ActionItem[];
  notes: Record<"overview" | "position" | "keywords" | "local" | "ai" | "audit", string>;
};

function visibilitySeries(searches: SearchProgress[]): { day: string; value: number | null }[] {
  const byDay = new Map<string, (number | null)[]>();
  for (const s of searches) for (const c of s.history) byDay.set(c.day, [...(byDay.get(c.day) ?? []), c.organicRank]);
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, ps]) => ({ day, value: visibility(ps) }));
}

export function notesFor(d: Omit<Dashboard, "notes">): Dashboard["notes"] {
  const o = d.overview;
  const top10 = d.buckets.find((b) => b.max === 10);
  const near = (d.latest?.data.keywords ?? []).filter((k) => k.position >= 11 && k.position <= 20).sort((a, b) => b.searches - a.searches)[0];
  const l = d.local;
  const gap = l && l.reviews !== null && l.leaderAvgReviews !== null ? l.leaderAvgReviews - l.reviews : null;
  const worst = d.audit?.issues[0];
  return {
    overview: !o
      ? "Your first full site check runs this week."
      : o.trafficChange !== null && o.trafficChange > 0
        ? `Google is sending you more visitors than last time (${o.trafficChange}% up). Those clicks would cost about $${o.trafficValueUsd.toLocaleString("en-US")} a month as ads.`
        : `Google sends you an estimated ${o.trafficEst.toLocaleString("en-US")} visitors a month. As ads, those clicks would cost about $${o.trafficValueUsd.toLocaleString("en-US")}.${o.paidKeywords === 0 ? " You're not running Google Ads, so every one of those visits is free." : ""}`,
    position: near
      ? `You're on page 2 for "${near.keyword}" (#${near.position}, ${near.searches.toLocaleString("en-US")} searches a month). That's the quickest win: a page built for that search usually moves it to page 1.`
      : top10 && top10.count > 0
        ? `You're on page 1 for ${top10.count} searches. Keep them there with fresh reviews and up-to-date service pages.`
        : "You're not on page 1 for any search yet. Start with a page for your main service and city.",
    keywords: d.topKeywords.length
      ? `"${d.topKeywords[0].keyword}" brings you the most visitors. Make sure that page has your phone number at the top.`
      : "We'll list the searches that bring you visitors after your first site check.",
    local: !l
      ? "We'll show your Google Maps spot after your first daily check."
      : l.mapRank !== null && l.mapRank <= 3
        ? `You're #${l.mapRank} in Google Maps for "${l.keyword}", in the top 3 where most calls happen. Keep asking every customer for a review.`
        : gap !== null && gap > 0
          ? `You're ${l.mapRank === null ? "not in the top 20" : `#${l.mapRank}`} in Google Maps. The top 3 average ${gap.toLocaleString("en-US")} more reviews than you; reviews are the biggest lever here.`
          : `You're ${l.mapRank === null ? "not in the top 20" : `#${l.mapRank}`} in Google Maps. A complete Business Profile and weekly posts help you climb.`,
    ai: d.ai.searches.length === 0
      ? "We'll check Google's AI answers for your searches in the daily check."
      : d.ai.shown === 0
        ? "Google isn't showing an AI answer for your searches right now."
        : d.ai.cited === d.ai.shown
          ? `Google's AI answer mentions you for all ${d.ai.shown} searches where it appears. Clear service pages with FAQs keep it that way.`
          : `Google shows an AI answer for ${d.ai.shown} of your searches and mentions you in ${d.ai.cited}. Pages that answer common questions (price, how long, insurance) get cited more.`,
    audit: !d.audit
      ? "Your first site health check runs this week."
      : worst
        ? `Most common issue: ${worst.label.toLowerCase()} (${worst.pages} page${worst.pages === 1 ? "" : "s"}). ${worst.fix}`
        : "No issues found on the pages we checked. Nice.",
  };
}

export async function loadDashboard(tx: Tx, orgId: string): Promise<Dashboard> {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  const snapshots = await loadSnapshots(tx, orgId);
  const { searches } = await loadProgress(tx, orgId);
  const { open } = await listActions(tx, orgId);
  const latest = snapshots.at(-1) ?? null;
  const prev = snapshots.at(-2) ?? null;
  const lo = latest?.data.overview;
  const po = prev?.data.overview;
  const vis = visibilitySeries(searches);
  const weekAgo = vis.length > 7 ? vis[vis.length - 8] : vis[0];
  const main = searches[0];
  const lastChecks = searches.flatMap((s) => (s.now ? [{ keyword: s.keyword, shown: s.now.aiOverview, cited: s.now.aiCited }] : []));

  const base: Omit<Dashboard, "notes"> = {
    business: { name: (org?.name ?? "").replace(/\s*\(Demo\)$/, ""), domain: org?.websiteDomain ?? null },
    sample: Boolean(latest?.dataSource === "sandbox" || searches.some((s) => s.history.some((c) => c.dataSource === "sandbox"))),
    latest,
    overview: lo
      ? {
          trafficEst: lo.trafficEst,
          trafficChange: po ? pct(lo.trafficEst, po.trafficEst) : null,
          keywords: lo.keywords,
          keywordsChange: po ? pct(lo.keywords, po.keywords) : null,
          trafficValueUsd: lo.trafficValueUsd,
          paidKeywords: lo.paidKeywords,
        }
      : null,
    trafficTrend: snapshots.flatMap((s) => (s.data.overview ? [{ day: s.takenOn, value: s.data.overview.trafficEst }] : [])),
    visibilityTrend: vis,
    visibilityNow: vis.at(-1)?.value ?? null,
    visibilityChange: vis.length > 1 && weekAgo?.value != null && vis.at(-1)?.value != null ? Math.round((vis.at(-1)!.value! - weekAgo.value) * 10) / 10 : null,
    buckets: latest ? buckets(latest.data, prev?.data ?? null) : [],
    topKeywords: latest ? [...latest.data.keywords].sort((a, b) => b.trafficEst - a.trafficEst).slice(0, 8) : [],
    local: main?.now
      ? { keyword: main.keyword, mapRank: main.now.mapRank, reviews: main.now.reviews, rating: main.now.rating, leaderAvgReviews: main.now.leaderAvgReviews }
      : null,
    ai: {
      searches: lastChecks,
      shown: lastChecks.filter((c) => c.shown).length,
      cited: lastChecks.filter((c) => c.shown && c.cited).length,
    },
    audit: latest?.data.audit
      ? { score: latest.data.audit.score, pages: latest.data.audit.pages.length, issues: issuesFrom(latest.data.audit) }
      : null,
    actions: open.slice(0, 3),
  };
  return { ...base, notes: notesFor(base) };
}
