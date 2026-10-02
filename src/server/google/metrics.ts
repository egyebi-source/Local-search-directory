import "server-only";
import { and, desc, eq, gte, lte, max, sql } from "drizzle-orm";
import { ga4Daily, gscDaily, gscQueryDaily } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";
import { loadConnection, type ConnectionView } from "./connection";

// The organization's own Google numbers for the dashboard (PRD Module 5).
// Windows end on the latest day Google has reported (Search Console runs
// 2-3 days behind), and compare with the 28 days before that.

export type QueryRow = { query: string; clicks: number; impressions: number; ctr: number; position: number };

export type GoogleData = {
  connection: ConnectionView | null;
  stale: boolean;
  gsc: {
    through: string;
    clicks: number;
    clicksChange: number | null;
    impressions: number;
    impressionsChange: number | null;
    ctr: number;
    position: number | null;
    /** Places gained (+) or lost (−) in average position vs the 28 days before. */
    positionChange: number | null;
    trend: { day: string; clicks: number; impressions: number }[];
    topQueries: QueryRow[];
    /** Searches where you're seen often but sit just off the top spots: the quickest wins. */
    almostThere: QueryRow[];
  } | null;
  ga4: {
    through: string;
    sessions: number;
    sessionsChange: number | null;
    keyEvents: number;
    keyEventsChange: number | null;
    organicSessions: number;
    organicShare: number | null;
    channels: { channel: string; sessions: number }[];
    trend: { day: string; sessions: number; organic: number }[];
  } | null;
};

