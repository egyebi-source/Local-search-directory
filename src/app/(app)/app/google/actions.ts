"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withOrg } from "@/server/db/tenant";
import { authorizationUrl, GoogleApiError, GoogleReauthError, googleConfig, httpGoogle } from "@/server/google/client";
import { beginConnect, disconnect, GoogleForbiddenError, markNeedsReauth, OAUTH_COOKIE, saveProperties } from "@/server/google/connection";
import { syncOrg } from "@/server/google/sync";
import { withCurrentOrg } from "@/server/org/current";

/** Send the owner to Google's consent screen. The state and PKCE verifier go in a sealed, 10-minute cookie. */
export async function connectGoogleAction(): Promise<void> {
  const cfg = googleConfig();
  if (!cfg) redirect("/app/google?r=off");
  let started: ReturnType<typeof beginConnect>;
  try {
    started = await withCurrentOrg(async (_tx, ctx) => beginConnect(ctx), { allowLocked: false });
  } catch (err) {
    if (err instanceof GoogleForbiddenError) redirect("/app/google?r=owners");
    throw err;
  }
  (await cookies()).set(OAUTH_COOKIE, started.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/google",
    maxAge: 600,
  });
  redirect(authorizationUrl(cfg, { state: started.state, codeChallenge: started.codeChallenge }));
}

const pickSchema = z.object({
  gsc: z.string().trim().max(300).optional().transform((v) => v || null),
  ga4: z.string().trim().regex(/^(properties\/\d+)?$/).optional().transform((v) => v || null),
});

export async function savePropertiesAction(form: FormData): Promise<void> {
  const cfg = googleConfig();
  if (!cfg) redirect("/app/google?r=off");
  const pick = pickSchema.safeParse({ gsc: form.get("gsc") ?? undefined, ga4: form.get("ga4") ?? undefined });
  if (!pick.success) redirect("/app/google?r=pick");
  let reauth: { userId: string; orgId: string } | null = null;
  let saved: { userId: string; orgId: string } | null = null;
  try {
    await withCurrentOrg(async (tx, ctx) => {
      try {
        await saveProperties(tx, ctx, httpGoogle, cfg, pick.data);
        saved = { userId: ctx.userId, orgId: ctx.orgId };
      } catch (err) {
        if (err instanceof GoogleReauthError) reauth = { userId: ctx.userId, orgId: ctx.orgId };
        throw err;
      }
    });
  } catch (err) {
    if (err instanceof GoogleForbiddenError) redirect("/app/google?r=owners");
    if (err instanceof GoogleReauthError && reauth) {
      const r: { userId: string; orgId: string } = reauth;
      await withOrg(r.userId, r.orgId, (tx) => markNeedsReauth(tx, r.orgId));
      redirect("/app/google");
    }
    // A pick Google says this account can't see, or Google unavailable.
    if (err instanceof GoogleApiError) redirect("/app/google?r=pick");
    throw err;
  }
  // First fetch right after the response is sent, instead of waiting for tonight.
  const first = saved as { userId: string; orgId: string } | null;
  if (first) {
    after(async () => {
      await syncOrg(first.orgId, { google: httpGoogle, config: cfg }, (fn) => withOrg(first.userId, first.orgId, fn)).catch(() => undefined);
    });
  }
  revalidatePath("/app", "layout");
  redirect("/app/google?r=saved");
}

export async function disconnectGoogleAction(form: FormData): Promise<void> {
  const deleteData = form.get("deleteData") === "on";
  try {
    await withCurrentOrg((tx, ctx) => disconnect(tx, ctx, httpGoogle, deleteData), { allowLocked: true });
  } catch (err) {
    if (err instanceof GoogleForbiddenError) redirect("/app/google?r=owners");
    throw err;
  }
  revalidatePath("/app", "layout");
  redirect("/app/google?r=disconnected");
}
