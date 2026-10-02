"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { httpGemini } from "@/server/ai/gemini";
import { httpTransport } from "@/server/dataforseo/client";
import { withOrg } from "@/server/db/tenant";
import { serverEnv } from "@/server/env";
import { addTopicToActions, buildAndSavePlan, loadPlan } from "@/server/keywords/plan";
import { withCurrentOrg } from "@/server/org/current";
import { dailyCheckLimit } from "@/server/agency/agency";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";

export type PlanState = { error?: string; ok?: string };

export async function buildPlanAction(): Promise<PlanState> {
  const ctx = await withCurrentOrg(async (_tx, ctx) => ctx);
  if (!(await consumeRateLimit({ name: "keyword-plan:org", limit: await dailyCheckLimit(ctx.userId, 2), windowSeconds: 24 * 60 * 60 }, ctx.orgId))) {
    return { error: "You've used today's plan rebuilds. Try again tomorrow." };
  }
  try {
    const plan = await buildAndSavePlan(ctx.orgId, (fn) => withOrg(ctx.userId, ctx.orgId, fn), {
      dataforseo: httpTransport,
      dataSource: serverEnv().DATAFORSEO_MODE,
      gemini: serverEnv().GEMINI_API_KEY ? httpGemini : null,
    });
    if (!plan) return { error: "Add your website and type of business first." };
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: "Today's data budget is used up. Try again tomorrow." };
    console.warn("[keyword-plan] build failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't reach our data provider. Please try again later." };
  }
  revalidatePath("/app/keywords");
  return { ok: "Your keyword plan is ready." };
}

const topicSchema = z.string().trim().min(1).max(80);

export async function addTopicAction(form: FormData): Promise<void> {
  const name = topicSchema.safeParse(form.get("topic"));
  if (!name.success) return;
  await withCurrentOrg(async (tx, ctx) => {
    const current = await loadPlan(tx, ctx.orgId);
    // Look the topic up in the stored plan; never trust content sent from the browser.
    const topic = current?.plan.topics.find((t) => t.name === name.data);
    if (topic) await addTopicToActions(tx, ctx.orgId, topic);
  });
  revalidatePath("/app/keywords");
  revalidatePath("/app/actions");
}
