"use server";

import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { signIn } from "@/server/auth";
import { emailMatchesDomain, isClaimToken, lookupClaim, optOut } from "@/server/campaigns/campaigns";
import { CLAIM_COOKIE } from "@/server/campaigns/claim-cookie";
import { clientIp } from "@/server/request";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

export type ClaimState = { error?: string };

/** Step 1 of a claim: prove you work there with an email at the business's own domain. */
export async function startClaimAction(_prev: ClaimState, form: FormData): Promise<ClaimState> {
  const token = form.get("token");
  const email = z.email().max(254).safeParse(form.get("email"));
  if (!isClaimToken(token)) return { error: "This link isn't valid anymore." };
  if (!email.success) return { error: "Enter a valid email address." };
  if (!(await consumeRateLimit(RATE_LIMITS.loginEmailPerIp, await clientIp()))) {
    return { error: "Too many attempts. Please try again in an hour." };
  }
  const claim = await lookupClaim(token);
  if (!claim) return { error: "This link isn't valid anymore." };
  if (claim.status === "claimed") return { error: "This business has already been claimed. Sign in with the email used to claim it." };
  if (!emailMatchesDomain(email.data, claim.domain)) {
    return { error: `To protect ${claim.businessName}, use an email address ending in @${claim.domain}.` };
  }
  (await cookies()).set(CLAIM_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  try {
    await signIn("resend", { email: email.data, redirectTo: "/claim/complete", redirect: false });
  } catch (err) {
    unstable_rethrow(err);
    return { error: "Too many attempts. Please try again in an hour." };
  }
  redirect("/login/check-email");
}

/** "Not interested": delete this business's report and never contact it again. */
export async function optOutAction(form: FormData): Promise<void> {
  const token = form.get("token");
  if (isClaimToken(token)) {
    const claim = await lookupClaim(token);
    if (claim) await optOut(token, claim.domain);
  }
  redirect("/claim/removed");
}
