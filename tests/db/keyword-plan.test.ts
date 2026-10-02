import { beforeAll, describe, expect, it } from "vitest";
import { listActions } from "@/server/actions/plan";
import { keywordPlans } from "@/server/db/schema";
import { createOrganization, withOrg } from "@/server/db/tenant";
import {
  addTopicToActions,
  assemblePlan,
  buildKeywordPlan,
  changeFor,
  loadPlan,
  pageMatches,
  savePlan,
  topicStatus,
} from "@/server/keywords/plan";
import { fakeDataForSeo } from "../fixtures/dataforseo";
import { createUser, expectDbError, hasDb } from "./helpers";

const business = { name: "Acme Collision", city: "ottawa", domain: "acmecollision.ca", category: "Collision repair" };

describe("keyword plan rules", () => {
  it("checks whether a page's title or heading uses the topic's words", () => {
    expect(pageMatches("bumper repair", "Bumper Repairs | Acme", null)).toBe(true);
    expect(pageMatches("bumper repair", "Acme – Auto Body Shop", "Trusted body shop")).toBe(false);
    expect(pageMatches("bumper repair", null, null)).toBeNull();
  });
  it("aligned = on page 1 with matching words; weak = there but not matching or not page 1; missing = absent", () => {
    expect(topicStatus(4, true)).toBe("aligned");
    expect(topicStatus(4, false)).toBe("weak");
    expect(topicStatus(14, true)).toBe("weak");
    expect(topicStatus(null, null)).toBe("missing");
  });
  it("never tells the owner to retitle the homepage for one service: it suggests a dedicated page", () => {
    const kws = [{ keyword: "bumper repair ottawa", searches: 390, cpcUsd: 9, position: 11, url: "https://acmecollision.ca/", adsBy: null, top3: null }];
    const home = changeFor({ name: "bumper repair", status: "weak", keywords: kws, page: { url: "https://acmecollision.ca/", title: "Acme", h1: null }, bestPosition: 11 }, business);
    expect(home?.kind).toBe("new_page");
    expect(home?.content).toContain("Page title (under 60 characters): Bumper Repair in Ottawa | Acme Collision");
    const own = changeFor({ name: "bumper repair", status: "weak", keywords: kws, page: { url: "https://acmecollision.ca/bumpers", title: "Bumpers", h1: null }, bestPosition: 11 }, business);
    expect(own?.kind).toBe("page_title");
    expect(changeFor({ name: "x", status: "aligned", keywords: kws, page: null, bestPosition: 3 }, business)).toBeNull();
  });
});

describe.runIf(hasDb)("keyword plan", () => {
  let owner: { id: string };
  let orgId: string;
  beforeAll(async () => {
    owner = await createUser("kw");
    orgId = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acmecollision.ca", category: "Collision repair", serviceArea: "Ottawa, ON", country: "CA" });
  });

  it("discovers searches, checks who pays and ranks, and judges each topic", async () => {
    const d = fakeDataForSeo();
    const plan = await buildKeywordPlan(d.transport, { ...business, country: "CA" }, null);
    const names = plan.topics.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["collision repair", "bumper repair", "car paint"]));
    expect(names.join(" ")).not.toMatch(/jobs|acme|yourself/);
    const collision = plan.topics.find((t) => t.name === "collision repair")!;
    expect(collision.keywords.map((k) => k.keyword)).toEqual(expect.arrayContaining(["collision repair near me", "collision repair ottawa"]));
    // Fixture: the site ranks #14 for "collision repair near me" → weak.
    expect(collision.status).toBe("weak");
    expect(collision.keywords.find((k) => k.keyword === "collision repair ottawa")?.adsBy).toEqual(["rivalautobody.ca", "fastfixcollision.com"]);
    expect(plan.topics.find((t) => t.name === "car paint")?.status).toBe("missing");
    expect(plan.totalValueUsd).toBeGreaterThan(0);
  });

  it("plans are private, and 'add to action plan' uses the stored plan once", async () => {
    const plan = assemblePlan({
      business,
      ideas: [{ keyword: "car painting ottawa", searches: 390, cpcUsd: 6.4 }],
      site: [],
      pages: new Map(),
      serp: new Map(),
    });
    await withOrg(owner.id, orgId, (tx) => savePlan(tx, orgId, "live", plan));
    const loaded = await withOrg(owner.id, orgId, (tx) => loadPlan(tx, orgId));
    const topic = loaded!.plan.topics[0];
    expect(topic.change?.kind).toBe("new_page");
    expect(await withOrg(owner.id, orgId, (tx) => addTopicToActions(tx, orgId, topic))).toBe(true);
    expect(await withOrg(owner.id, orgId, (tx) => addTopicToActions(tx, orgId, topic))).toBe(false);
    const { open } = await withOrg(owner.id, orgId, (tx) => listActions(tx, orgId));
    expect(open.map((a) => a.title)).toContain('Add a "Car Paint" page');

    const other = await createUser("kw-other");
    const otherOrg = await createOrganization(other.id, { name: "Other" });
    expect(await withOrg(other.id, otherOrg, (tx) => tx.select().from(keywordPlans))).toEqual([]);
    await expectDbError(withOrg(owner.id, orgId, (tx) => tx.update(keywordPlans).set({ data: {} })), /permission denied/);
  });
});
