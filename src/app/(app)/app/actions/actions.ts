"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { dismissAction, markActionDone, refreshPlan } from "@/server/actions/plan";
import { httpGemini } from "@/server/ai/gemini";
import { withOrg } from "@/server/db/tenant";
import { serverEnv } from "@/server/env";
import { withCurrentOrg } from "@/server/org/current";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";

export type PlanState = { error?: string; ok?: string };
const idSchema = z.uuid();

export async function refreshPlanAction(): Promise<PlanState> {
  const ctx = await withCurrentOrg(async (_tx, ctx) => ctx);
  if (!(await consumeRateLimit({ name: "plan-refresh:org", limit: 3, windowSeconds: 24 * 60 * 60 }, ctx.orgId))) {
    return { error: "You can refresh your plan 3 times a day. Try again tomorrow." };
  }
  try {
    const gemini = serverEnv().GEMINI_API_KEY ? httpGemini : null;
    const r = await refreshPlan(ctx.orgId, (fn) => withOrg(ctx.userId, ctx.orgId, fn), gemini);
    revalidatePath("/app/actions");
    return { ok: `Your plan has ${r.count} new suggestion${r.count === 1 ? "" : "s"}.` };
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: "Our AI writer is at today's limit. Try again tomorrow." };
    throw err;
  }
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
