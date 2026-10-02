import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { isOwnDomain, localVisibility, type AssessmentResult } from "@/server/assessment/result";
import { DataForSeoError, type DataForSeoTransport } from "@/server/dataforseo/client";
import { localSerp, mapsRanking } from "@/server/dataforseo/market";
import { getDb } from "@/server/db/client";
import { organizations, rankChecks, trackedSearches, type Country } from "@/server/db/schema";
import { withSystemOrg, type Tx } from "@/server/db/tenant";
import { SpendCapReachedError } from "@/server/security/spend";

// Daily progress checks (PRD Module 12): for each tracked search, where the
// business sits in Google Maps and in Google's regular results, and how its
// reviews compare with the top 3. The first row per search is the "before".

/** Each tracked search costs about $0.004/day in DataForSEO calls. */
export const TRACKED_SEARCH_LIMIT = 5;

export const keywordSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/\s+/g, " "))
  .pipe(z.string().min(3).max(80).regex(/^[\p{L}\p{N} &'.,-]+$/u, "letters, numbers and spaces only"));

const today = sql`(now() AT TIME ZONE 'UTC')::date`;

export type CheckValues = Pick<
  typeof rankChecks.$inferInsert,
  "mapRank" | "organicRank" | "rating" | "reviews" | "leaderAvgRating" | "leaderAvgReviews" | "aiOverview" | "aiCited"
>;

/** Start tracking a search with an existing measurement as its dated "before". */
export async function seedBaseline(
  tx: Tx,
  orgId: string,
  b: { keyword: string; country: Country; day: string; dataSource: "sandbox" | "live"; values: CheckValues },
): Promise<void> {
  const [search] = await tx
    .insert(trackedSearches)
    .values({ orgId, keyword: b.keyword, country: b.country })
    .onConflictDoNothing()
    .returning({ id: trackedSearches.id });
  if (!search) return;
  await tx
    .insert(rankChecks)
    .values({ orgId, trackedSearchId: search.id, day: b.day, source: "assessment", dataSource: b.dataSource, ...b.values })
    .onConflictDoNothing();
}

/** Start tracking the assessment's main search, with the assessment as its "before". */
export async function seedFromAssessment(tx: Tx, orgId: string, r: AssessmentResult): Promise<void> {
  await seedBaseline(tx, orgId, {
    keyword: r.primaryKeyword,
    country: r.country,
    day: r.generatedAt.slice(0, 10),
    dataSource: r.dataSource,
    values: {
      mapRank: r.local?.yourRank ?? null,
      // Unknown (Google errored) is not "not ranked": leave it out of the before.
      organicRank: r.metrics.googleChecked === false ? null : r.metrics.yourPosition,
      rating: r.local?.you?.rating ?? null,
      reviews: r.local?.you?.reviews ?? null,
      leaderAvgRating: r.local?.leaderAvgRating ?? null,
      leaderAvgReviews: r.local?.leaderAvgReviews ?? null,
    },
  });
}

export class TrackingLimitError extends Error {}

export async function addTrackedSearch(tx: Tx, orgId: string, keyword: string, country: Country): Promise<void> {
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(trackedSearches)
    .where(and(eq(trackedSearches.orgId, orgId), eq(trackedSearches.active, true)));
  if (n >= TRACKED_SEARCH_LIMIT) throw new TrackingLimitError();
  const [existing] = await tx
    .select({ id: trackedSearches.id })
    .from(trackedSearches)
    .where(and(eq(trackedSearches.orgId, orgId), eq(trackedSearches.keyword, keyword), eq(trackedSearches.country, country)));
  // Re-adding a search restores its history rather than starting over.
  if (existing) await tx.update(trackedSearches).set({ active: true }).where(eq(trackedSearches.id, existing.id));
  else await tx.insert(trackedSearches).values({ orgId, keyword, country });
}

export async function stopTracking(tx: Tx, orgId: string, id: string): Promise<void> {
  await tx
    .update(trackedSearches)
    .set({ active: false })
    .where(and(eq(trackedSearches.id, id), eq(trackedSearches.orgId, orgId)));
}

/** Two live lookups for one search. Failures of one half are tolerated. */
export async function lookupSearch(
  t: DataForSeoTransport,
  keyword: string,
  country: Country,
  ownDomain: string,
): Promise<CheckValues | null> {
  const [maps, serp] = await Promise.allSettled([mapsRanking(t, keyword, country), localSerp(t, keyword, country)]);
  for (const r of [maps, serp]) {
    if (r.status === "rejected" && r.reason instanceof SpendCapReachedError) throw r.reason;
  }
  if (maps.status === "rejected" && serp.status === "rejected") {
    const why = maps.reason instanceof DataForSeoError ? maps.reason.message : "lookup failed";
    console.warn("[tracking] check failed:", why);
    return null;
  }
  const organic = serp.status === "fulfilled" ? serp.value.organic : [];
  const ai = serp.status === "fulfilled" ? serp.value.aiOverview : null;
  const own = organic.find((o) => isOwnDomain(o.domain, ownDomain));
  const local = maps.status === "fulfilled" ? localVisibility(keyword, maps.value, organic, ownDomain) : null;
  return {
    mapRank: local?.yourRank ?? null,
    organicRank: own?.position ?? null,
    rating: local?.you?.rating ?? null,
    reviews: local?.you?.reviews ?? null,
    leaderAvgRating: local?.leaderAvgRating ?? null,
    leaderAvgReviews: local?.leaderAvgReviews ?? null,
    aiOverview: ai?.shown ?? null,
    aiCited: ai ? (ai.shown ? ai.citedDomains.some((d) => isOwnDomain(d, ownDomain)) : false) : null,
  };
}

export type CheckDeps = { dataforseo: DataForSeoTransport; dataSource: "sandbox" | "live" };

/**
 * Check every active search for one org that hasn't been checked today.
 * Network calls happen outside any database transaction.
 */
export async function runChecksForOrg(
  orgId: string,
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  deps: CheckDeps,
  source: "daily" | "manual",
): Promise<{ checked: number; failed: number }> {
  const plan = await run(async (tx) => {
    // Filter by id explicitly: a signed-in user can see all of their orgs.
    const [org] = await tx
      .select({ id: organizations.id, domain: organizations.websiteDomain })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!org?.domain) return null;
    const due = await tx
      .select({ id: trackedSearches.id, keyword: trackedSearches.keyword, country: trackedSearches.country })
      .from(trackedSearches)
      .where(
        and(
          eq(trackedSearches.orgId, orgId),
          eq(trackedSearches.active, true),
          sql`NOT EXISTS (SELECT 1 FROM rank_checks r WHERE r.tracked_search_id = ${trackedSearches.id} AND r.day = ${today})`,
        ),
      )
      .orderBy(asc(trackedSearches.createdAt));
    return { org: { id: org.id, domain: org.domain }, due };
  });
  if (!plan) return { checked: 0, failed: 0 };

  let checked = 0;
  let failed = 0;
  for (const s of plan.due) {
    const values = await lookupSearch(deps.dataforseo, s.keyword, s.country, plan.org.domain);
    if (!values) {
      failed++;
      continue;
    }
    await run((tx) =>
      tx
        .insert(rankChecks)
        .values({ orgId: plan.org.id, trackedSearchId: s.id, day: sql`${today}`, source, dataSource: deps.dataSource, ...values })
        .onConflictDoNothing(),
    );
    checked++;
  }
  return { checked, failed };
}

/** The daily job: work through due orgs until the time budget runs out. */
export async function runDailyChecks(deps: CheckDeps, budgetMs = 45_000, maxOrgs = 50) {
  const started = Date.now();
  const due = await getDb().execute<{ id: string }>(sql`SELECT orgs_due_for_rank_checks(${maxOrgs}) AS id`);
  let orgs = 0;
  let checked = 0;
  let failed = 0;
  for (const { id } of due.rows) {
    if (Date.now() - started > budgetMs) break;
    try {
      const r = await runChecksForOrg(id, (fn) => withSystemOrg(id, fn), deps, "daily");
      orgs++;
      checked += r.checked;
      failed += r.failed;
    } catch (err) {
      if (err instanceof SpendCapReachedError) break;
      throw err;
    }
  }
  return { due: due.rows.length, orgs, checked, failed };
}
