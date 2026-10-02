import "server-only";
import { and, count, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { ga4Daily, googleConnections, gscDaily, gscQueryDaily, linkedProperties, memberships, organizations, syncRuns, users } from "@/server/db/schema";
import { withSystemOrg, type Tx } from "@/server/db/tenant";
import { EmailNotConfiguredError, escapeHtml, sendEmail } from "@/server/email/send";
import { appBaseUrl } from "@/server/url";
import { ga4DailyReport, GoogleApiError, GoogleReauthError, gscDailyTotals, gscQueriesByDay, type GoogleConfig, type GoogleTransport } from "./client";
import { accessTokenFor, markNeedsReauth } from "./connection";

// Daily Google sync (PRD Module 4). Network calls happen outside database
// transactions; each org's numbers are written in one transaction under its
// own row-level security. sync_runs records what happened (never a token).

export type SyncDeps = { google: GoogleTransport; config: GoogleConfig; now?: Date };
type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

const DAY = 86_400_000;
const day = (d: Date) => d.toISOString().slice(0, 10);
const back = (now: Date, days: number) => day(new Date(now.getTime() - days * DAY));

/** Search Console keeps 16 months; we fetch it all once, then re-fetch the last 10 days (its numbers settle after 2-3 days). */
export const FIRST_GSC_DAYS = 486;
export const FIRST_QUERY_DAYS = 28;
export const FIRST_GA4_DAYS = 90;
export const ROLLING_DAYS = 10;
/** Per-search detail is kept for 120 days; daily totals are kept. */
export const QUERY_RETENTION_DAYS = 120;

export type SyncResult = { status: "ok" | "partial" | "needs_reauth" | "error"; rows: number };

async function chunks<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function syncOrg(orgId: string, deps: SyncDeps, run: Run = (fn) => withSystemOrg(orgId, fn)): Promise<SyncResult> {
  const now = deps.now ?? new Date();
  const startedAt = new Date();
  const end = back(now, 1);

  let setup: { token: string; gsc: string | null; ga4: string | null; haveGsc: boolean; haveQueries: boolean; haveGa4: boolean };
  try {
    setup = await run(async (tx) => {
      const props = await tx.select({ type: linkedProperties.type, externalId: linkedProperties.externalId }).from(linkedProperties).where(eq(linkedProperties.orgId, orgId));
      const has = async (table: typeof gscDaily | typeof gscQueryDaily | typeof ga4Daily) =>
        ((await tx.select({ n: count() }).from(table).where(eq(table.orgId, orgId)))[0]?.n ?? 0) > 0;
      return {
        token: await accessTokenFor(tx, orgId, deps.google, deps.config),
        gsc: props.find((p) => p.type === "gsc")?.externalId ?? null,
        ga4: props.find((p) => p.type === "ga4")?.externalId ?? null,
        haveGsc: await has(gscDaily),
        haveQueries: await has(gscQueryDaily),
        haveGa4: await has(ga4Daily),
      };
    });
  } catch (err) {
    if (err instanceof GoogleReauthError) {
      await run((tx) => markNeedsReauth(tx, orgId));
      await notifyReconnect(orgId, run).catch(() => undefined);
      return { status: "needs_reauth", rows: 0 };
    }
    await run((tx) => finish(tx, orgId, { error: err instanceof GoogleApiError ? err.code : "error" }));
    return { status: "error", rows: 0 };
  }

  // Fetch from Google (no transaction held open meanwhile).
  const results: { source: "gsc" | "ga4"; ok: boolean; code?: string; data?: unknown }[] = [];
  if (setup.gsc) {
    try {
      const totals = await gscDailyTotals(deps.google, setup.token, setup.gsc, back(now, setup.haveGsc ? ROLLING_DAYS : FIRST_GSC_DAYS), end);
      const queries = await gscQueriesByDay(deps.google, setup.token, setup.gsc, back(now, setup.haveQueries ? ROLLING_DAYS : FIRST_QUERY_DAYS), end);
      results.push({ source: "gsc", ok: true, data: { totals, queries } });
    } catch (err) {
      results.push({ source: "gsc", ok: false, code: err instanceof GoogleApiError ? err.code : "error" });
    }
  }
  if (setup.ga4) {
    try {
      const rows = await ga4DailyReport(deps.google, setup.token, setup.ga4, back(now, setup.haveGa4 ? ROLLING_DAYS : FIRST_GA4_DAYS), end);
      results.push({ source: "ga4", ok: true, data: rows });
    } catch (err) {
      results.push({ source: "ga4", ok: false, code: err instanceof GoogleApiError ? err.code : "error" });
    }
  }

  // Write everything for this org in one transaction.
  return run(async (tx) => {
    let total = 0;
    for (const r of results) {
      let rows = 0;
      if (r.ok && r.source === "gsc") {
        const { totals, queries } = r.data as { totals: Awaited<ReturnType<typeof gscDailyTotals>>; queries: Awaited<ReturnType<typeof gscQueriesByDay>> };
        await chunks(totals, 500, (part) =>
          tx
            .insert(gscDaily)
            .values(part.map((x) => ({ orgId, ...x })))
            .onConflictDoUpdate({
              target: [gscDaily.orgId, gscDaily.date],
              set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, ctr: sql`excluded.ctr`, position: sql`excluded.position` },
            }),
        );
        await chunks(queries, 500, (part) =>
          tx
            .insert(gscQueryDaily)
            .values(part.map((x) => ({ orgId, ...x })))
            .onConflictDoUpdate({
              target: [gscQueryDaily.orgId, gscQueryDaily.date, gscQueryDaily.query],
              set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, position: sql`excluded.position` },
            }),
        );
        await tx.delete(gscQueryDaily).where(and(eq(gscQueryDaily.orgId, orgId), lt(gscQueryDaily.date, back(now, QUERY_RETENTION_DAYS))));
        rows = totals.length + queries.length;
      } else if (r.ok && r.source === "ga4") {
        const data = r.data as Awaited<ReturnType<typeof ga4DailyReport>>;
        await chunks(data, 500, (part) =>
          tx
            .insert(ga4Daily)
            .values(part.map((x) => ({ orgId, ...x })))
            .onConflictDoUpdate({
              target: [ga4Daily.orgId, ga4Daily.date, ga4Daily.channel],
              set: { sessions: sql`excluded.sessions`, users: sql`excluded.users`, keyEvents: sql`excluded.key_events` },
            }),
        );
        rows = data.length;
      }
      total += rows;
      await tx.insert(syncRuns).values({ orgId, source: r.source, status: r.ok ? "ok" : "error", rowsUpserted: rows, errorCode: r.code ?? null, startedAt });
    }
    const failed = results.find((r) => !r.ok);
    const allFailed = results.length > 0 && results.every((r) => !r.ok);
    await finish(tx, orgId, allFailed ? { error: failed?.code ?? "error" } : { ok: true, error: failed?.code ?? null });
    return { status: allFailed ? "error" : failed ? "partial" : "ok", rows: total };
  });
}

