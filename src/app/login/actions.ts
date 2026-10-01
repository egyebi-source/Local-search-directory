"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { t } from "@/lib/i18n/en";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { signIn } from "@/server/auth";
import { googleLoginEnabled } from "@/server/auth/config";
import { claimDraft, DRAFT_COOKIE } from "@/server/onboarding/drafts";
import { clientIp } from "@/server/request";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

export type LoginState = { error?: string };

const emailSchema = z.object({
  email: z.email().max(254),
  callbackUrl: z.string().max(500).optional(),
});

export async function emailSignInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });
  if (!parsed.success) return { error: t.login.errors.invalidEmail };

  if (!(await consumeRateLimit(RATE_LIMITS.loginEmailPerIp, await clientIp()))) {
    return { error: t.login.errors.rateLimited };
  }

  const redirectTo = safeRedirectPath(parsed.data.callbackUrl);
  // Finishing sign-up: let the emailed link find these answers from any browser.
  const draft = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (redirectTo === "/onboarding/complete" && draft && /^[A-Za-z0-9_-]{43}$/.test(draft)) {
    await claimDraft(draft, parsed.data.email);
  }

  try {
    await signIn("resend", {
      email: parsed.data.email,
      redirectTo,
      redirect: false,
    });
  } catch (err) {
    unstable_rethrow(err);
    // Covers the per-address limit and provider errors without revealing which.
    return { error: t.login.errors.rateLimited };
  }
  redirect("/login/check-email");
}

export async function googleSignInAction(formData: FormData): Promise<void> {
  if (!googleLoginEnabled()) return;
  const callbackUrl = z.string().max(500).optional().parse(formData.get("callbackUrl") ?? undefined);
  await signIn("google", { redirectTo: safeRedirectPath(callbackUrl) });
}
