"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { t } from "@/lib/i18n/en";
import { auth } from "@/server/auth";
import { answersSchema } from "@/server/onboarding/answers";
import { DRAFT_COOKIE, saveDraft } from "@/server/onboarding/drafts";
import { clientIp } from "@/server/request";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

export type StartState = { error?: string };

const COMPLETE_PATH = "/onboarding/complete";

/** Home-page website box: validate, then go to the questions. No account needed. */
export async function startAssessmentAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const raw = z.string().max(253).safeParse(formData.get("website"));
  const domain = raw.success ? normalizeDomain(raw.data) : null;
  if (!domain) return { error: "Enter your website address, like yourbusiness.com" };
  redirect(`/start?website=${encodeURIComponent(domain)}`);
}

/** The six questions: stored server-side for 24h, then sign-up is the last step. */
export async function saveAnswersAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const parsed = answersSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: t.start.errors.invalid };

  if (!(await consumeRateLimit(RATE_LIMITS.draftPerIp, await clientIp()))) {
    return { error: t.start.errors.rateLimited };
  }

  const token = await saveDraft(parsed.data);
  (await cookies()).set(DRAFT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });

  if ((await auth())?.user) redirect(COMPLETE_PATH);
  redirect(`/login?callbackUrl=${encodeURIComponent(COMPLETE_PATH)}`);
}
