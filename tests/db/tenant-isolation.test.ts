import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { auditLog, invites, memberships, organizations } from "@/server/db/schema";
import { createOrganization, listUserOrganizations, NotMemberError, withOrg, withUser } from "@/server/db/tenant";
import { createInvite, listMembers, listPendingInvites } from "@/server/org/team";
import { asAppUserRaw, createUser, expectDbError, hasDb } from "./helpers";

// PRD §8.3 acceptance test: a user of org A can never read or change org B.
describe.runIf(hasDb)("tenant isolation", () => {
  let alice: { id: string; email: string }; // owner of A
  let bob: { id: string; email: string }; // owner of B
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    alice = await createUser("alice");
    bob = await createUser("bob");
    orgA = await createOrganization(alice.id, { name: "Alice Auto Body" });
    orgB = await createOrganization(bob.id, { name: "Bob Plumbing" });
    await withOrg(bob.id, orgB, (tx, ctx) => createInvite(tx, ctx, { email: "x@example.test", role: "member" }));
    await withOrg(alice.id, orgA, (tx, ctx) => createInvite(tx, ctx, { email: "y@example.test", role: "member" }));
  });

  it("withOrg refuses an organization the user doesn't belong to", async () => {
    await expect(withOrg(alice.id, orgB, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
  });

  it("withOrg refuses malformed ids instead of passing them to SQL", async () => {
    await expect(withOrg(alice.id, "' OR 1=1 --", async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
    await expect(withOrg("not-a-uuid", orgA, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
  });

  it("inside org A, every tenant table returns only org A rows", async () => {
    await withOrg(alice.id, orgA, async (tx) => {
      const orgs = await tx.select().from(organizations);
      const mems = await tx.select().from(memberships);
      const invs = await tx.select().from(invites);
      const logs = await tx.select().from(auditLog);
      expect(orgs.map((o) => o.id)).toEqual([orgA]);
      expect(new Set(mems.map((m) => m.orgId))).toEqual(new Set([orgA]));
      expect(invs.length).toBeGreaterThan(0);
      expect(new Set(invs.map((i) => i.orgId))).toEqual(new Set([orgA]));
      expect(new Set(logs.map((l) => l.orgId))).toEqual(new Set([orgA]));
    });
  });

  it("the database blocks reads of org B even when the query asks for it explicitly", async () => {
    await withOrg(alice.id, orgA, async (tx) => {
      expect(await tx.select().from(organizations).where(eq(organizations.id, orgB))).toEqual([]);
      expect(await tx.select().from(invites).where(eq(invites.orgId, orgB))).toEqual([]);
      expect(await tx.select().from(memberships).where(eq(memberships.orgId, orgB))).toEqual([]);
      expect(await tx.select().from(auditLog).where(eq(auditLog.orgId, orgB))).toEqual([]);
    });
  });

  it("the database blocks writes into org B from org A's context", async () => {
    await expectDbError(
      withOrg(alice.id, orgA, (tx) =>
        tx.insert(memberships).values({ orgId: orgB, userId: alice.id, role: "owner" }),
      ),
      /row-level security/,
    );

    await expectDbError(
      withOrg(alice.id, orgA, (tx) =>
        tx.insert(invites).values({
          orgId: orgB,
          email: "evil@example.test",
          tokenHash: "x".repeat(64),
          expiresAt: new Date(Date.now() + 1000 * 60),
        }),
      ),
      /row-level security/,
    );

    const renamed = await withOrg(alice.id, orgA, (tx) =>
      tx.update(organizations).set({ name: "pwned" }).where(eq(organizations.id, orgB)).returning(),
    );
    expect(renamed).toEqual([]);
    const deleted = await withOrg(alice.id, orgA, (tx) =>
      tx.delete(invites).where(eq(invites.orgId, orgB)).returning(),
    );
    expect(deleted).toEqual([]);
  });

  it("team helpers only return the current org's people and invites", async () => {
    const { members, pending } = await withOrg(alice.id, orgA, async (tx, ctx) => ({
      members: await listMembers(tx, ctx),
      pending: await listPendingInvites(tx, ctx),
    }));
    expect(members.map((m) => m.userId)).toEqual([alice.id]);
    expect(pending.every((i) => i.email !== "x@example.test")).toBe(true);
  });

  it("with no org selected, tenant tables are empty except the user's own memberships", async () => {
    await withUser(alice.id, async (tx) => {
      expect(await tx.select().from(invites)).toEqual([]);
      expect(await tx.select().from(auditLog)).toEqual([]);
      const mems = await tx.select().from(memberships);
      expect(mems.map((m) => m.userId)).toEqual([alice.id]);
    });
    const orgs = await listUserOrganizations(alice.id);
    expect(orgs.map((o) => o.id)).toEqual([orgA]);
  });

  it("a raw connection with no settings sees no tenant data at all", async () => {
    await asAppUserRaw(async (client) => {
      for (const table of ["organizations", "memberships", "invites", "audit_log"]) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows[0].n, table).toBe(0);
      }
    });
  });

  it("settings do not leak between transactions on a pooled connection", async () => {
    await asAppUserRaw(async (client) => {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgA]);
      await client.query("COMMIT");
      const { rows } = await client.query("SELECT count(*)::int AS n FROM invites");
      expect(rows[0].n).toBe(0);
    });
  });

  it("the audit log is append-only for the app role", async () => {
    await expectDbError(
      withOrg(alice.id, orgA, (tx) => tx.delete(auditLog).where(eq(auditLog.orgId, orgA))),
      /permission denied/,
    );
    await expectDbError(
      withOrg(alice.id, orgA, (tx) => tx.update(auditLog).set({ action: "x" })),
      /permission denied/,
    );
  });
});
