import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  dismissAction,
  estimatedValue,
  listActions,
  markActionDone,
  refreshPlan,
  rulePlan,
  looksLikeTheirs,
  weakHeading,
  type PlanInput,
} from "@/server/actions/plan";
import { actionItems, siteChanges } from "@/server/db/schema";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { seedBaseline } from "@/server/tracking/checks";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

const input: PlanInput = {
  business: { name: "Acme Collision", category: "Collision repair", city: "ottawa", website: "acme.example", goals: ["calls"] },
  mainSearch: "collision repair ottawa",
  local: { mapRank: 6, reviews: 85, rating: 4.5, leaderAvgReviews: 400, leaderAvgRating: 4.8 },
  site: null,
  keywords: [
    { keyword: "collision repair near me", monthlySearches: 1900, cpcUsd: 11.4, position: 14 },
    { keyword: "bumper repair ottawa", monthlySearches: 390, cpcUsd: 8.95, position: 17 },
    { keyword: "collision repair ottawa", monthlySearches: 880, cpcUsd: 9.8, position: null },
  ],
};

// Real numbers from October 2026 checks of three Brampton shops.
const performance: PlanInput = {
  business: { name: "Performance Collision", category: "Collision Repai", city: "brampton", website: "performancecollisionbrampton.ca", goals: ["calls"] },
  mainSearch: "collision repair brampton",
  local: { mapRank: 3, reviews: 724, rating: 4.5, leaderAvgReviews: 541, leaderAvgRating: 4.8 },
  site: {
    broken: false,
    homepage: { url: "https://performancecollisionbrampton.ca/", title: "Performance Collision Brampton | Collision Repair Mississauga", h1: "(905) 457-1684" },
    missingDescription: [
      "https://performancecollisionbrampton.ca/services/auto-body-repair/",
      "https://performancecollisionbrampton.ca/about/reviews/",
      "https://performancecollisionbrampton.ca/services/glass-repair/",
      "https://performancecollisionbrampton.ca/services/rental-vehicles/",
    ],
  },
  keywords: [{ keyword: "auto body shop brampton", monthlySearches: 590, cpcUsd: 6, position: 2 }],
};
const shop905: PlanInput = {
  business: { name: "905 AutoCare", category: "Collision Repair, Mechanic Repair", city: "brampton", website: "905autocare.wixsite.com", goals: ["calls"] },
  mainSearch: "collision repair brampton",
  local: null,
  site: { broken: true, homepage: { url: "https://905autocare.wixsite.com/", title: null, h1: null }, missingDescription: [] },
  keywords: [],
};

describe("action plan from evidence", () => {
  const plan = rulePlan(input);
  it("a shop behind on Maps, reviews and rating gets each of those, with its numbers", () => {
    expect(plan.map((d) => d.kind)).toEqual(["gbp_profile", "review_request", "review_reply", "new_page"]);
    expect(plan[0].title).toBe("Move from #6 toward the top 3 in Google Maps");
    expect(plan[1].why).toContain("85");
    expect(plan[1].why).toContain("400");
    expect(plan[3].keyword).toBe("collision repair near me");
  });
  it("review requests follow Google's rules (no incentives, no gating)", () => {
    expect(plan[1].content).toMatch(/never offer anything/i);
    expect(plan[1].content).toMatch(/every customer/i);
  });
  it("value = searches × cost per click × page-1 share, only for keywords we have data for", () => {
    expect(estimatedValue(input, "collision repair near me")).toBe(2166);
    expect(estimatedValue(input, "made up keyword")).toBeNull();
    expect(estimatedValue(input, null)).toBeNull();
  });

  it("Performance Collision: fix the phone-number heading and the rating, never 'get more reviews'", () => {
    const p = rulePlan(performance);
    const titles = p.map((d) => d.title);
    expect(titles[0]).toBe('Change your homepage\'s main heading to "Collision Repair in Brampton"');
    expect(p[0].why).toContain("(905) 457-1684");
    expect(titles).toContain("Add descriptions to 4 pages");
    expect(titles).toContain("Lift your rating from 4.5★ toward 4.8★");
    expect(p.find((d) => d.kind === "review_reply")!.why).toContain("more reviews than them (724 vs 541)");
    expect(p.some((d) => d.kind === "review_request")).toBe(false); // 724 > 541
    expect(p.some((d) => d.kind === "gbp_profile")).toBe(false); // already #3 in Maps
    // Their title already says "Collision" and "Brampton": no busywork.
    expect(titles).not.toContain("Put your service and city in your homepage title");
  });

  it("905 AutoCare: a site that doesn't load comes first, and nothing generic is invented", () => {
    const p = rulePlan(shop905);
    expect(p.map((d) => d.title)).toEqual(["Your website didn't load when we checked it"]);
  });

  it("Kolar: a directory entered as the shop's website is caught, and no website advice is built on it", () => {
    expect(looksLikeTheirs("Kolar Auto Collison", "mechanicar.com", { title: "MechaniCar Inc. – Find a trusted garage in your city", h1: "Find a trusted garage in your city" })).toBe(false);
    expect(looksLikeTheirs("Performance Collision", "performancecollisionbrampton.ca", null)).toBe(true);
    expect(looksLikeTheirs("905 AutoCare", "905autocare.wixsite.com", null)).toBe(true);
    expect(looksLikeTheirs("The Collision COLLECTIVE LLC", "collisioncollective.com", null)).toBe(true);
    const p = rulePlan({
      ...input,
      business: { ...input.business, name: "Kolar Auto Collison", website: "mechanicar.com" },
      local: null,
      keywords: [],
      site: { broken: false, homepage: { url: "https://mechanicar.com/", title: "MechaniCar Inc. – Find a trusted garage in your city", h1: "Find a trusted garage in your city" }, missingDescription: ["a", "b"], notTheirs: true },
    });
    expect(p.map((d) => d.title)).toEqual(["Check the website on file: mechanicar.com may not be Kolar Auto Collison's"]);
  });

  it("headings that say nothing are spotted", () => {
    expect(weakHeading("(905) 457-1684", "collision repair")).toBe(true);
    expect(weakHeading(null, "collision repair")).toBe(true);
    expect(weakHeading("Welcome!", "collision repair")).toBe(true);
    expect(weakHeading("Collision Repair in Brampton", "collision repair")).toBe(false);
  });
});

