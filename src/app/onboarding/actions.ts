"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { t } from "@/lib/i18n/en";
import { adSpendRange, primaryGoal, websiteManager } from "@/server/db/schema";
import { createOrganization } from "@/server/db/tenant";
import { requireUser, setCurrentOrgCookie } from "@/server/org/current";

export type OnboardingState = { error?: string };

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  website: z.string().trim().min(1).max(253),
  serviceArea: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(100),
  primaryGoal: z.enum(primaryGoal.enumValues),
  adSpendRange: z.enum(adSpendRange.enumValues),
  websiteManager: z.enum(websiteManager.enumValues),
});

/** The gate (PRD §2.1 step 3): creates the org and starts the 7-day trial. */
export async function createOrganizationAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "name" ? t.onboarding.errors.name : t.onboarding.errors.required };
  }

  const websiteDomain = normalizeDomain(parsed.data.website);
  if (!websiteDomain) return { error: t.onboarding.errors.website };

  const orgId = await createOrganization(user.id, {
    name: parsed.data.name,
    websiteDomain,
    serviceArea: parsed.data.serviceArea,
    category: parsed.data.category,
    primaryGoal: parsed.data.primaryGoal,
    adSpendRange: parsed.data.adSpendRange,
    websiteManager: parsed.data.websiteManager,
  });
  await setCurrentOrgCookie(orgId);
  redirect("/app");
}
