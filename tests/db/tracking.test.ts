import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssessmentResult } from "@/server/assessment/result";
import { getDb } from "@/server/db/client";
import { rankChecks, siteChanges, trackedSearches } from "@/server/db/schema";
import { createOrganization, withOrg, withSystemOrg } from "@/server/db/tenant";
import { isAuthorizedCron } from "@/server/security/cron";
import {
  addTrackedSearch,
  keywordSchema,
  runChecksForOrg,
  runDailyChecks,
  seedFromAssessment,
  TRACKED_SEARCH_LIMIT,
  TrackingLimitError,
} from "@/server/tracking/checks";
import { addChange, ChangeDateError, checkOn, loadProgress, rankGain } from "@/server/tracking/progress";
import { fakeDataForSeo } from "../fixtures/dataforseo";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

const assessment = {
  version: 1,
  domain: "acmecollision.ca",
  country: "CA",
  serviceArea: "Ottawa, ON",
  category: "Collision repair",
  primaryKeyword: "collision repair ottawa",
  dataSource: "live",
  generatedAt: "2026-09-01T15:00:00.000Z",
  metrics: { advertisers: 0, topCpcUsd: null, monthlySearches: 0, yourPosition: 9, rescueTargets: 0, rescueMonthlySearches: 0 },
  insights: [],
  insightsSource: "rules",
  rescueTargets: [],
  topKeywords: [],
  competitors: [],
  local: {
    keyword: "collision repair ottawa",
    yourRank: 8,
    you: { name: "Acme", rating: 4.4, reviews: 60 },
    leaders: [],
    leaderAvgRating: 4.8,
    leaderAvgReviews: 400,
    directoriesInTop10: 2,
  },
} satisfies AssessmentResult;

const deps = () => ({ ...fakeDataForSeo(), dataSource: "live" as const });

describe("progress math", () => {
  it("moving from #8 to #3 is +5; appearing from nowhere counts from #21", () => {
    expect(rankGain(8, 3)).toBe(5);
    expect(rankGain(3, 8)).toBe(-5);
    expect(rankGain(null, 6)).toBe(15);
    expect(rankGain(null, null)).toBeNull();
  });
  it("the check in effect on a date is the latest one on or before it", () => {
    const h = ["2026-09-01", "2026-09-05", "2026-09-10"].map((day) => ({
      day, mapRank: 1, organicRank: 1, rating: null, reviews: null, leaderAvgReviews: null, aiOverview: null, aiCited: null, dataSource: "live" as const,
    }));
    expect(checkOn(h, "2026-09-07")?.day).toBe("2026-09-05");
    expect(checkOn(h, "2026-08-01")).toBeNull();
  });
  it("tracked searches accept plain words only", () => {
    expect(keywordSchema.parse("  Collision   Repair KANATA ")).toBe("collision repair kanata");
    expect(keywordSchema.safeParse("<script>").success).toBe(false);
    expect(keywordSchema.safeParse("ab").success).toBe(false);
  });
});