describe.runIf(hasDb)("action plan storage", () => {
  let owner: { id: string };
  let other: { id: string };
  let orgId: string;
  let otherOrg: string;
  const run = <T,>(fn: Parameters<typeof withOrg<T>>[2]) => withOrg(owner.id, orgId, fn);

  beforeAll(async () => {
    owner = await createUser("planner");
    other = await createUser("planner-b");
    orgId = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acme.example", category: "Collision repair", serviceArea: "Ottawa, ON" });
    otherOrg = await createOrganization(other.id, { name: "Other" });
    // Evidence to plan from: one Google Maps check, behind on reviews and rating.
    await withOrg(owner.id, orgId, (tx) =>
      seedBaseline(tx, orgId, {
        keyword: "collision repair ottawa",
        country: "CA",
        day: "2026-10-01",
        dataSource: "sandbox",
        values: { mapRank: 6, organicRank: 14, rating: 4.4, reviews: 85, leaderAvgRating: 4.8, leaderAvgReviews: 400, aiOverview: null, aiCited: null },
      }),
    );
  });
  beforeEach(() => asOwner((c) => c.query("TRUNCATE action_items, site_changes CASCADE")));

  it("builds a plan from the shop's own numbers, and 'I did this' logs the change on Progress", async () => {
    const r = await refreshPlan(orgId, (fn) => run((tx) => fn(tx)));
    expect(r.source).toBe("rules");
    const { open } = await run((tx) => listActions(tx, orgId));
    expect(open.map((a) => a.kind).sort()).toEqual(["gbp_profile", "review_reply", "review_request"]);
    expect(await run((tx) => markActionDone(tx, { orgId, userId: owner.id }, open[0].id))).toBe(true);
    expect(await run((tx) => markActionDone(tx, { orgId, userId: owner.id }, open[0].id))).toBe(false); // only once
    const changes = await run((tx) => tx.select().from(siteChanges));
    expect(changes.map((c) => c.title)).toEqual([open[0].title]);
  });

  it("refreshing replaces open suggestions but keeps done and dismissed ones, without repeating them", async () => {
    await refreshPlan(orgId, (fn) => run((tx) => fn(tx)));
    const first = await run((tx) => listActions(tx, orgId));
    await run((tx) => markActionDone(tx, { orgId, userId: owner.id }, first.open[0].id));
    await run((tx) => dismissAction(tx, orgId, first.open[1].id));
    await refreshPlan(orgId, (fn) => run((tx) => fn(tx)));
    const second = await run((tx) => listActions(tx, orgId));
    expect(second.done).toHaveLength(1);
    const titles = second.open.map((i) => i.title);
    expect(titles).not.toContain(first.open[0].title);
    expect(titles).not.toContain(first.open[1].title);
  });

  it("another org can't see or touch this plan, and the app can't rewrite an item's text", async () => {
    await refreshPlan(orgId, (fn) => run((tx) => fn(tx)));
    const { open } = await run((tx) => listActions(tx, orgId));
    expect(await withOrg(other.id, otherOrg, (tx) => tx.select().from(actionItems))).toEqual([]);
    expect(await withOrg(other.id, otherOrg, (tx) => markActionDone(tx, { orgId: otherOrg, userId: other.id }, open[0].id))).toBe(false);
    await expectDbError(run((tx) => tx.execute(sql`UPDATE action_items SET content = 'tampered'`)), /permission denied/);
  });
});
