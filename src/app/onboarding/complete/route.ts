import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { getSnapshot } from "@/server/assessment/snapshots";
import { createOrganization } from "@/server/db/tenant";
import { consumeDraft, DRAFT_COOKIE } from "@/server/onboarding/drafts";
import { setCurrentOrgCookie } from "@/server/org/current";

export const dynamic = "force-dynamic";

/**
 * Where sign-in lands after the questions: turns the visitor's saved answers
 * into their organization (starting the 7-day trial) and opens the dashboard.
 * Only ever uses the caller's own draft cookie.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(`/login?callbackUrl=${encodeURIComponent("/onboarding/complete")}`);

  const jar = await cookies();
  const token = jar.get(DRAFT_COOKIE)?.value;
  jar.delete(DRAFT_COOKIE);
  const answers = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? await consumeDraft(token) : null;
  if (!answers) redirect("/start");

  // Copy the assessment they saw into their (row-level-secured) org data.
  const snapshot = answers.snapshotId ? await getSnapshot(answers.snapshotId) : null;
  const orgId = await createOrganization(
    userId,
    {
      name: answers.name,
      websiteDomain: answers.website,
      serviceArea: answers.serviceArea,
      category: answers.category,
      primaryGoal: answers.primaryGoal,
      adSpendRange: answers.adSpendRange,
      websiteManager: answers.websiteManager,
      country: answers.country,
    },
    snapshot ? { assessment: snapshot as unknown as Record<string, unknown> } : undefined,
  );
  await setCurrentOrgCookie(orgId);
  redirect("/app");
}
