import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { adminAuditRecent, adminCustomers, adminExtendTrial, adminOverview, isPlatformAdmin } from "@/server/admin/admin";
import { getDb } from "@/server/db/client";
import { platformAdmins } from "@/server/db/schema";
import { createOrganization, withUser } from "@/server/db/tenant";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

describe.runIf(hasDb)("admin dashboard", () => {
  let admin: { id: string; email: string };
  let customer: { id: string; email: string };
  let orgId: string;

  beforeAll(async () => {
    admin = await createUser("staff");
    customer = await createUser("customer");
    orgId = await createOrganization(customer.id, { name: "Acme Collision", websiteDomain: "acme.example", category: "Collision repair" });
    await asOwner((c) => c.query("INSERT INTO platform_admins (user_id) VALUES ($1)", [admin.id]));
  });

  it("only listed staff are admins", async () => {
    expect(await isPlatformAdmin(admin.id)).toBe(true);
    expect(await isPlatformAdmin(customer.id)).toBe(false);
  });

  it("a customer can't make themselves an admin or read the admin list", async () => {
    await expectDbError(
      withUser(customer.id, (tx) => tx.insert(platformAdmins).values({ userId: customer.id })),
      /permission denied/,
    );
    const visible = await withUser(customer.id, (tx) => tx.select().from(platformAdmins));
    expect(visible).toEqual([]);
  });

  it("every admin function refuses non-admins, even when called directly", async () => {
    for (const q of [
      sql`SELECT admin_overview()`,
      sql`SELECT * FROM admin_customers(10)`,
      sql`SELECT * FROM admin_audit_recent(10)`,
      sql`SELECT admin_extend_trial(${orgId}::uuid, 30, 'please')`,
    ]) {
      await expectDbError(withUser(customer.id, (tx) => tx.execute(q)), /not a platform admin/);
    }
    // And with no user at all.
    await expectDbError(getDb().execute(sql`SELECT admin_overview()`), /not a platform admin/);
  });

  it("the audit log can't be read or written by the app directly", async () => {
    await expectDbError(withUser(admin.id, (tx) => tx.execute(sql`SELECT * FROM admin_audit_log`)), /permission denied/);
    await expectDbError(
      withUser(admin.id, (tx) => tx.execute(sql`INSERT INTO admin_audit_log (id, action, reason) VALUES (gen_random_uuid(), 'x', 'y')`)),
      /permission denied/,
    );
  });

  it("admins see the funnel and customers, without Google data", async () => {
    const o = await adminOverview(admin.id);
    expect(o.orgs_total).toBeGreaterThanOrEqual(1);
    expect(o.daily).toHaveLength(14);
    const rows = await adminCustomers(admin.id);
    const acme = rows.find((r) => r.id === orgId);
    expect(acme).toMatchObject({ name: "Acme Collision", owner_email: customer.email, members: 1 });
    expect(Object.keys(acme!).sort()).toEqual(
      ["category", "changes", "created_at", "id", "last_check", "members", "name", "owner_email", "plan_status", "service_area", "tracked", "trial_ends_at", "website_domain"].sort(),
    );
  });

  it("extending a trial needs a reason, re-opens an expired trial, and is audited", async () => {
    await expectDbError(adminExtendTrial(admin.id, { orgId, days: 7, reason: "  " }), /reason required/);
    await expectDbError(adminExtendTrial(admin.id, { orgId, days: 90, reason: "too long" }), /days must be 1-30/);
    await asOwner((c) => c.query("UPDATE organizations SET trial_ends_at = now() - interval '2 days', plan_status = 'locked' WHERE id = $1", [orgId]));
    const until = await adminExtendTrial(admin.id, { orgId, days: 7, reason: "Pilot shop, needs more time" });
    expect((until.getTime() - Date.now()) / 86_400_000).toBeCloseTo(7, 1);
    const [org] = await asOwner(async (c) => (await c.query("SELECT plan_status FROM organizations WHERE id = $1", [orgId])).rows);
    expect(org.plan_status).toBe("trialing");
    const [entry] = await adminAuditRecent(admin.id, 1);
    expect(entry).toMatchObject({ admin_email: admin.email, action: "trial.extended", org_name: "Acme Collision", reason: "Pilot shop, needs more time" });
  });

  it("paid plans can't be changed through trial extension", async () => {
    await asOwner((c) => c.query("UPDATE organizations SET plan_status = 'active' WHERE id = $1", [orgId]));
    await expectDbError(adminExtendTrial(admin.id, { orgId, days: 7, reason: "should fail" }), /paid plan/);
    await asOwner((c) => c.query("UPDATE organizations SET plan_status = 'trialing' WHERE id = $1", [orgId]));
  });
});