/** Release the lease; mark today done unless everything failed (then tomorrow's run retries). */
async function finish(tx: Tx, orgId: string, r: { ok?: boolean; error: string | null }) {
  await tx
    .update(googleConnections)
    .set({ syncStartedAt: null, lastError: r.error, ...(r.ok ? { lastSyncedAt: new Date() } : {}) })
    .where(eq(googleConnections.orgId, orgId));
}

/** Email the owners once when Google stops accepting the connection (PRD FR-3.5). */
async function notifyReconnect(orgId: string, run: Run) {
  const { name, emails } = await run(async (tx) => {
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
    const owners = await tx
      .select({ email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "owner")));
    return { name: org?.name ?? "your business", emails: owners.map((o) => o.email) };
  });
  const url = `${appBaseUrl()}/app/google`;
  for (const to of emails) {
    try {
      await sendEmail({
        to,
        subject: "Reconnect your Google data to TorqueRank",
        text: `Google stopped sharing Search Console and Analytics data for ${name} with TorqueRank (this happens if access was removed or the password changed). Your dashboard keeps the numbers it already has. To start updating again, reconnect here: ${url}`,
        html: `<p>Google stopped sharing Search Console and Analytics data for <strong>${escapeHtml(name)}</strong> with TorqueRank (this happens if access was removed or the password changed).</p><p>Your dashboard keeps the numbers it already has. To start updating again, <a href="${escapeHtml(url)}">reconnect here</a>.</p>`,
      });
    } catch (err) {
      if (!(err instanceof EmailNotConfiguredError)) console.warn("[google-sync] reconnect email failed");
    }
  }
}

/** The daily job: claim a few connected orgs at a time until the time budget runs out. */
export async function runDailyGoogleSync(deps: SyncDeps, budgetMs: number) {
  const until = Date.now() + budgetMs;
  const summary = { orgs: 0, ok: 0, partial: 0, needsReauth: 0, errors: 0, rows: 0 };
  while (Date.now() < until) {
    const claimed = await getDb().execute<{ org_id: string }>(sql`SELECT google_claim_orgs_for_sync(3) AS org_id`);
    if (!claimed.rows.length) break;
    for (const { org_id } of claimed.rows) {
      const r = await syncOrg(org_id, deps).catch(() => ({ status: "error" as const, rows: 0 }));
      summary.orgs++;
      summary.rows += r.rows;
      if (r.status === "ok") summary.ok++;
      else if (r.status === "partial") summary.partial++;
      else if (r.status === "needs_reauth") summary.needsReauth++;
      else summary.errors++;
    }
  }
  return summary;
}
