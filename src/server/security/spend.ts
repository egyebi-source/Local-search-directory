import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { apiSpendDaily } from "@/server/db/schema";
import { serverEnv } from "@/server/env";

export type Provider = "dataforseo" | "gemini";

/** Thrown when today's spend cap for a provider is reached (PRD FR-1.6). */
export class SpendCapReachedError extends Error {
  constructor(public readonly provider: Provider) {
    super(`Daily spend cap reached for ${provider}`);
  }
}

const today = sql`(now() AT TIME ZONE 'UTC')::date`;

function capMicros(provider: Provider): number {
  const env = serverEnv();
  const cents = provider === "dataforseo" ? env.DAILY_SPEND_CAP_DATAFORSEO_CENTS : env.DAILY_SPEND_CAP_GEMINI_CENTS;
  return cents * 10_000;
}

export async function spentTodayMicros(provider: Provider): Promise<number> {
  const [row] = await getDb()
    .select({ micros: apiSpendDaily.micros })
    .from(apiSpendDaily)
    .where(and(eq(apiSpendDaily.day, today), eq(apiSpendDaily.provider, provider)));
  return Number(row?.micros ?? 0);
}

/** Refuse to start a paid call once today's cap is reached. */
export async function assertUnderCap(provider: Provider): Promise<void> {
  if ((await spentTodayMicros(provider)) >= capMicros(provider)) {
    console.warn(`[spend-cap] ${provider} daily cap reached`);
    throw new SpendCapReachedError(provider);
  }
}

/** Add what a call actually cost (in USD) to today's total. */
export async function recordSpend(provider: Provider, usd: number): Promise<void> {
  const micros = Math.max(0, Math.round(usd * 1_000_000));
  if (micros === 0) return;
  await getDb()
    .insert(apiSpendDaily)
    .values({ day: today, provider, micros })
    .onConflictDoUpdate({
      target: [apiSpendDaily.day, apiSpendDaily.provider],
      set: { micros: sql`${apiSpendDaily.micros} + ${micros}` },
    });
}
