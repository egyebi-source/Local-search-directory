import "server-only";
import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { invites, memberships, users, type MembershipRole } from "@/server/db/schema";
import type { OrgContext, Tx } from "@/server/db/tenant";
import { randomToken, sha256Hex } from "@/server/security/hash";
import { audit } from "./audit";

export const INVITE_TTL_DAYS = 7;

/** Thrown for actions that only owners may perform. */
export class ForbiddenError extends Error {
  constructor() {
    super("Only owners can do this");
  }
}

export class TeamRuleError extends Error {
  constructor(public readonly code: "already_member" | "last_owner" | "not_found") {
    super(code);
  }
}

function requireOwner(ctx: OrgContext) {
  if (ctx.role !== "owner") throw new ForbiddenError();
}

/** Inviting: owners, and the managing agency (so it can hand the account to the business owner). */
export function canInvite(ctx: Pick<OrgContext, "role">): boolean {
  return ctx.role === "owner" || ctx.role === "agency";
}

export async function listMembers(tx: Tx, ctx: OrgContext) {
  return tx
    .select({
      userId: memberships.userId,
      role: memberships.role,
      email: users.email,
      name: users.name,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, ctx.orgId))
    .orderBy(memberships.createdAt);
}

export async function listPendingInvites(tx: Tx, ctx: OrgContext) {
  return tx
    .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt })
    .from(invites)
    .where(
      and(
        eq(invites.orgId, ctx.orgId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(invites.createdAt));
}

/**
 * Creates an invite and returns the one-time token. Only its SHA-256 hash is
 * stored; the caller emails the token and then discards it.
 */
export async function createInvite(
  tx: Tx,
  ctx: OrgContext,
  input: { email: string; role: MembershipRole },
): Promise<{ inviteId: string; token: string }> {
  if (!canInvite(ctx)) throw new ForbiddenError();
  // An agency may hand an account to its owner, but never make anyone an
  // owner of a business that already has one (that would let it take over).
  if (ctx.role === "agency" && input.role === "owner" && (await ownerCount(tx, ctx)) > 0) throw new ForbiddenError();
  const email = input.email.trim().toLowerCase();

  const [existing] = await tx
    .select({ n: count() })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.orgId), sql`lower(${users.email}) = ${email}`));
  if ((existing?.n ?? 0) > 0) throw new TeamRuleError("already_member");

  const token = randomToken();
  const [row] = await tx
    .insert(invites)
    .values({
      orgId: ctx.orgId,
      email,
      role: input.role,
      tokenHash: sha256Hex(token),
      invitedByUserId: ctx.userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    })
    .returning({ id: invites.id });
  await audit(tx, ctx, "invite.created", { invite_id: row.id, role: input.role });
  return { inviteId: row.id, token };
}

export async function revokeInvite(tx: Tx, ctx: OrgContext, inviteId: string) {
  if (!canInvite(ctx)) throw new ForbiddenError();
  const updated = await tx
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, inviteId), eq(invites.orgId, ctx.orgId), isNull(invites.acceptedAt)))
    .returning({ id: invites.id });
  if (updated.length === 0) throw new TeamRuleError("not_found");
  await audit(tx, ctx, "invite.revoked", { invite_id: inviteId });
}

async function ownerCount(tx: Tx, ctx: OrgContext): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.role, "owner")));
  return row?.n ?? 0;
}

async function memberRole(tx: Tx, ctx: OrgContext, userId: string) {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)))
    .for("update");
  if (!row) throw new TeamRuleError("not_found");
  return row.role;
}

export async function removeMember(tx: Tx, ctx: OrgContext, userId: string) {
  requireOwner(ctx);
  const role = await memberRole(tx, ctx, userId);
  if (role === "owner" && (await ownerCount(tx, ctx)) <= 1) throw new TeamRuleError("last_owner");
  await tx
    .delete(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
  await audit(tx, ctx, "member.removed", { user_id: userId });
}

export async function changeRole(tx: Tx, ctx: OrgContext, userId: string, role: MembershipRole) {
  requireOwner(ctx);
  const current = await memberRole(tx, ctx, userId);
  if (current === role) return;
  if (current === "owner" && (await ownerCount(tx, ctx)) <= 1) throw new TeamRuleError("last_owner");
  await tx
    .update(memberships)
    .set({ role })
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
  await audit(tx, ctx, "member.role_changed", { user_id: userId, from: current, to: role });
}
