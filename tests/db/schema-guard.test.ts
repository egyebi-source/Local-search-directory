import { describe, expect, it } from "vitest";
import { asOwner, hasDb } from "./helpers";

// Security checklist §13: every table with customer data has org_id + RLS.
// This fails if someone adds a tenant table and forgets the policy.
describe.runIf(hasDb)("database security guard", () => {
  it("every table with an org_id column has RLS enabled, forced, and a policy", async () => {
    const rows = await asOwner(async (c) => {
      const { rows } = await c.query(`
        SELECT cl.relname AS table,
               cl.relrowsecurity AS enabled,
               cl.relforcerowsecurity AS forced,
               (SELECT count(*)::int FROM pg_policies p
                 WHERE p.schemaname = 'public' AND p.tablename = cl.relname) AS policies
        FROM pg_class cl
        JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
        WHERE cl.relkind = 'r'
          AND EXISTS (SELECT 1 FROM pg_attribute a
                      WHERE a.attrelid = cl.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
        ORDER BY 1`);
      return rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r, r.table).toMatchObject({ enabled: true, forced: true });
      expect(r.policies, `${r.table} policies`).toBeGreaterThan(0);
    }
  });

  it("the runtime role cannot bypass RLS and owns no tables", async () => {
    const { role, owned } = await asOwner(async (c) => {
      const role = await c.query(
        "SELECT rolsuper, rolbypassrls, rolcreaterole FROM pg_roles WHERE rolname = 'app_user'",
      );
      const owned = await c.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'app_user'",
      );
      return { role: role.rows[0], owned: owned.rows[0].n };
    });
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false });
    expect(owned).toBe(0);
  });
});
