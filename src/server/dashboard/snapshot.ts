import "server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import type { DataForSeoTransport } from "@/server/dataforseo/client";
import { auditPage, domainOverview, siteKeywords, type PageAudit } from "@/server/dataforseo/market";
import { getDb } from "@/server/db/client";
import { organizations, seoSnapshots, type Country } from "@/server/db/schema";
import { withSystemOrg, type Tx } from "@/server/db/tenant";
import { SpendCapReachedError } from "@/server/security/spend";

// Weekly whole-site snapshot for the SEO dashboard. About 5–7 DataForSEO
// calls per business per week (overview, keyword list, a few page checks).

const kw = z.object({
  keyword: z.string().max(120),
  position: z.number().int().min(1).max(100),
  searches: z.number().min(0),
  cpcUsd: z.number().min(0),
  url: z.string().max(2048).nullable(),
  trafficEst: z.number().min(0),
});

export const snapshotSchema = z.object({
  overview: z
    .object({
      trafficEst: z.number().min(0),
      keywords: z.number().min(0),
      trafficValueUsd: z.number().min(0),
      paidKeywords: z.number().min(0),
      buckets: z.object({ top3: z.number(), top10: z.number(), top20: z.number(), top100: z.number() }),
    })
    .nullable(),
  keywords: z.array(kw).max(300),
  audit: z
    .object({
      score: z.number().min(0).max(100).nullable(),
      pages: z
        .array(
          z.object({
            url: z.string().max(2048),
            score: z.number().nullable(),
            failed: z.array(z.string().max(60)).max(40),
            title: z.string().max(300).nullable().optional(),
            h1: z.string().max(300).nullable().optional(),
          }),
        )
        .max(10),
    })
    .nullable(),
});
export type SnapshotData = z.infer<typeof snapshotSchema>;
export type Snapshot = { takenOn: string; dataSource: "sandbox" | "live"; data: SnapshotData };

/** Pages to check: the homepage plus the site's best-ranking pages, on its own domain only. */
export function pagesToAudit(domain: string, keywords: SnapshotData["keywords"], max = 5): string[] {
  const urls = [`https://${domain}/`];
  for (const k of keywords) {
    if (urls.length >= max || !k.url) continue;
    try {
      const u = new URL(k.url);
      const host = normalizeDomain(u.hostname);
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      if (host !== domain) continue;
      const clean = `https://${u.hostname}${u.pathname}`;
      if (!urls.includes(clean)) urls.push(clean);
    } catch {
      // ignore malformed URLs
    }
  }
  return urls;
}

export async function takeSnapshot(t: DataForSeoTransport, domain: string, country: Country): Promise<SnapshotData> {
  const [overview, keywords] = await Promise.all([
    domainOverview(t, domain, country).catch(rethrowCap),
    siteKeywords(t, domain, country).catch((e) => (rethrowCap(e), [])),
  ]);
  const pages: PageAudit[] = [];
  for (const url of pagesToAudit(domain, keywords ?? [])) {
    const p = await auditPage(t, url).catch(rethrowCap);
    if (p) pages.push(p);
  }
  const scores = pages.flatMap((p) => (p.score === null ? [] : [p.score]));
  return snapshotSchema.parse({
    overview: overview ?? null,
    keywords: (keywords ?? []).slice(0, 300),
    audit: pages.length ? { score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, pages } : null,
  });
}

function rethrowCap(err: unknown): null {
  if (err instanceof SpendCapReachedError) throw err;
  return null;
}

export async function saveSnapshot(tx: Tx, orgId: string, dataSource: "sandbox" | "live", data: SnapshotData): Promise<void> {
  await tx
    .insert(seoSnapshots)
    .values({ orgId, takenOn: sql`(now() AT TIME ZONE 'UTC')::date`, dataSource, data })
    .onConflictDoNothing();
}

export async function snapshotOrg(
  orgId: string,
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  deps: { dataforseo: DataForSeoTransport; dataSource: "sandbox" | "live" },
): Promise<boolean> {
  const org = await run(async (tx) => (await tx.select().from(organizations).where(eq(organizations.id, orgId)))[0]);
  if (!org?.websiteDomain) return false;
  const data = await takeSnapshot(deps.dataforseo, org.websiteDomain, (org.country ?? "CA") as Country);
  await run((tx) => saveSnapshot(tx, orgId, deps.dataSource, data));
  return true;
}

/** Part of the daily job: refresh dashboards that are a week old. */
export async function runWeeklySnapshots(
  deps: { dataforseo: DataForSeoTransport; dataSource: "sandbox" | "live" },
  budgetMs = 20_000,
  maxOrgs = 20,
) {
  const started = Date.now();
  const due = await getDb().execute<{ id: string }>(sql`SELECT orgs_due_for_seo_snapshot(${maxOrgs}) AS id`);
  let done = 0;
  for (const { id } of due.rows) {
    if (Date.now() - started > budgetMs) break;
    try {
      if (await snapshotOrg(id, (fn) => withSystemOrg(id, fn), deps)) done++;
    } catch (err) {
      if (err instanceof SpendCapReachedError) break;
      console.warn("[snapshot] failed:", err instanceof Error ? err.name : "unknown");
    }
  }
  return { due: due.rows.length, done };
}

/** All snapshots, oldest first; each re-validated (stored data is never trusted blindly). */
export async function loadSnapshots(tx: Tx, orgId: string): Promise<Snapshot[]> {
  const rows = await tx.select().from(seoSnapshots).where(eq(seoSnapshots.orgId, orgId)).orderBy(asc(seoSnapshots.takenOn));
  return rows.flatMap((r) => {
    const parsed = snapshotSchema.safeParse(r.data);
    return parsed.success ? [{ takenOn: r.takenOn, dataSource: r.dataSource, data: parsed.data }] : [];
  });
}

export async function latestSnapshotDay(tx: Tx, orgId: string): Promise<string | null> {
  const [r] = await tx.select({ d: seoSnapshots.takenOn }).from(seoSnapshots).where(eq(seoSnapshots.orgId, orgId)).orderBy(desc(seoSnapshots.takenOn)).limit(1);
  return r?.d ?? null;
}
