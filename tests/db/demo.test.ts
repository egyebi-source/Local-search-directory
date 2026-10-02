import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";
import { withOrg } from "@/server/db/tenant";
import { demoEnabled, isDemoEmail } from "@/server/demo/demo";
import { listUserOrganizations } from "@/server/db/tenant";
import { loadProgress } from "@/server/tracking/progress";
import { listActions } from "@/server/actions/plan";
import { adminOverview, isPlatformAdmin } from "@/server/admin/admin";
import { hasDb } from "./helpers";

describe("demo mode switch", () => {
  it("is never on in production, even with DEMO_MODE=true", () => {
    expect(demoEnabled({ DEMO_MODE: "true", VERCEL: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(demoEnabled({ DEMO_MODE: "true", NODE_ENV: "production" })).toBe(false);
    expect(demoEnabled({ DEMO_MODE: "false", VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(demoEnabled({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(false);
    expect(demoEnabled({ DEMO_MODE: "true", VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(demoEnabled({ DEMO_MODE: "true", NODE_ENV: "development" })).toBe(true);
  });
  it("only .test demo addresses count as demo accounts", () => {
    expect(isDemoEmail("demo-owner@torquerank.test")).toBe(true);
    expect(isDemoEmail("owner@torquerank.ca")).toBe(false);
    expect(isDemoEmail(null)).toBe(false);
  });
});

const seed = (env: Record<string, string>) =>
  execFileSync("node", ["scripts/seed-demo.mjs"], {
    env: { PATH: process.env.PATH ?? "", DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL_OWNER ?? "", NODE_ENV: "test", ...env } as NodeJS.ProcessEnv,
    encoding: "utf8",
  });

describe.runIf(hasDb)("demo data", () => {
  it("is not seeded on production", () => {
    expect(seed({ DEMO_MODE: "true", VERCEL: "1", VERCEL_ENV: "production" })).toContain("skipped");
  });

  it("seeds a fictional shop with 60 days of history, and re-seeding replaces it", async () => {
    expect(seed({ DEMO_MODE: "true" })).toContain("seeded");
    expect(seed({ DEMO_MODE: "true" })).toContain("seeded");
    const [owner] = await getDb().select().from(users).where(eq(users.email, "demo-owner@torquerank.test"));
    const orgs = await listUserOrganizations(owner.id);
    expect(orgs.map((o) => o.name)).toEqual(["Acme Collision (Demo)"]);
    const p = await withOrg(owner.id, orgs[0].id, (tx) => loadProgress(tx, orgs[0].id));
    expect(p.searches).toHaveLength(3);
    expect(p.searches[0].history).toHaveLength(61);
    expect(p.searches[0].before).toMatchObject({ mapRank: 9, reviews: 48 });
    expect(p.searches[0].now).toMatchObject({ reviews: 97 });
    expect(p.searches[0].now!.mapRank).toBeLessThanOrEqual(5);
    expect(p.changes).toHaveLength(4);
    const plan = await withOrg(owner.id, orgs[0].id, (tx) => listActions(tx, orgs[0].id));
    expect(plan.open).toHaveLength(4);
    expect(plan.done).toHaveLength(2);
    expect(plan.open[0].valueUsdMonth).toBe(2166);
    // The demo owner is not an admin; the demo admin is.
    expect(await isPlatformAdmin(owner.id)).toBe(false);
    const [admin] = await getDb().select().from(users).where(eq(users.email, "demo-admin@torquerank.test"));
    expect(await isPlatformAdmin(admin.id)).toBe(true);
    expect((await adminOverview(admin.id)).orgs_tracking).toBeGreaterThanOrEqual(1);
  });
});
