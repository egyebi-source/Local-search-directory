import { execFileSync } from "node:child_process";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { buckets, ctrFor, issuesFrom, loadDashboard, visibility } from "@/server/dashboard/dashboard";
import { pagesToAudit, saveSnapshot, snapshotOrg, takeSnapshot, type SnapshotData } from "@/server/dashboard/snapshot";
import { getDb } from "@/server/db/client";
import { seoSnapshots, users } from "@/server/db/schema";
import { createOrganization, listUserOrganizations, withOrg } from "@/server/db/tenant";
import { lookupSearch } from "@/server/tracking/checks";
import { fakeDataForSeo } from "../fixtures/dataforseo";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

const kw = (keyword: string, position: number) => ({ keyword, position, searches: 100, cpcUsd: 5, url: null, trafficEst: 1 });
const snap = (list: [string, number][]): SnapshotData => ({ overview: null, keywords: list.map(([k, p]) => kw(k, p)), audit: null });

describe("dashboard math", () => {
  it("visibility: 100% = #1 everywhere; not found = 0", () => {
    expect(visibility([1, 1])).toBe(100);
    expect(visibility([1, null])).toBe(50);
    expect(visibility([])).toBeNull();
    expect(ctrFor(15)).toBe(0.01);
    expect(ctrFor(50)).toBe(0);
  });
  it("counts new and lost searches per position band", () => {
    const prev = snap([["a", 2], ["b", 8], ["c", 15]]);
    const now = snap([["a", 1], ["b", 12], ["d", 3]]);
    const [top3, top10, top20] = buckets(now, prev);
    expect(top3).toMatchObject({ count: 2, new: 1, lost: 0 }); // d new; a stays
    expect(top10).toMatchObject({ count: 2, new: 1, lost: 1 }); // d new, b dropped to 12
    expect(top20).toMatchObject({ count: 3, new: 1, lost: 1 }); // d new, c gone
    expect(buckets(now, null)[0]).toMatchObject({ new: null, lost: null });
  });
  it("turns failed page checks into plain-English issues, ignoring unknown ones", () => {
    const issues = issuesFrom({ score: 70, pages: [{ url: "u", score: 70, failed: ["no_image_alt", "made_up"] }, { url: "v", score: 70, failed: ["no_image_alt"] }] });
    expect(issues).toEqual([expect.objectContaining({ check: "no_image_alt", pages: 2, area: "Images" })]);
  });
  it("only ever checks pages on the business's own website", () => {
    const urls = pagesToAudit("acme.ca", [
      { ...kw("a", 1), url: "https://acme.ca/brakes?utm=1" },
      { ...kw("b", 2), url: "https://www.acme.ca/paint" },
      { ...kw("c", 3), url: "https://evil.example/acme.ca" },
      { ...kw("d", 4), url: "http://169.254.169.254/latest" },
      { ...kw("e", 5), url: "javascript:alert(1)" },
      { ...kw("f", 6), url: "https://acme.ca.evil.example/" },
    ]);
    expect(urls).toEqual(["https://acme.ca/", "https://acme.ca/brakes", "https://www.acme.ca/paint"]);
  });
});

describe.runIf(hasDb)("dashboard data", () => {
  let owner: { id: string };
  let orgId: string;
  beforeAll(async () => {
    owner = await createUser("dash");
    orgId = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acmecollision.ca", country: "CA" });
  });

  it("a snapshot gathers traffic, keywords by position and a site check", async () => {
    const d = fakeDataForSeo();
    const data = await takeSnapshot(d.transport, "acmecollision.ca", "CA");
    expect(data.overview).toMatchObject({ trafficEst: 312, keywords: 26, trafficValueUsd: 2951, buckets: { top3: 5, top10: 11, top20: 20, top100: 26 } });
    expect(data.audit?.pages[0].failed.sort()).toEqual(["no_description", "no_image_alt"]);
    expect(d.calls.every((c) => !JSON.stringify(c.body).includes("evil"))).toBe(true);
  });

  it("daily checks record whether Google's AI answer mentions the business", async () => {
    const v = await lookupSearch(fakeDataForSeo().transport, "collision repair ottawa", "CA", "acmecollision.ca");
    expect(v).toMatchObject({ aiOverview: true, aiCited: true });
    const other = await lookupSearch(fakeDataForSeo().transport, "collision repair ottawa", "CA", "someoneelse.ca");
    expect(other).toMatchObject({ aiOverview: true, aiCited: false });
  });

  it("snapshots are private to the business and can't be rewritten", async () => {
    await snapshotOrg(orgId, (fn) => withOrg(owner.id, orgId, fn), { dataforseo: fakeDataForSeo().transport, dataSource: "live" });
    const intruder = await createUser("dash-other");
    const otherOrg = await createOrganization(intruder.id, { name: "Other" });
    expect(await withOrg(intruder.id, otherOrg, (tx) => tx.select().from(seoSnapshots))).toEqual([]);
    await expectDbError(withOrg(owner.id, orgId, (tx) => tx.update(seoSnapshots).set({ data: {} })), /permission denied/);
    await expectDbError(
      withOrg(intruder.id, otherOrg, (tx) => saveSnapshot(tx, orgId, "live", { overview: null, keywords: [], audit: null })),
      /row-level security/,
    );
    const d = await withOrg(owner.id, orgId, (tx) => loadDashboard(tx, orgId));
    expect(d.overview?.trafficEst).toBe(312);
    expect(d.notes.overview).toContain("312");
  });

  it("tampered stored data is ignored, not shown", async () => {
    await asOwner((c) => c.query("UPDATE seo_snapshots SET data = '{\"overview\": {\"trafficEst\": \"<script>\"}}'::jsonb WHERE org_id = $1", [orgId]));
    const d = await withOrg(owner.id, orgId, (tx) => loadDashboard(tx, orgId));
    expect(d.latest).toBeNull();
  });

  it("the demo dashboard is complete", async () => {
    execFileSync("node", ["scripts/seed-demo.mjs"], {
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", DEMO_MODE: "true", DATABASE_URL_UNPOOLED: process.env.TEST_DATABASE_URL_OWNER ?? "" } as NodeJS.ProcessEnv,
    });
    const [demo] = await getDb().select().from(users).where(eq(users.email, "demo-owner@torquerank.test"));
    const [org] = await listUserOrganizations(demo.id);
    const d = await withOrg(demo.id, org.id, (tx) => loadDashboard(tx, org.id));
    expect(d.trafficTrend).toHaveLength(9);
    expect(d.overview?.trafficEst).toBe(418);
    expect(d.buckets.map((b) => b.count)).toEqual([9, 24, 41, 121]);
    expect(d.ai).toMatchObject({ shown: 2, cited: 1 });
    expect(d.audit?.issues[0].check).toBe("no_image_alt");
    expect(d.notes.position).toContain("bumper repair ottawa");
    expect(d.sample).toBe(false);
  });
});
