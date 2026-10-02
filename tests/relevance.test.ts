import { describe, expect, it } from "vitest";
import { industriesFor, judgeSearch, seedsFor, servicesFrom } from "@/server/keywords/relevance";

// Real searches the old keyword plan recommended to real shops (October 2026).
const perf = { category: "Collision Repai", city: "Brampton", brand: "Performance Collision" };
const shop905 = { category: "Collision Repair, Mechanic Repair", city: "Brampton", brand: "905 AutoCare" };
const kolar = { category: "Collision repair", city: "Brampton", brand: "Kolar Auto Collison" };
const collective = { category: "Shop buying group, shop rebates, independent collision. Shops", city: "", brand: "The Collision COLLECTIVE LLC" };
const topic = (k: string, p: typeof perf) => judgeSearch(k, p).topic;

describe("which searches a customer of this business would type", () => {
  it("knows the trade from the owner's words, typos and lists included", () => {
    expect(industriesFor(perf.category).map((i) => i.id)).toEqual(["collision"]);
    expect(industriesFor(shop905.category).map((i) => i.id)).toEqual(["collision", "mechanic"]);
    expect(industriesFor(collective.category)).toEqual([]); // sells to shops, not drivers
    expect(servicesFrom(shop905.category)).toEqual(["collision repair", "mechanic repair"]);
  });

  it("drops what the old plan told a collision shop to build pages for", () => {
    for (const k of ["collision", "collision report", "rear end collision", "ac repair", "ac repair near me", "appliance repair", "tire", "pawn shop", "garage door repair", "auto", "fender meaning", "define fender", "car fender", "how to fix hail damage on a car"]) {
      expect([k, topic(k, kolar)]).toEqual([k, null]);
    }
  });

  it("keeps real collision searches and groups them by service", () => {
    expect(topic("collision repair brampton", perf)).toBe("collision repair");
    expect(topic("auto body shop near me", perf)).toBe("auto body");
    expect(topic("brampton auto body shop", perf)).toBe("auto body");
    expect(topic("bumper repair cost", perf)).toBe("bumper repair");
    expect(topic("paintless dent repair", perf)).toBe("dent repair");
    expect(topic("cracked windshield repair", perf)).toBe("windshield and auto glass");
  });

  it("drops searches about another city or a named business", () => {
    expect(topic("collision repair mississauga", perf)).toBeNull();
    expect(topic("atlantic collision inc", perf)).toBeNull();
    expect(topic("performance collision brampton", perf)).toBeNull(); // their own name: they already get those
    // ...unless the shop already ranks for it: then Google counts that suburb as theirs.
    expect(judgeSearch("auto body shop kanata", { ...perf, city: "Ottawa" }, { alreadyRanks: true }).topic).toBe("auto body");
    expect(judgeSearch("appliance repair kanata", { ...perf, city: "Ottawa" }, { alreadyRanks: true }).topic).toBeNull();
  });

  it("covers both trades for a shop that does both", () => {
    expect(topic("brake repair brampton", shop905)).toBe("brake repair");
    expect(topic("auto body shop brampton", shop905)).toBe("auto body");
    expect(topic("brake repair brampton", perf)).toBeNull();
  });

  it("never offers a buying group pawn shops, stocks or groceries", () => {
    for (const k of ["pawn shop", "shop stock tsx", "your independent grocer", "stag shop", "mobile shop", "shop at don mills", "deck shop"]) {
      expect([k, topic(k, collective)]).toEqual([k, null]);
    }
    expect(topic("collision shop buying group", collective)).toBe("collision shop buying group");
  });

  it("researches each listed service, not the raw description", () => {
    expect(seedsFor(shop905.category, "Brampton")).toContain("brake repair brampton");
    expect(seedsFor(perf.category, "Brampton")).toContain("collision repair brampton");
    expect(seedsFor(perf.category, "Brampton").join(" ")).not.toContain("repai ");
  });
});
