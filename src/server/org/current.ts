import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { NotMemberError, listUserOrganizations, withOrg, type OrgContext, type Tx } from "@/server/db/tenant";

const ORG_COOKIE = "tr_org";

export type SessionUser = { id: string; email: string; name: string | null };

/** The signed-in user, or a redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) redirect("/login");
  return { id: user.id, email: user.email, name: user.name ?? null };
}

/**
 * The organization the user is working in: the one in the cookie if they
 * still belong to it, otherwise their first. The cookie is only a
 * preference; membership is re-checked by withOrg() on every request.
 */
export async function currentOrganization(user: SessionUser) {
  const orgs = await listUserOrganizations(user.id);
  if (orgs.length === 0) return { orgs, current: null };
  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const current = orgs.find((o) => o.id === preferred) ?? orgs[0];
  return { orgs, current };
}

export async function setCurrentOrgCookie(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Run `fn` in the user's current organization; 404 if not a member. */
export async function withCurrentOrg<T>(
  fn: (tx: Tx, ctx: OrgContext, user: SessionUser) => Promise<T>,
): Promise<T> {
  const user = await requireUser();
  const { current } = await currentOrganization(user);
  if (!current) redirect("/onboarding");
  try {
    return await withOrg(user.id, current.id, (tx, ctx) => fn(tx, ctx, user));
  } catch (err) {
    if (err instanceof NotMemberError) notFound();
    throw err;
  }
}
