import { beforeAll, describe, expect, it } from "vitest";
import { listActions } from "@/server/actions/plan";
import {
  addCompetitor,
  addGapToActions,
  buildReport,
  CompetitorLimitError,
  findGap,
  InvalidDomainError,
  isBrandSearch,
  pickSuggestions,
  listCompetitors,
  loadReport,
  removeCompetitor,
  saveReport,
} from "@/server/competitors/competitors";
import type { SiteKeyword } from "@/server/dataforseo/market";
import { competitorReports, competitors } from "@/server/db/schema";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { answersSchema } from "@/server/onboarding/answers";
import { phraseCandidates } from "@/server/assessment/result";
import { fakeDataForSeo } from "../fixtures/dataforseo";
import { asAppUserRaw, createUser, hasDb } from "./helpers";

const k = (keyword: string, position: number, searches = 100, cpcUsd = 5): SiteKeyword => ({ keyword, position, searches, cpcUsd, url: null, trafficEst: 1 });

describe("competitor gap rules", () => {
  it("a rival's own name isn't a search you can win", () => {
    expect(isBrandSearch("riverside collision reviews", "riversidecollision.ca")).toBe(true);
    expect(isBrandSearch("collision repair ottawa", "riversidecollision.ca")).toBe(false);
  });

  it("finds searches a rival is on page 1 for and you aren't, most valuable first", () => {
    const yours = [k("bumper repair ottawa", 14), k("dent repair ottawa", 2)];
    const gap = findGap("acme.ca", yours, [
      { domain: "rival.ca", keywords: [k("collision repair ottawa", 3, 880, 9.8), k("bumper repair ottawa", 5, 390, 9), k("dent repair ottawa", 6), k("rival reviews", 1, 500), k("auto glass ottawa", 25)] },
      { domain: "other.ca", keywords: [k("collision repair ottawa", 1, 880, 9.8)] },
    ]);
    expect(gap.map((g) => [g.keyword, g.competitor, g.theirPosition, g.yourPosition])).toEqual([
      ["collision repair ottawa", "other.ca", 1, null],
      ["bumper repair ottawa", "rival.ca", 5, 14],
    ]);
  });
});

describe("suggested competitors", () => {
  const listing = (rank: number, name: string, domain: string | null, rating: number | null = 4.6, reviews: number | null = 200) => ({
    rank, name, domain, rating, reviews, category: "Auto body shop",
  });
  it("puts the shops above you in Google Maps first, skipping you, tracked rivals and directories", () => {
    const s = pickSuggestions(
      "acme.ca",
      ["tracked.ca"],
      {
        keyword: "collision repair ottawa",
        listings: [
          listing(1, "Best Body", "www.BestBody.ca"),
          listing(2, "Acme", "acme.ca"),
          listing(3, "Tracked", "tracked.ca"),
          listing(4, "No Site", null),
          listing(5, "On Yelp", "yelp.ca"),
          listing(6, "Quick Fix", "quickfix.ca", null, null),
        ],
      },
      [{ domain: "bestbody.ca", sharedSearches: 40 }, { domain: "overlap.ca", sharedSearches: 12 }],
    );
    expect(s).toEqual([
      { domain: "bestbody.ca", sharedSearches: 0, reason: 'Best Body: #1 in Google Maps for "collision repair ottawa", 4.6★ from 200 reviews' },
      { domain: "quickfix.ca", sharedSearches: 0, reason: 'Quick Fix: #6 in Google Maps for "collision repair ottawa"' },
      { domain: "overlap.ca", sharedSearches: 12 },
    ]);
  });
  it("works without a map (nationwide business)", () => {
    expect(pickSuggestions("acme.ca", [], null, [{ domain: "overlap.ca", sharedSearches: 12 }])).toEqual([{ domain: "overlap.ca", sharedSearches: 12 }]);
  });
});

describe("customer phrases in the free check", () => {
  it("keeps up to 3 clean phrases, one per line", () => {
    const a = answersSchema.parse({
      website: "acme.ca", name: "Acme", category: "Collision repair", serviceArea: "Ottawa, ON", countries: ["CA"], goals: ["calls"],
      adSpendRange: "none", websiteManager: "self", phrases: "Collision Repair Near Me\n\nbody shop ottawa\n<script>\nx\nfourth one\nfifth",
    });
    expect(a.phrases).toEqual(["collision repair near me", "body shop ottawa", "fourth one"]);
  });
  it("adds the city to a local phrase unless it already names a place or says near me", () => {
    expect(phraseCandidates(["body shop", "collision repair near me", "body shop ottawa"], "Ottawa, ON", "local")).toEqual([
      "body shop", "body shop ottawa", "collision repair near me",
    ]);
  });
});

