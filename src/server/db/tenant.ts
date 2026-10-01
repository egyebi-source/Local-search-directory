import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { getDb } from "./client";
import { auditLog, memberships, organizations, type MembershipRole } from "./schema";

// Tenant isolation, layer 1 of 2 (PRD §8.3). Layer 2 is row-level security
// in the database, which uses the settings these helpers put on the
// transaction. All org data must be read and written through withOrg().

export type Db = ReturnType<typeof getDb>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type OrgContext = { orgId: string; userId: string; role: MembershipRole };

/** The user is not a member of the requested organization. Show a 404. */
export class NotMemberError extends Error {
  constructor() {
    super("Not a member of this organization");
  }
}

const uuidSchema = z.uuid();

function parseId(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new NotMemberError();
  return parsed.data;
}

async function setSetting(tx: Tx, name: "app.user_id" | "app.org_id", value: string) {
  // `true` = local to this transaction; nothing leaks to the next request
  // that reuses the pooled connection.
  await tx.execute(sql`SELECT set_config(${name}, ${value}, true)`);
}

/** Run `fn` as `userId` with no organization selected (lists, onboarding). */
export async function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const uid = parseId(userId);
  return getDb().transaction(async (tx) => {
    await setSetting(tx, "app.user_id", uid);
    return fn(tx);
  });
}

/**
 * Run `fn` inside one organization after verifying that `userId` belongs to
 * it. Throws NotMemberError otherwise, so callers can respond with a 404.
 */
export async function withOrg<T>(
  userId: string,
  orgId: string,
  fn: (tx: Tx, ctx: OrgContext) => Promise<T>,
): Promise<T> {
  const uid = parseId(userId);
  const oid = parseId(orgId);
  return getDb().transaction(async (tx) => {
    await setSetting(tx, "app.user_id", uid);
    const [membership] = await tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, oid), eq(memberships.userId, uid)));
    if (!membership) throw new NotMemberError();
    await setSetting(tx, "app.org_id", oid);
    return fn(tx, { orgId: oid, userId: uid, role: membership.role });
  });
}

/** Organizations the user belongs to, oldest first. */
export async function listUserOrganizations(userId: string) {
  return withUser(userId, (tx) =>
    tx
      .select({ id: organizations.id, name: organizations.name, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(eq(memberships.userId, userId))
      .orderBy(memberships.createdAt),
  );
}

export type NewOrganization = {
  name: string;
  websiteDomain?: string | null;
  serviceArea?: string | null;
  category?: string | null;
};

/** Create an organization with `userId` as its first owner. */
export async function createOrganization(userId: string, input: NewOrganization): Promise<string> {
  const uid = parseId(userId);
  const orgId = uuidv7();
  await getDb().transaction(async (tx) => {
    await setSetting(tx, "app.user_id", uid);
    await setSetting(tx, "app.org_id", orgId);
    await tx.insert(organizations).values({ id: orgId, ...input });
    await tx.insert(memberships).values({ orgId, userId: uid, role: "owner" });
    await tx.insert(auditLog).values({ orgId, actorUserId: uid, action: "org.created" });
  });
  return orgId;
}
