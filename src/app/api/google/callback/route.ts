import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/server/auth";
import { NotMemberError, withOrg } from "@/server/db/tenant";
import { googleConfig, httpGoogle } from "@/server/google/client";
import { checkState, completeConnect, GoogleForbiddenError, NoRefreshTokenError, NoScopesError, OAUTH_COOKIE } from "@/server/google/connection";
import { setCurrentOrgCookie } from "@/server/org/current";
import { appBaseUrl } from "@/server/url";

export const dynamic = "force-dynamic";

// Where Google sends the owner back after the consent screen (PRD FR-3.1).
// Checks, in order: signed in, the sealed state cookie from this browser
// (unexpired, same user, matching state), still an owner of that org. The
// code and tokens never appear in logs or redirects.

const query = z.object({
  state: z.string().min(1).max(200),
  code: z.string().min(1).max(2000).optional(),
  error: z.string().max(100).optional(),
});

const back = (result: string) => NextResponse.redirect(`${appBaseUrl()}/app/google?r=${result}`, { headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.redirect(`${appBaseUrl()}/login`);

  const jar = await cookies();
  const cookie = jar.get(OAUTH_COOKIE)?.value;
  jar.delete({ name: OAUTH_COOKIE, path: "/api/google" });

  const params = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!params.success) return back("failed");
  const state = checkState(cookie, params.data.state, userId);
  if (!state) return back("expired");
  if (params.data.error || !params.data.code) return back(params.data.error === "access_denied" ? "denied" : "failed");

  const cfg = googleConfig();
  if (!cfg) return back("off");
  try {
    await withOrg(userId, state.orgId, (tx, ctx) => completeConnect(tx, ctx, httpGoogle, cfg, params.data.code!, state.verifier));
  } catch (err) {
    if (err instanceof NoScopesError) return back("noscopes");
    if (err instanceof NoRefreshTokenError) return back("failed");
    if (err instanceof GoogleForbiddenError || err instanceof NotMemberError) return back("owners");
    console.warn("[google] connect failed:", err instanceof Error ? err.name : "unknown");
    return back("failed");
  }
  await setCurrentOrgCookie(state.orgId);
  return back("connected");
}