const DAY = 86_400_000;
const shift = (d: string, days: number) => new Date(Date.parse(`${d}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const pctChange = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const round1 = (n: number) => Math.round(n * 10) / 10;

export async function loadGoogleData(tx: Tx, orgId: string, now: Date = new Date()): Promise<GoogleData> {
  const connection = await loadConnection(tx, orgId);
  const stale = Boolean(connection?.lastSyncedAt && now.getTime() - connection.lastSyncedAt.getTime() > 48 * 3600_000);
  return { connection, stale, gsc: await loadGsc(tx, orgId), ga4: await loadGa4(tx, orgId) };
}

async function loadGsc(tx: Tx, orgId: string): Promise<GoogleData["gsc"]> {
  const [{ last }] = await tx.select({ last: max(gscDaily.date) }).from(gscDaily).where(eq(gscDaily.orgId, orgId));
  if (!last) return null;
  const from = shift(last, -27);
  const prevFrom = shift(last, -55);
  const prevTo = shift(last, -28);
  const window = async (a: string, b: string) => {
    const [r] = await tx
      .select({
        clicks: sql<number>`coalesce(sum(${gscDaily.clicks}), 0)::int`,
        impressions: sql<number>`coalesce(sum(${gscDaily.impressions}), 0)::int`,
        // Impression-weighted average position, as Search Console shows it.
        position: sql<number | null>`sum(${gscDaily.position} * ${gscDaily.impressions}) / nullif(sum(${gscDaily.impressions}), 0)`,
      })
      .from(gscDaily)
      .where(and(eq(gscDaily.orgId, orgId), gte(gscDaily.date, a), lte(gscDaily.date, b)));
    return { clicks: Number(r.clicks), impressions: Number(r.impressions), position: r.position === null ? null : Number(r.position) };
  };
  const cur = await window(from, last);
  const prev = await window(prevFrom, prevTo);
  const trend = await tx
    .select({ day: gscDaily.date, clicks: gscDaily.clicks, impressions: gscDaily.impressions })
    .from(gscDaily)
    .where(and(eq(gscDaily.orgId, orgId), gte(gscDaily.date, shift(last, -89))))
    .orderBy(gscDaily.date);

  const queries = await tx
    .select({
      query: gscQueryDaily.query,
      clicks: sql<number>`sum(${gscQueryDaily.clicks})::int`,
      impressions: sql<number>`sum(${gscQueryDaily.impressions})::int`,
      position: sql<number>`sum(${gscQueryDaily.position} * ${gscQueryDaily.impressions}) / nullif(sum(${gscQueryDaily.impressions}), 0)`,
    })
    .from(gscQueryDaily)
    .where(and(eq(gscQueryDaily.orgId, orgId), gte(gscQueryDaily.date, from), lte(gscQueryDaily.date, last)))
    .groupBy(gscQueryDaily.query)
    .orderBy(desc(sql`sum(${gscQueryDaily.impressions})`))
    .limit(500);
  const rows: QueryRow[] = queries.map((q) => {
    const impressions = Number(q.impressions);
    const clicks = Number(q.clicks);
    return { query: q.query, clicks, impressions, ctr: impressions ? round1((clicks / impressions) * 100) : 0, position: round1(Number(q.position ?? 0)) };
  });

  return {
    through: last,
    clicks: cur.clicks,
    clicksChange: pctChange(cur.clicks, prev.clicks),
    impressions: cur.impressions,
    impressionsChange: pctChange(cur.impressions, prev.impressions),
    ctr: cur.impressions ? round1((cur.clicks / cur.impressions) * 100) : 0,
    position: cur.position === null ? null : round1(cur.position),
    positionChange: cur.position !== null && prev.position !== null ? round1(prev.position - cur.position) : null,
    trend: trend.map((t) => ({ day: t.day, clicks: t.clicks, impressions: t.impressions })),
    topQueries: [...rows].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10),
    almostThere: almostThere(rows),
  };
}

/** Seen at least 20 times, average position 4-20: a better title or page could move these into the top 3. */
export function almostThere(rows: QueryRow[]): QueryRow[] {
  return rows
    .filter((r) => r.impressions >= 20 && r.position >= 4 && r.position <= 20)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 5);
}

async function loadGa4(tx: Tx, orgId: string): Promise<GoogleData["ga4"]> {
  const [{ last }] = await tx.select({ last: max(ga4Daily.date) }).from(ga4Daily).where(eq(ga4Daily.orgId, orgId));
  if (!last) return null;
  const from = shift(last, -27);
  const sum = async (a: string, b: string) => {
    const [r] = await tx
      .select({
        sessions: sql<number>`coalesce(sum(${ga4Daily.sessions}), 0)::int`,
        keyEvents: sql<number>`coalesce(sum(${ga4Daily.keyEvents}), 0)`,
        organic: sql<number>`coalesce(sum(${ga4Daily.sessions}) FILTER (WHERE ${ga4Daily.channel} = 'Organic Search'), 0)::int`,
      })
      .from(ga4Daily)
      .where(and(eq(ga4Daily.orgId, orgId), gte(ga4Daily.date, a), lte(ga4Daily.date, b)));
    return { sessions: Number(r.sessions), keyEvents: Math.round(Number(r.keyEvents)), organic: Number(r.organic) };
  };
  const cur = await sum(from, last);
  const prev = await sum(shift(last, -55), shift(last, -28));
  const channels = await tx
    .select({ channel: ga4Daily.channel, sessions: sql<number>`sum(${ga4Daily.sessions})::int` })
    .from(ga4Daily)
    .where(and(eq(ga4Daily.orgId, orgId), gte(ga4Daily.date, from), lte(ga4Daily.date, last)))
    .groupBy(ga4Daily.channel)
    .orderBy(desc(sql`sum(${ga4Daily.sessions})`))
    .limit(6);
  const trend = await tx
    .select({
      day: ga4Daily.date,
      sessions: sql<number>`sum(${ga4Daily.sessions})::int`,
      organic: sql<number>`coalesce(sum(${ga4Daily.sessions}) FILTER (WHERE ${ga4Daily.channel} = 'Organic Search'), 0)::int`,
    })
    .from(ga4Daily)
    .where(and(eq(ga4Daily.orgId, orgId), gte(ga4Daily.date, shift(last, -89))))
    .groupBy(ga4Daily.date)
    .orderBy(ga4Daily.date);
  return {
    through: last,
    sessions: cur.sessions,
    sessionsChange: pctChange(cur.sessions, prev.sessions),
    keyEvents: cur.keyEvents,
    keyEventsChange: pctChange(cur.keyEvents, prev.keyEvents),
    organicSessions: cur.organic,
    organicShare: cur.sessions ? Math.round((cur.organic / cur.sessions) * 100) : null,
    channels: channels.map((c) => ({ channel: c.channel, sessions: Number(c.sessions) })),
    trend: trend.map((t) => ({ day: t.day, sessions: Number(t.sessions), organic: Number(t.organic) })),
  };
}

/** One plain-English note for the dashboard panel. */
export function googleNote(g: GoogleData): string {
  if (!g.gsc && !g.ga4) return "Once connected, this shows the real clicks Google sends you and what people do on your site, straight from your own Google accounts.";
  const parts: string[] = [];
  if (g.gsc) {
    const dir = g.gsc.clicksChange === null ? "" : g.gsc.clicksChange >= 0 ? `, up ${g.gsc.clicksChange}%` : `, down ${Math.abs(g.gsc.clicksChange)}%`;
    parts.push(`Google sent you ${g.gsc.clicks.toLocaleString("en-US")} clicks in the last 28 days${dir}.`);
    const a = g.gsc.almostThere[0];
    if (a) parts.push(`"${a.query}" is your quickest win: seen ${a.impressions.toLocaleString("en-US")} times at about #${Math.round(a.position)}. A page and title that match it can move it into the top 3.`);
  }
  if (g.ga4 && g.ga4.keyEvents > 0) parts.push(`Your site recorded ${g.ga4.keyEvents.toLocaleString("en-US")} key actions (calls, forms, bookings) in that time.`);
  else if (g.ga4) parts.push("GA4 shows no key events yet: mark your call button and contact form as key events in GA4 so you can see leads, not just visits.");
  return parts.join(" ");
}
