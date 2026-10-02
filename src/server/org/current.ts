import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { auth } from "@/server/auth";
import { accessState, hasAccess, type AccessState } from "@/server/billing/access";
import { organizations } from "@/server/db/schema";
import { NotMemberError, listUserOrganizations, withOrg, type OrgContext, type OrgRole, type Tx } from "@/server/db/tenant";
import { listMyAgencies, managingAgency } from "@/server/agency/agency";

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
export async function currentOrganization(
  user: SessionUser,
): Promise<{ orgs: { id: string; name: string; role: OrgRole }[]; current: { id: string; name: string; role: OrgRole } | null }> {
  const orgs: { id: string; name: string; role: OrgRole }[] = await listUserOrganizations(user.id);
  const preferred = (await cookies()).get(ORG_COOKIE)?.value;
  const own = orgs.find((o) => o.id === preferred);
  if (own) return { orgs, current: own };
  // A location the user manages through an agency (opened from /agency).
  if (preferred) {
    const managed = await withOrg(user.id, preferred, async (tx, ctx) => {
      const [o] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ctx.orgId));
      return { id: ctx.orgId, name: o.name, role: ctx.role };
    }).catch((err) => {
      if (err instanceof NotMemberError) return null;
      throw err;
    });
    if (managed) return { orgs: [managed, ...orgs], current: managed };
  }
  return { orgs, current: orgs[0] ?? null };
}

/** Where to send a signed-in user with no organization open: their agency, or sign-up. */
export async function noOrgRedirect(user: SessionUser): Promise<never> {
  const agencies = await listMyAgencies(user.id);
  redirect(agencies.length ? "/agency" : "/onboarding/complete");
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

/**
 * What the org may see: its own plan, or, if that has run out, the plan of
 * the agency managing it. Must run inside withOrg() for this org.
 */
export async function orgAccess(tx: Tx, orgId: string): Promise<AccessState> {
  const [row] = await tx
    .select({ planStatus: organizations.planStatus, trialEndsAt: organizations.trialEndsAt })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  const own = accessState(row);
  if (own.kind === "active") return own;
  const agency = await managingAgency(tx, orgId);
  if (agency && hasAccess(accessState(agency))) return { kind: "agency", agencyName: agency.name };
  return own;
}

class OrgLockedError extends Error {}

/**
 * Run `fn` in the user's current organization. 404 if not a member; sends
 * a locked org (trial over, unpaid) to /locked before `fn` can read any data.
 * Pass `{ allowLocked: true }` only for billing, export and deletion.
 */
export async function withCurrentOrg<T>(
  fn: (tx: Tx, ctx: OrgContext, user: SessionUser) => Promise<T>,
  options: { allowLocked?: boolean } = {},
): Promise<T> {
  const user = await requireUser();
  const { current } = await currentOrganization(user);
  // No organization yet: their agency, or finish sign-up from saved answers.
  if (!current) return noOrgRedirect(user);
  try {
    return await withOrg(user.id, current.id, async (tx, ctx) => {
      if (!options.allowLocked && !hasAccess(await orgAccess(tx, ctx.orgId))) {
        throw new OrgLockedError();
      }
      return fn(tx, ctx, user);
    });
  } catch (err) {
    if (err instanceof NotMemberError) notFound();
    if (err instanceof OrgLockedError) redirect("/locked");
    throw err;
  }
}
