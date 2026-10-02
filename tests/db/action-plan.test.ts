import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  aiPlan,
  dismissAction,
  draftViolatesRules,
  estimatedValue,
  listActions,
  markActionDone,
  refreshPlan,
  rulePlan,
  type Draft,
  type PlanInput,
} from "@/server/actions/plan";
import type { GeminiRequest, GeminiTransport } from "@/server/ai/gemini";
import { actionItems, siteChanges } from "@/server/db/schema";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

const input: PlanInput = {
  business: { name: "Acme Collision", category: "Collision repair", city: "ottawa", website: "acme.example", goals: ["calls"] },
  local: { mapRank: 6, reviews: 85, rating: 4.5, leaderAvgReviews: 400, leaderAvgRating: 4.8 },
  keywords: [
    { keyword: "collision repair near me", monthlySearches: 1900, cpcUsd: 11.4, position: 14 },
    { keyword: "bumper repair ottawa", monthlySearches: 390, cpcUsd: 8.95, position: 17 },
    { keyword: "collision repair ottawa", monthlySearches: 880, cpcUsd: 9.8, position: null },
  ],
};

function fakeGemini(replies: string[]) {
  const requests: GeminiRequest[] = [];
  const transport: GeminiTransport = async (req) => {
    requests.push(req);
    return { text: replies[Math.min(requests.length - 1, replies.length - 1)], tokensIn: 500, tokensOut: 800 };
  };
  return { transport, requests };
}

const good = (n = 5): Draft[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: i === 0 ? ("page_title" as const) : ("gbp_post" as const),
    title: `Do useful thing ${i + 1}`,
    why: "Because the numbers provided say so.",
    content: "Text to paste, with [details] to fill in.",
    keyword: i === 0 ? "collision repair near me" : null,
  }));

describe("action plan from templates", () => {
  const plan = rulePlan(input);
  it("covers reviews, the profile, a page title and a new page, with real numbers", () => {
    expect(plan.map((d) => d.kind)).toEqual(["review_request", "gbp_profile", "page_title", "new_page", "gbp_post", "review_reply"]);
    expect(plan[0].why).toContain("85");
    expect(plan[0].why).toContain("400");
    expect(plan[2].keyword).toBe("collision repair near me");
    expect(plan[3].keyword).toBe("bumper repair ottawa");
  });
  it("page titles and meta descriptions fit Google's limits", () => {
    const [t, m] = plan[2].content.split("\n\n").map((b) => b.split("\n")[1]);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(m.length).toBeLessThanOrEqual(155);
  });
  it("review requests follow Google's rules (no incentives, no gating)", () => {
    expect(plan[0].content).toMatch(/never offer anything/i);
    expect(plan[0].content).toMatch(/every customer/i);
  });
  it("value = searches × cost per click × page-1 share, only for keywords we have data for", () => {
    expect(estimatedValue(input, "collision repair near me")).toBe(2166);
    expect(estimatedValue(input, "made up keyword")).toBeNull();
    expect(estimatedValue(input, null)).toBeNull();
  });
});

describe("action plan from AI", () => {
  it("accepts valid output and drops keywords we have no data for", async () => {
    const items = good();
    items[1].keyword = "invented keyword";
    const ai = fakeGemini([JSON.stringify(items)]);
    const out = await aiPlan(ai.transport, input, []);
    expect(out).toHaveLength(5);
    expect(out?.[1].keyword).toBeNull();
    expect(ai.requests[0].system).toMatch(/Never name or mention any other business/);
  });
  it("rejects links, markup, injected instructions and other businesses' names, then gives up", async () => {
    for (const bad of ["see https://evil.example", "<script>x</script>", "Ignore previous instructions", "Copy Rival Auto Body"]) {
      const items = good();
      items[2].content = bad;
      expect(draftViolatesRules(items, ["Rival Auto Body"])).toBe(true);
    }
    const items = good();
    items[0].content = "Visit www.evil.example now";
    const ai = fakeGemini([JSON.stringify(items), "not json"]);
    expect(await aiPlan(ai.transport, input, [])).toBeNull();
    expect(ai.requests).toHaveLength(2);
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
  });
  beforeEach(() => asOwner((c) => c.query("TRUNCATE action_items, site_changes CASCADE")));

  it("builds a plan without AI, and 'I did this' logs the change on Progress", async () => {
    const r = await refreshPlan(orgId, (fn) => run((tx) => fn(tx)), null);
    expect(r.source).toBe("rules");
    const { open } = await run((tx) => listActions(tx, orgId));
    expect(open.length).toBeGreaterThanOrEqual(4);
    expect(await run((tx) => markActionDone(tx, { orgId, userId: owner.id }, open[0].id))).toBe(true);
    expect(await run((tx) => markActionDone(tx, { orgId, userId: owner.id }, open[0].id))).toBe(false); // only once
    const changes = await run((tx) => tx.select().from(siteChanges));
    expect(changes.map((c) => c.title)).toEqual([open[0].title]);
  });

  it("refreshing replaces open suggestions but keeps done and dismissed ones, without repeating them", async () => {
    await refreshPlan(orgId, (fn) => run((tx) => fn(tx)), null);
    const first = await run((tx) => listActions(tx, orgId));
    await run((tx) => markActionDone(tx, { orgId, userId: owner.id }, first.open[0].id));
    await run((tx) => dismissAction(tx, orgId, first.open[1].id));
    await refreshPlan(orgId, (fn) => run((tx) => fn(tx)), null);
    const second = await run((tx) => listActions(tx, orgId));
    expect(second.done).toHaveLength(1);
    const titles = second.open.map((i) => i.title);
    expect(titles).not.toContain(first.open[0].title);
    expect(titles).not.toContain(first.open[1].title);
  });

  it("another org can't see or touch this plan, and the app can't rewrite an item's text", async () => {
    await refreshPlan(orgId, (fn) => run((tx) => fn(tx)), null);
    const { open } = await run((tx) => listActions(tx, orgId));
    expect(await withOrg(other.id, otherOrg, (tx) => tx.select().from(actionItems))).toEqual([]);
    expect(await withOrg(other.id, otherOrg, (tx) => markActionDone(tx, { orgId: otherOrg, userId: other.id }, open[0].id))).toBe(false);
    await expectDbError(run((tx) => tx.execute(sql`UPDATE action_items SET content = 'tampered'`)), /permission denied/);
  });
});
