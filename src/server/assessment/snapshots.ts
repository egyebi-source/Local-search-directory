import "server-only";
import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { publicSnapshots } from "@/server/db/schema";
import type { Answers } from "@/server/onboarding/answers";
import { randomToken, sha256Hex } from "@/server/security/hash";
import { primaryKeyword, type AssessmentResult } from "./result";

export const REUSE_DAYS = 7;
export const SNAPSHOT_TTL_DAYS = 30;
const DAY_MS = 86_400_000;
const ID = /^[A-Za-z0-9_-]{43}$/;

/** Sample (sandbox) and real results never share a cache entry. */
export function cacheKeyFor(a: Answers, dataSource: "sandbox" | "live"): string {
  return sha256Hex(
    // v2: results before the "searched phrase" choice and the googleChecked flag are never reused.
    ["v2", dataSource, a.website, a.countries.join(","), primaryKeyword(a.category, a.serviceArea, a.reach), a.goals.join(",")].join("|"),
  );
}

/** A result for the same site, market and goal from the last 7 days, if any. */
export async function findReusable(cacheKey: string): Promise<AssessmentResult | null> {
  const [row] = await getDb()
    .select({ result: publicSnapshots.resultJson })
    .from(publicSnapshots)
    .where(
      and(
        eq(publicSnapshots.cacheKey, cacheKey),
        gt(publicSnapshots.createdAt, sql`now() - make_interval(days => ${REUSE_DAYS})`),
        gt(publicSnapshots.expiresAt, sql`now()`),
        // A result where Google couldn't be checked is not worth reusing: try again.
        sql`(${publicSnapshots.resultJson} -> 'metrics' ->> 'googleChecked') IS DISTINCT FROM 'false'`,
      ),
    )
    .orderBy(desc(publicSnapshots.createdAt))
    .limit(1);
  return (row?.result as AssessmentResult | undefined) ?? null;
}

/** Store a result under a new unguessable id (32 random bytes). */
export async function createSnapshot(result: AssessmentResult, cacheKey: string, ip: string): Promise<string> {
  const db = getDb();
  await db.delete(publicSnapshots).where(lt(publicSnapshots.expiresAt, sql`now()`));
  const id = randomToken();
  await db.insert(publicSnapshots).values({
    id,
    cacheKey,
    domain: result.domain,
    country: result.country,
    resultJson: result as unknown as Record<string, unknown>,
    ipHash: sha256Hex(`ip:${ip}`),
    expiresAt: new Date(Date.now() + SNAPSHOT_TTL_DAYS * DAY_MS),
  });
  return id;
}

export async function getSnapshot(id: string): Promise<AssessmentResult | null> {
  if (!ID.test(id)) return null;
  const [row] = await getDb()
    .select({ result: publicSnapshots.resultJson })
    .from(publicSnapshots)
    .where(and(eq(publicSnapshots.id, id), gt(publicSnapshots.expiresAt, sql`now()`)));
  return (row?.result as AssessmentResult | undefined) ?? null;
}
