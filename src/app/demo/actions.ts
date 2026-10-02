"use server";

import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createDemoSession, demoClaimToken, demoEnabled, type DemoRole } from "@/server/demo/demo";

async function enter(role: DemoRole, to: string): Promise<never> {
  if (!demoEnabled()) notFound();
  const session = await createDemoSession(role);
  if (!session) redirect("/demo?missing=1");
  // Same cookie name Auth.js uses: the "__Secure-" one exactly when the site is served over https.
  const proto = (await headers()).get("x-forwarded-proto");
  const secure = proto ? proto === "https" : (process.env.AUTH_URL ?? "").startsWith("https:");
  (await cookies()).set(secure ? "__Secure-authjs.session-token" : "authjs.session-token", session.token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: session.expires,
  });
  redirect(to);
}

export async function enterAsOwnerAction(): Promise<void> {
  await enter("owner", "/app/progress");
}

export async function enterAsAdminAction(): Promise<void> {
  await enter("admin", "/admin");
}

export async function enterAsAgencyAction(): Promise<void> {
  await enter("agency", "/agency");
}

export async function openClaimPageAction(): Promise<void> {
  if (!demoEnabled()) notFound();
  const token = await demoClaimToken();
  redirect(token ? `/claim/${token}` : "/demo?missing=1");
}