describe.runIf(hasDb)("competitors (database)", () => {
  let owner: { id: string };
  let other: { id: string };
  let org: string;
  let otherOrg: string;

  beforeAll(async () => {
    [owner, other] = await Promise.all(["c-owner", "c-other"].map(createUser));
    org = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acmecollision.ca", country: "CA" });
    otherOrg = await createOrganization(other.id, { name: "Other Shop", websiteDomain: "othershop.ca" });
  });

  it("adds competitors by website, refuses your own site, and caps at 5", async () => {
    await withOrg(owner.id, org, async (tx) => {
      expect(await addCompetitor(tx, org, "https://www.RivalAutoBody.ca/about")).toBe("rivalautobody.ca");
      await expect(addCompetitor(tx, org, "acmecollision.ca")).rejects.toBeInstanceOf(InvalidDomainError);
      await expect(addCompetitor(tx, org, "not a site")).rejects.toBeInstanceOf(InvalidDomainError);
      for (const d of ["b.ca", "c.ca", "d.ca", "e.ca"]) await addCompetitor(tx, org, d);
      await expect(addCompetitor(tx, org, "f.ca")).rejects.toBeInstanceOf(CompetitorLimitError);
      const list = await listCompetitors(tx, org);
      expect(list).toHaveLength(5);
      for (const c of list.slice(1)) await removeCompetitor(tx, org, c.id);
      expect((await listCompetitors(tx, org)).map((c) => c.domain)).toEqual(["rivalautobody.ca"]);
    });
  });

  it("builds a report: traffic, the searches bringing customers, ads, gap and suggestions", async () => {
    const dfs = fakeDataForSeo();
    const r = await buildReport(dfs.transport, "acmecollision.ca", ["rivalautobody.ca"], "CA");
    expect(r.you.domain).toBe("acmecollision.ca");
    expect(r.rivals.map((s) => s.domain)).toEqual(["rivalautobody.ca"]);
    expect(r.you.ok).toBe(true);
    // Generic sites and ones already tracked are never suggested.
    expect(r.suggestions.map((s) => s.domain)).toEqual(["fastfixcollision.com"]);
    await withOrg(owner.id, org, (tx) => saveReport(tx, org, "sandbox", r));
    const saved = await withOrg(owner.id, org, (tx) => loadReport(tx, org));
    expect(saved?.report.you.domain).toBe("acmecollision.ca");
  });

  it("suggests the businesses above you in Google Maps for your main search", async () => {
    const r = await buildReport(fakeDataForSeo().transport, "acmecollision.ca", ["rivalautobody.ca"], "CA", { mapsSearch: "collision repair ottawa" });
    expect(r.suggestions.map((s) => s.domain)).toEqual(["capitalcollision.ca", "fastfixcollision.com"]);
    expect(r.suggestions[0].reason).toContain('#2 in Google Maps for "collision repair ottawa"');
  });

  it("a failed lookup is shown as not checked, not as zero", async () => {
    const r = await buildReport(async () => { throw new Error("down"); }, "acmecollision.ca", ["rivalautobody.ca"], "CA");
    expect(r.rivals[0]).toMatchObject({ ok: false, trafficEst: null });
  });

  it("adds a gap search to the action plan once, using only the saved report", async () => {
    const report = {
      you: { domain: "acmecollision.ca", trafficEst: 10, keywords: 5, top10: 1, paidKeywords: 0, trafficValueUsd: 0, topSearches: [], ok: true },
      rivals: [],
      gap: [{ keyword: "collision repair ottawa", searches: 880, cpcUsd: 9.8, competitor: "rivalautobody.ca", theirPosition: 2, yourPosition: null }],
      suggestions: [],
    };
    await withOrg(owner.id, org, async (tx) => {
      await saveReport(tx, org, "live", report);
      expect(await addGapToActions(tx, org, report.gap[0])).toBe(true);
      expect(await addGapToActions(tx, org, report.gap[0])).toBe(false);
      const { open } = await listActions(tx, org);
      expect(open.some((a) => a.title === 'Win "collision repair ottawa" (rivalautobody.ca is #2)' && a.kind === "new_page")).toBe(true);
    });
  });

  it("another business never sees your competitors or reports", async () => {
    await withOrg(other.id, otherOrg, async (tx) => {
      expect(await tx.select().from(competitors)).toEqual([]);
      expect(await tx.select().from(competitorReports)).toEqual([]);
    });
    await asAppUserRaw(async (c) => {
      expect((await c.query("SELECT count(*)::int AS n FROM competitors")).rows[0].n).toBe(0);
      await expect(c.query("UPDATE competitor_reports SET data = '{}'")).rejects.toThrow(/permission denied/);
    });
  });
});
