import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { rankChecks, siteChanges, trackedSearches } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";

export type Check = {
  day: string;
  mapRank: number | null;
  organicRank: number | null;
  rating: number | null;
  reviews: number | null;
  leaderAvgReviews: number | null;
  dataSource: "sandbox" | "live";
};

export type SearchProgress = {
  id: string;
  keyword: string;
  country: string;
  before: Check | null;
  now: Check | null;
  history: Check[];
};

export type Change = { id: string; title: string; note: string | null; madeOn: string };

/** The check in effect on `day`: the latest one on or before it. */
export function checkOn(history: Check[], day: string): Check | null {
  let found: Check | null = null;
  for (const c of history) if (c.day <= day) found = c;
  return found;
}

/**
 * Change in a rank where lower is better. Positive = moved up. "Not found"
 * counts as position 21 (just outside the 20 we check), so appearing or
 * dropping out still shows as movement.
 */
export function rankGain(from: number | null, to: number | null): number | null {
  if (from === null && to === null) return null;
  return (from ?? 21) - (to ?? 21);
}

export function countGain(from: number | null, to: number | null): number | null {
  return from === null || to === null ? null : to - from;
}

export async function loadProgress(tx: Tx, orgId: string): Promise<{ searches: SearchProgress[]; changes: Change[] }> {
  const searches = await tx
    .select({ id: trackedSearches.id, keyword: trackedSearches.keyword, country: trackedSearches.country })
    .from(trackedSearches)
    .where(and(eq(trackedSearches.orgId, orgId), eq(trackedSearches.active, true)))
    .orderBy(asc(trackedSearches.createdAt));
  const rows = await tx
    .select()
    .from(rankChecks)
    .where(eq(rankChecks.orgId, orgId))
    .orderBy(asc(rankChecks.day));
  const changes = await tx
    .select({ id: siteChanges.id, title: siteChanges.title, note: siteChanges.note, madeOn: siteChanges.madeOn })
    .from(siteChanges)
    .where(eq(siteChanges.orgId, orgId))
    .orderBy(desc(siteChanges.madeOn), desc(siteChanges.createdAt));

  return {
    searches: searches.map((s) => {
      const history: Check[] = rows
        .filter((r) => r.trackedSearchId === s.id)
        .map((r) => ({
          day: r.day,
          mapRank: r.mapRank,
          organicRank: r.organicRank,
          rating: r.rating,
          reviews: r.reviews,
          leaderAvgReviews: r.leaderAvgReviews,
          dataSource: r.dataSource,
        }));
      return { ...s, before: history[0] ?? null, now: history.at(-1) ?? null, history };
    }),
    changes,
  };
}

export const changeSchema = z.object({
  title: z.string().trim().min(3).max(120),
  note: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || null),
  madeOn: z.iso.date(),
});

export class ChangeDateError extends Error {}

export async function addChange(
  tx: Tx,
  ctx: { orgId: string; userId: string },
  input: z.infer<typeof changeSchema>,
  now: Date = new Date(),
): Promise<void> {
  const day = new Date(`${input.madeOn}T00:00:00Z`).getTime();
  const tomorrow = now.getTime() + 24 * 60 * 60 * 1000;
  if (day > tomorrow || day < now.getTime() - 366 * 24 * 60 * 60 * 1000) throw new ChangeDateError();
  await tx.insert(siteChanges).values({ orgId: ctx.orgId, createdByUserId: ctx.userId, ...input });
}

export async function deleteChange(tx: Tx, orgId: string, id: string): Promise<void> {
  await tx.delete(siteChanges).where(and(eq(siteChanges.id, id), eq(siteChanges.orgId, orgId)));
}