describe("cron authorization", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("requires the exact secret, and is closed when no secret is configured", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(isAuthorizedCron("Bearer ")).toBe(false);
    vi.stubEnv("CRON_SECRET", "s".repeat(40));
    expect(isAuthorizedCron(`Bearer ${"s".repeat(40)}`)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${"s".repeat(39)}x`)).toBe(false);
    expect(isAuthorizedCron(null)).toBe(false);
  });
});

describe.runIf(hasDb)("progress tracking", () => {
  let owner: { id: string };
  let other: { id: string };
  let orgId: string;
  let otherOrg: string;
  const asOwnerOrg = <T,>(fn: Parameters<typeof withSystemOrg<T>>[1]) => withOrg(owner.id, orgId, fn);

  beforeAll(async () => {
    owner = await createUser("tracker");
    other = await createUser("tracker-b");
    orgId = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acmecollision.ca", country: "CA" });
    otherOrg = await createOrganization(other.id, { name: "Other", websiteDomain: "other.example", country: "CA" });
  });

  beforeEach(async () => {
    await asOwner((c) => c.query("TRUNCATE rank_checks, tracked_searches, site_changes, api_spend_daily CASCADE"));
  });

  it("sign-up seeds the main search with the assessment as the 'before'", async () => {
    await asOwnerOrg((tx) => seedFromAssessment(tx, orgId, assessment));
    const { searches } = await asOwnerOrg((tx) => loadProgress(tx, orgId));
    expect(searches).toHaveLength(1);
    expect(searches[0]).toMatchObject({ keyword: "collision repair ottawa", country: "CA" });
    expect(searches[0].before).toMatchObject({ day: "2026-09-01", mapRank: 8, organicRank: 9, reviews: 60, leaderAvgReviews: 400 });
  });

  it("a check records today's positions once; a second run the same day costs nothing", async () => {
    await asOwnerOrg((tx) => seedFromAssessment(tx, orgId, assessment));
    const d = deps();
    const first = await runChecksForOrg(orgId, asOwnerOrg, { dataforseo: d.transport, dataSource: "live" }, "manual");
    expect(first).toEqual({ checked: 1, failed: 0 });
    // Fixture: Acme is #6 in Maps with 85 reviews; #7 in regular results.
    const { searches } = await asOwnerOrg((tx) => loadProgress(tx, orgId));
    expect(searches[0].now).toMatchObject({ mapRank: 6, organicRank: 7, reviews: 85, rating: 4.5 });
    expect(searches[0].before?.mapRank).toBe(8);
    const calls = d.calls.length;
    const again = await runChecksForOrg(orgId, asOwnerOrg, { dataforseo: d.transport, dataSource: "live" }, "manual");
    expect(again).toEqual({ checked: 0, failed: 0 });
    expect(d.calls.length).toBe(calls);
  });

  it("history is append-only: the app cannot rewrite or delete a past check", async () => {
    await asOwnerOrg((tx) => seedFromAssessment(tx, orgId, assessment));
    await expectDbError(asOwnerOrg((tx) => tx.update(rankChecks).set({ mapRank: 1 })), /permission denied/);
    await expectDbError(asOwnerOrg((tx) => tx.delete(rankChecks)), /permission denied/);
  });

  it("another org can't see or touch this org's tracking data", async () => {
    await asOwnerOrg((tx) => seedFromAssessment(tx, orgId, assessment));
    await asOwnerOrg((tx) => addChange(tx, { orgId, userId: owner.id }, { title: "New page", note: null, madeOn: "2026-09-02" }));
    await withOrg(other.id, otherOrg, async (tx) => {
      expect(await tx.select().from(trackedSearches)).toEqual([]);
      expect(await tx.select().from(rankChecks)).toEqual([]);
      expect(await tx.select().from(siteChanges)).toEqual([]);
    });
    await expectDbError(
      withOrg(other.id, otherOrg, (tx) => tx.insert(trackedSearches).values({ orgId, keyword: "evil", country: "CA" })),
      /row-level security/,
    );
    // The background-job helper is scoped too.
    await withSystemOrg(otherOrg, async (tx) => expect(await tx.select().from(rankChecks)).toEqual([]));
  });

  it(`tracks at most ${TRACKED_SEARCH_LIMIT} searches at once`, async () => {
    for (let i = 0; i < TRACKED_SEARCH_LIMIT; i++) await asOwnerOrg((tx) => addTrackedSearch(tx, orgId, `search ${i}`, "CA"));
    await expect(asOwnerOrg((tx) => addTrackedSearch(tx, orgId, "one too many", "CA"))).rejects.toBeInstanceOf(TrackingLimitError);
  });

  it("change dates must be within the last year and not in the future", async () => {
    const now = new Date("2026-10-02T12:00:00Z");
    await expect(
      asOwnerOrg((tx) => addChange(tx, { orgId, userId: owner.id }, { title: "x page", note: null, madeOn: "2026-12-01" }, now)),
    ).rejects.toBeInstanceOf(ChangeDateError);
    await expect(
      asOwnerOrg((tx) => addChange(tx, { orgId, userId: owner.id }, { title: "x page", note: null, madeOn: "2024-01-01" }, now)),
    ).rejects.toBeInstanceOf(ChangeDateError);
  });

  it("the daily job checks orgs with access and skips locked ones", async () => {
    await asOwnerOrg((tx) => seedFromAssessment(tx, orgId, assessment));
    await withOrg(other.id, otherOrg, (tx) => addTrackedSearch(tx, otherOrg, "plumber ottawa", "CA"));
    await asOwner((c) => c.query("UPDATE organizations SET plan_status = 'locked' WHERE id = $1", [otherOrg]));
    const d = deps();
    const r = await runDailyChecks({ dataforseo: d.transport, dataSource: "live" });
    expect(r).toMatchObject({ orgs: 1, checked: 1, failed: 0 });
    const rows = await asOwner(async (c) => (await c.query("SELECT org_id FROM rank_checks WHERE source = 'daily'")).rows);
    expect(rows.map((x) => x.org_id)).toEqual([orgId]);
    // Nothing left to do today.
    expect((await runDailyChecks({ dataforseo: d.transport, dataSource: "live" })).due).toBe(0);
    await asOwner((c) => c.query("UPDATE organizations SET plan_status = 'trialing' WHERE id = $1", [otherOrg]));
  });

  it("the daily job stops at the spend cap without calling the provider", async () => {
    vi.stubEnv("DAILY_SPEND_CAP_DATAFORSEO_CENTS", "1");
    await asOwnerOrg((tx) => seedFromAssessment(tx, orgId, assessment));
    await asOwner((c) =>
      c.query("INSERT INTO api_spend_daily (day, provider, micros) VALUES ((now() AT TIME ZONE 'UTC')::date, 'dataforseo', 10000)"),
    );
    const d = deps();
    const r = await runDailyChecks({ dataforseo: d.transport, dataSource: "live" });
    expect(r.checked).toBe(0);
    expect(d.calls).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it("only the app's own role is used: no row reached the db without an org", async () => {
    const [row] = await getDb().select().from(rankChecks).where(eq(rankChecks.orgId, orgId));
    expect(row).toBeUndefined(); // RLS: no org context, nothing visible
  });
});
