"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/admin/guard";
import { analyzeProspect, CHANNELS, emailDraft, loadProspect, markContacted, newClaimLink } from "@/server/campaigns/outreach";
import { httpTransport } from "@/server/dataforseo/client";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";

const ids = z.object({ campaignId: z.uuid(), prospectId: z.uuid() });
const pathOf = (v: z.infer<typeof ids>) => `/admin/campaigns/${v.campaignId}/p/${v.prospectId}`;

export type AnalyzeState = { error?: string };

export async function analyzeAction(_prev: AnalyzeState, form: FormData): Promise<AnalyzeState> {
  const admin = await requireAdmin();
  const v = ids.safeParse({ campaignId: form.get("campaignId"), prospectId: form.get("prospectId") });
  if (!v.success) return { error: "Unknown business." };
  if (!(await consumeRateLimit({ name: "admin-analyze", limit: 150, windowSeconds: 24 * 60 * 60 }, admin.id))) {
    return { error: "That's 150 checks today. Try again tomorrow." };
  }
  try {
    const p = await analyzeProspect(admin.id, v.data.prospectId, { dataforseo: httpTransport });
    if (!p) return { error: "Unknown business." };
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: "Today's data budget is used up. Try again tomorrow." };
    console.warn("[campaign] analyze failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't finish the check. Try again in a few minutes." };
  }
  revalidatePath(pathOf(v.data));
  return {};
}

export type DraftState = { error?: string; link?: string; subject?: string; body?: string };

/** A fresh private link and an email draft with it. The previous link for this business stops working. */
export async function draftAction(_prev: DraftState, form: FormData): Promise<DraftState> {
  const admin = await requireAdmin();
  const v = ids.safeParse({ campaignId: form.get("campaignId"), prospectId: form.get("prospectId") });
  if (!v.success) return { error: "Unknown business." };
  if (!(await consumeRateLimit({ name: "admin-action", limit: 50, windowSeconds: 60 * 60 }, admin.id))) return { error: "Too many actions. Try again in an hour." };
  const p = await loadProspect(admin.id, v.data.prospectId);
  if (!p) return { error: "Unknown business." };
  if (p.status === "claimed") return { error: "This business already claimed its report." };
  const link = await newClaimLink(admin.id, p.id);
  if (!link) return { error: "Unknown business." };
  return { link, ...emailDraft(p, link) };
}

export async function contactedAction(form: FormData): Promise<void> {
  const admin = await requireAdmin();
  const v = ids.safeParse({ campaignId: form.get("campaignId"), prospectId: form.get("prospectId") });
  const channel = z.enum(CHANNELS).safeParse(form.get("channel"));
  if (!v.success || !channel.success) return;
  await markContacted(admin.id, v.data.prospectId, channel.data);
  revalidatePath(pathOf(v.data));
  revalidatePath(`/admin/campaigns/${v.data.campaignId}`);
}
