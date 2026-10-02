import { describe, expect, it } from "vitest";
import { findGap } from "@/server/competitors/competitors";
import type { SiteKeyword } from "@/server/dataforseo/market";
import { assemblePlan } from "@/server/keywords/plan";
import { judgeSearch } from "@/server/keywords/relevance";

// Golden cases: the exact searches our data provider returned for four real
// businesses on October 2, 2026, when the old keyword plan told a collision
// shop to build pages for "pawn shop" and "appliance repair". If a change
// lets any of that back through, these tests fail before it ships.

type Raw = [keyword: string, searches: number, position: number | null];
const parse = (s: string): Raw[] =>
  s.split(";;").map((x) => {
    const [k, v, p] = x.split("|");
    return [k, Number(v), p ? Number(p) : null];
  });

const KOLAR = parse(
  "ac repair near me|8100|;;ac repair|18100|;;appliance repair near me|12100|;;appliance repair|12100|;;auto repair near me|33100|;;auto repair shop near me|9900|;;auto repair shop|6600|;;auto repair|22200|;;auto service near me|6600|;;auto shop near me|27100|;;auto shop|12100|;;garage door repair near me|6600|;;pawn shop near me|60500|;;tire shop near me|110000|;;windshield repair near me|9900|;;windshield repair|18100|",
);
const PERFORMANCE = parse(
  "auto body shop brampton|880|5;;auto body shop near me|22200|31;;auto glass repair brampton|320|5;;body car repair near me|3600|83;;brampton auto body shop|880|2;;brampton auto glass repair|720|6;;collision report|1300|;;collision|12100|;;cracked windshield repair|3600|36;;rear end collision|1000|;;windshield repair brampton|720|5;;windshield repair in brampton|720|5",
);
const COLLECTIVE = parse(
  "deck shop|8100|;;items shops|14800|;;pawn shop|49500|;;shop stock tsx|33100|;;shops at don mills|27100|;;stag shop|49500|;;the mobile shop|49500|;;your independent grocer|40500|",
);
// Searches the Competitors page showed as "gaps" for Collision Collective (from ProColor and CARSTAR).
const COLLECTIVE_GAP = ["fender car", "carrossier", "car fender", "carrosserie longueuil", "carrosserie iberville", "how to fix hail damage on a car", "define fender", "fender meaning", "fenders meaning"];

function plan(business: { name: string; city: string; domain: string; category: string }, raw: Raw[]) {
  const ideas = raw.filter((r) => r[2] === null).map(([keyword, searches]) => ({ keyword, searches, cpcUsd: 5 }));
  const site: SiteKeyword[] = raw
    .filter((r) => r[2] !== null)
    .map(([keyword, searches, position]) => ({ keyword, searches, cpcUsd: 5, position: position!, url: `https://${business.domain}/`, trafficEst: 1 }));
  const p = assemblePlan({ business, ideas, site, pages: new Map(), serp: new Map() });
  return { topics: p.topics.map((t) => t.name), keywords: p.topics.flatMap((t) => t.keywords.map((k) => k.keyword)) };
}

describe("golden: real businesses, real search data", () => {
  it("Kolar Auto Collision (collision shop): no AC, appliances, garage doors, pawn shops or tires", () => {
    const p = plan({ name: "Kolar Auto Collison", city: "brampton", domain: "kolarauto.ca", category: "Collision repair" }, KOLAR);
    expect(p.keywords.join(" ")).not.toMatch(/\bac repair|appliance|garage door|pawn|tire|auto repair|auto shop|auto service/);
    expect(p.keywords).toEqual(expect.arrayContaining(["windshield repair", "windshield repair near me"]));
  });

  it("Performance Collision: no dictionary or accident searches; keeps the body shop and glass searches", () => {
    const p = plan({ name: "Performance Collision", city: "brampton", domain: "performancecollisionbrampton.ca", category: "Collision Repai" }, PERFORMANCE);
    expect(p.keywords).not.toEqual(expect.arrayContaining(["collision"]));
    expect(p.keywords.join(" ")).not.toMatch(/collision report|rear end collision/);
    expect(p.topics).toEqual(expect.arrayContaining(["auto body", "windshield and auto glass"]));
    expect(p.keywords).toEqual(expect.arrayContaining(["auto body shop brampton", "brampton auto body shop", "auto body shop near me"]));
  });

  it("Collision Collective (buying group): none of the pawn shops, stocks or groceries", () => {
    const p = plan({ name: "The Collision COLLECTIVE LLC", city: "", domain: "collisioncollective.com", category: "Shop buying group, shop rebates, independent collision. Shops" }, COLLECTIVE);
    expect(p.keywords).toEqual([]);
  });

  it("Collision Collective's competitor gaps: no consumer 'fender meaning' or Quebec body shops", () => {
    const profile = { category: "Shop buying group, shop rebates, independent collision. Shops", city: "", brand: "The Collision COLLECTIVE LLC" };
    for (const k of COLLECTIVE_GAP) expect([k, judgeSearch(k, profile).topic]).toEqual([k, null]);
    const kw = (keyword: string, position: number): SiteKeyword => ({ keyword, position, searches: 500, cpcUsd: 2, url: null, trafficEst: 1 });
    const gap = findGap("collisioncollective.com", [], [{ domain: "carstar.com", keywords: COLLECTIVE_GAP.map((k) => kw(k, 3)) }], 30, (k) => judgeSearch(k, profile).topic !== null);
    expect(gap).toEqual([]);
  });

  it("a real collision shop's competitor gap keeps real repair searches", () => {
    const profile = { category: "Collision repair", city: "Brampton", brand: "Kolar Auto Collision" };
    const kw = (keyword: string): SiteKeyword => ({ keyword, position: 2, searches: 500, cpcUsd: 6, url: null, trafficEst: 1 });
    const gap = findGap("kolarauto.ca", [], [{ domain: "rival.ca", keywords: ["collision repair brampton", "bumper repair brampton", "fender meaning", "carrossier"].map(kw) }], 30, (k) => judgeSearch(k, profile).topic !== null);
    expect(gap.map((g) => g.keyword).sort()).toEqual(["bumper repair brampton", "collision repair brampton"]);
  });
});
