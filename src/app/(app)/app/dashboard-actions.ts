"use server";

import { revalidatePath } from "next/cache";
import { snapshotOrg } from "@/server/dashboard/snapshot";
import { httpTransport } from "@/server/dataforseo/client";
import { refreshPlan } from "@/server/actions/plan";
import { withOrg, type Tx } from "@/server/db/tenant";
import { serverEnv } from "@/server/env";
import { withCurrentOrg } from "@/server/org/current";
import { dailyCheckLimit } from "@/server/agency/agency";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";

export type SnapshotState = { error?: string };

/** Build the dashboard now instead of waiting for the weekly job (2 per day per business). */
export async function snapshotNowAction(): Promise<SnapshotState> {
  const ctx = await withCurrentOrg(async (_tx, ctx) => ctx);
  if (!(await consumeRateLimit({ name: "snapshot:org", limit: await dailyCheckLimit(ctx.userId, 2), windowSeconds: 24 * 60 * 60 }, ctx.orgId))) {
    return { error: "You've used today's dashboard refreshes. Try again tomorrow." };
  }
  try {
    const run = <T,>(fn: (tx: Tx) => Promise<T>) => withOrg(ctx.userId, ctx.orgId, fn);
    await snapshotOrg(ctx.orgId, run, { dataforseo: httpTransport, dataSource: serverEnv().DATAFORSEO_MODE });
    await refreshPlan(ctx.orgId, run);
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: "Today's data budget is used up. Your dashboard will refresh tomorrow." };
    console.warn("[snapshot] manual failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't reach our data provider. Please try again later." };
  }
  revalidatePath("/app");
  revalidatePath("/app/actions");
  return {};
}
