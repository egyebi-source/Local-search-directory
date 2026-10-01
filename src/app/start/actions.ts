"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { t } from "@/lib/i18n/en";
import { AssessmentUnavailableError } from "@/server/assessment/engine";
import { AssessmentCapacityError, AssessmentRateLimitedError, assess } from "@/server/assessment/service";
import { answersFromForm, answersSchema } from "@/server/onboarding/answers";
import { DRAFT_COOKIE, saveDraft } from "@/server/onboarding/drafts";
import { clientIp } from "@/server/request";
import { SpendCapReachedError } from "@/server/security/spend";
import { verifyTurnstile } from "@/server/security/turnstile";

export type StartState = { error?: string };

/** Home-page website box: validate, then go to the questions. No account needed. */
export async function startAssessmentAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const raw = z.string().max(253).safeParse(formData.get("website"));
  const domain = raw.success ? normalizeDomain(raw.data) : null;
  if (!domain) return { error: "Enter your website address, like yourbusiness.com" };
  redirect(`/start?website=${encodeURIComponent(domain)}`);
}

/**
 * The six questions: run the free assessment, keep the answers for 24h,
 * and show the teaser. Account creation comes after (PRD §2.1).
 */
export async function saveAnswersAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const parsed = answersSchema.safeParse(answersFromForm(formData));
  if (!parsed.success) return { error: t.start.errors.invalid };

  const ip = await clientIp();
  if (!(await verifyTurnstile(formData.get("cf-turnstile-response"), ip))) {
    return { error: t.start.errors.botCheck };
  }

  let snapshotId: string;
  try {
    snapshotId = await assess(parsed.data, ip);
  } catch (err) {
    if (err instanceof AssessmentRateLimitedError) return { error: t.start.errors.rateLimited };
    if (err instanceof AssessmentCapacityError || err instanceof SpendCapReachedError) {
      return { error: t.start.errors.busy };
    }
    if (err instanceof AssessmentUnavailableError) return { error: t.start.errors.unavailable };
    throw err;
  }

  const token = await saveDraft({ ...parsed.data, snapshotId });
  (await cookies()).set(DRAFT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  redirect(`/assessment/${snapshotId}`);
}
