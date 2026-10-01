"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { t } from "@/lib/i18n/en";
import { createOrganization } from "@/server/db/tenant";
import { requireUser, setCurrentOrgCookie } from "@/server/org/current";

export type OnboardingState = { error?: string };

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  website: optionalText(253),
  serviceArea: optionalText(100),
  category: optionalText(100),
});

export async function createOrganizationAction(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    name: formData.get("name") ?? "",
    website: formData.get("website") ?? "",
    serviceArea: formData.get("serviceArea") ?? "",
    category: formData.get("category") ?? "",
  });
  if (!parsed.success) return { error: t.onboarding.errors.name };

  let websiteDomain: string | null = null;
  if (parsed.data.website) {
    websiteDomain = normalizeDomain(parsed.data.website);
    if (!websiteDomain) return { error: t.onboarding.errors.website };
  }

  const orgId = await createOrganization(user.id, {
    name: parsed.data.name,
    websiteDomain,
    serviceArea: parsed.data.serviceArea,
    category: parsed.data.category,
  });
  await setCurrentOrgCookie(orgId);
  redirect("/app");
}
