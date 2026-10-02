"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/admin/guard";
import { campaignInputSchema, createCampaign } from "@/server/campaigns/campaigns";
import { httpTransport } from "@/server/dataforseo/client";
import { serverEnv } from "@/server/env";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";

export type CampaignState = { error?: string };

export async function createCampaignAction(_prev: CampaignState, form: FormData): Promise<CampaignState> {
  const admin = await requireAdmin();
  const parsed = campaignInputSchema.safeParse({ category: form.get("category"), city: form.get("city"), country: form.get("country") });
  if (!parsed.success) return { error: "Enter a business type (3–60 characters), a city and a country." };
  if (!(await consumeRateLimit({ name: "admin-campaign", limit: 20, windowSeconds: 24 * 60 * 60 }, admin.id))) {
    return { error: "That's 20 campaigns today. Try again tomorrow." };
  }
  let id: string;
  try {
    const r = await createCampaign(admin.id, parsed.data, { dataforseo: httpTransport, dataSource: serverEnv().DATAFORSEO_MODE });
    id = r.campaignId;
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: "Today's data budget is used up. Try again tomorrow." };
    console.warn("[campaign] create failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't reach our data provider. Try again in a few minutes." };
  }
  redirect(`/admin/campaigns/${id}`);
}
