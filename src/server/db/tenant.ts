import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { z } from "zod";
import { getDb } from "./client";
import { auditLog, memberships, orgAssessments, organizations, type MembershipRole } from "./schema";

type OrgInsert = typeof organizations.$inferInsert;

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

/** What the app may set on a new org. Trial and billing columns are excluded on purpose. */
export type NewOrganization = Pick<
  OrgInsert,
  "name" | "websiteDomain" | "serviceArea" | "category" | "primaryGoal" | "adSpendRange" | "websiteManager" | "country"
>;

/** Create an organization with `userId` as its first owner. Starts the 7-day trial (a DB default). */
export async function createOrganization(
  userId: string,
  input: NewOrganization,
  attach?: { assessment: Record<string, unknown> },
): Promise<string> {
  const uid = parseId(userId);
  const orgId = uuidv7();
  await getDb().transaction(async (tx) => {
    await setSetting(tx, "app.user_id", uid);
    await setSetting(tx, "app.org_id", orgId);
    // Hand-written so only the columns app_user may insert are named; the
    // trial and billing columns are left to their database defaults (see the
    // billing_column_grants migration). Drizzle's insert would list them all.
    await tx.execute(sql`
      INSERT INTO organizations
        (id, name, website_domain, service_area, category, primary_goal, ad_spend_range, website_manager, country)
      VALUES
        (${orgId}, ${input.name}, ${input.websiteDomain ?? null}, ${input.serviceArea ?? null},
         ${input.category ?? null}, ${input.primaryGoal ?? null}, ${input.adSpendRange ?? null},
         ${input.websiteManager ?? null}, ${input.country ?? null})`);
    await tx.insert(memberships).values({ orgId, userId: uid, role: "owner" });
    await tx.insert(auditLog).values({ orgId, actorUserId: uid, action: "org.created" });
    if (attach) await tx.insert(orgAssessments).values({ orgId, resultJson: attach.assessment });
  });
  return orgId;
}
