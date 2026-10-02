"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dismissAction, markActionDone, refreshPlan } from "@/server/actions/plan";
import { withOrg } from "@/server/db/tenant";
import { withCurrentOrg } from "@/server/org/current";
import { consumeRateLimit } from "@/server/security/rate-limit";

export type PlanState = { error?: string; ok?: string };
const idSchema = z.uuid();

export async function refreshPlanAction(): Promise<PlanState> {
  const ctx = await withCurrentOrg(async (_tx, ctx) => ctx);
  // Built from data we already have (no paid calls), so a generous limit.
  if (!(await consumeRateLimit({ name: "plan-refresh:org", limit: 10, windowSeconds: 24 * 60 * 60 }, ctx.orgId))) {
    return { error: "You've refreshed your plan a lot today. Try again tomorrow." };
  }
  const r = await refreshPlan(ctx.orgId, (fn) => withOrg(ctx.userId, ctx.orgId, fn));
  revalidatePath("/app/actions");
  return { ok: `Your plan has ${r.count} new suggestion${r.count === 1 ? "" : "s"}.` };
}

export async function markDoneAction(form: FormData): Promise<void> {
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return;
  await withCurrentOrg((tx, ctx) => markActionDone(tx, ctx, id.data));
  revalidatePath("/app/actions");
  revalidatePath("/app/progress");
}

export async function dismissActionAction(form: FormData): Promise<void> {
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return;
  await withCurrentOrg((tx, ctx) => dismissAction(tx, ctx.orgId, id.data));
  revalidatePath("/app/actions");
}
