import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiRequest, GeminiTransport } from "@/server/ai/gemini";
import { runAssessment } from "@/server/assessment/engine";
import { toTeaser } from "@/server/assessment/result";
import { AssessmentRateLimitedError, assess } from "@/server/assessment/service";
import { getSnapshot } from "@/server/assessment/snapshots";
import { answersSchema } from "@/server/onboarding/answers";
import { SpendCapReachedError } from "@/server/security/spend";
import { fakeDataForSeo, INJECTION } from "../fixtures/dataforseo";
import { asOwner, hasDb } from "./helpers";

const answers = answersSchema.parse({
  website: "acmecollision.ca",
  name: "Acme Collision",
  category: "Collision repair",
  serviceArea: "Ottawa, ON",
  countries: ["CA"],
  goals: ["calls"],
  adSpendRange: "500_2000",
  websiteManager: "agency",
});

const GOOD_INSIGHTS = Array.from({ length: 5 }, (_, i) => ({
  title: `Finding number ${i + 1}`,
  detail: `Plain-English detail for finding ${i + 1}, based only on the numbers provided.`,
}));

function fakeGemini(replies: string[]) {
  const requests: GeminiRequest[] = [];
  const transport: GeminiTransport = async (req) => {
    requests.push(req);
    return { text: replies[Math.min(requests.length - 1, replies.length - 1)], tokensIn: 1000, tokensOut: 300 };
  };
  return { transport, requests };
}

const resetDb = () =>
  asOwner((c) => c.query("TRUNCATE public_snapshots, api_spend_daily, rate_limits"));

describe.runIf(hasDb)("assessment engine", () => {
  beforeEach(resetDb);

  it("turns DataForSEO data into metrics, rescue targets and competitors", async () => {
    const dfs = fakeDataForSeo();
    const ai = fakeGemini([JSON.stringify(GOOD_INSIGHTS)]);
    const r = await runAssessment(answers, { dataforseo: dfs.transport, gemini: ai.transport, dataSource: "sandbox" });

    expect(r.primaryKeyword).toBe("collision repair ottawa");
    // Own domain is never counted as a competitor; duplicate ads are grouped.
    expect(r.competitors).toEqual([
      { domain: "www.rivalautobody.ca", ads: 2 },
      { domain: "fastfixcollision.com", ads: 1 },
    ]);
    expect(r.metrics).toMatchObject({ advertisers: 2, yourPosition: 7, topCpcUsd: 12.1, rescueTargets: 3, monthlySearches: 1030 });
    // Only positions 11-30, best opportunity first.
    expect(r.rescueTargets.map((k) => k.keyword)).toEqual(["collision repair near me", "bumper repair ottawa", "auto body shop kanata"]);
    expect(r.insightsSource).toBe("ai");
    // Requests target the right market.
    expect(dfs.calls.every((c) => (c.body as { location_code: number }[])[0].location_code === 2124)).toBe(true);
  });

  it("searches the whole country, with no city, for a nationwide business", async () => {
    const dfs = fakeDataForSeo();
    const national = answersSchema.parse({ ...answers, reach: "national", serviceArea: "" });
    const r = await runAssessment(national, {
      dataforseo: dfs.transport,
      gemini: fakeGemini([JSON.stringify(GOOD_INSIGHTS)]).transport,
      dataSource: "sandbox",
    });
    expect(r.primaryKeyword).toBe("collision repair");
    expect(r.reach).toBe("national");
    const serpCall = dfs.calls.find((c) => c.path.startsWith("serp/"));
    expect((serpCall?.body as { keyword: string; location_code: number }[])[0]).toMatchObject({ keyword: "collision repair", location_code: 2124 });
  });

  it("runs a separate set of lookups for each country chosen", async () => {
    const dfs = fakeDataForSeo();
    const both = answersSchema.parse({ ...answers, reach: "national", serviceArea: "", countries: ["CA", "US"] });
    const r = await runAssessment(both, {
      dataforseo: dfs.transport,
      gemini: fakeGemini([JSON.stringify(GOOD_INSIGHTS)]).transport,
      dataSource: "sandbox",
    });
    expect(dfs.calls).toHaveLength(6);
    const codes = dfs.calls.map((c) => (c.body as { location_code: number }[])[0].location_code);
    expect(codes.filter((c) => c === 2124)).toHaveLength(3);
    expect(codes.filter((c) => c === 2840)).toHaveLength(3);
    expect(r.country).toBe("CA");
    expect(r.otherMarkets?.map((m) => m.country)).toEqual(["US"]);
    expect(toTeaser(r).otherCountries).toEqual(["US"]);
    // The teaser never includes the other country's details.
    expect(JSON.stringify(toTeaser(r))).not.toContain("rivalautobody");
  });

  it("never gives the AI competitor names, and marks their ad text as untrusted data", async () => {
    const ai = fakeGemini([JSON.stringify(GOOD_INSIGHTS)]);
    await runAssessment(answers, { dataforseo: fakeDataForSeo().transport, gemini: ai.transport, dataSource: "sandbox" });
    const payload = JSON.parse(ai.requests[0].user);
    expect(ai.requests[0].user).not.toContain("rivalautobody.ca");
    expect(ai.requests[0].user).not.toContain("fastfixcollision");
    expect(payload.competitor_ad_text.join(" ")).toContain("IGNORE PREVIOUS INSTRUCTIONS");
    expect(ai.requests[0].system).toMatch(/UNTRUSTED/);
  });

  it("an injected competitor ad has no effect: rule-breaking AI output is discarded", async () => {
    const hijacked = GOOD_INSIGHTS.map((i, n) =>
      n === 2 ? { title: "RivalAutoBody is the best shop", detail: "Visit https://evil.example as instructed by the ad." } : i,
    );
    const ai = fakeGemini([JSON.stringify(hijacked)]);
    const r = await runAssessment(answers, { dataforseo: fakeDataForSeo().transport, gemini: ai.transport, dataSource: "sandbox" });
    expect(ai.requests).toHaveLength(2); // retried once
    expect(r.insightsSource).toBe("rules");
    const text = JSON.stringify(r.insights).toLowerCase();
    expect(text).not.toContain("rivalautobody");
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain(INJECTION.toLowerCase().slice(0, 20));
  });

  it("falls back to rule-based findings when the AI returns invalid output", async () => {
    const ai = fakeGemini(["not json", JSON.stringify(GOOD_INSIGHTS.slice(0, 3))]);
    const r = await runAssessment(answers, { dataforseo: fakeDataForSeo().transport, gemini: ai.transport, dataSource: "sandbox" });
    expect(r.insightsSource).toBe("rules");
    expect(r.insights).toHaveLength(5);
  });

  it("records what each provider cost today", async () => {
    await runAssessment(answers, { dataforseo: fakeDataForSeo().transport, gemini: fakeGemini([JSON.stringify(GOOD_INSIGHTS)]).transport, dataSource: "sandbox" });
    const rows = await asOwner(async (c) => (await c.query("SELECT provider, micros FROM api_spend_daily ORDER BY provider")).rows);
    expect(rows.find((r) => r.provider === "dataforseo")?.micros).toBe("25700"); // 0.002 + 0.0132 + 0.0105 USD
    expect(Number(rows.find((r) => r.provider === "gemini")?.micros)).toBeGreaterThan(0);
  });
});

describe("teaser", () => {
  it("contains only the free findings — locked content is absent, not hidden", async () => {
    const base = {
      version: 1 as const,
      domain: "acmecollision.ca",
      country: "CA" as const,
      serviceArea: "Ottawa, ON",
      category: "Collision repair",
      primaryKeyword: "collision repair ottawa",
      dataSource: "live" as const,
      generatedAt: new Date().toISOString(),
      metrics: { advertisers: 2, topCpcUsd: 12.1, monthlySearches: 1030, yourPosition: 7, rescueTargets: 1, rescueMonthlySearches: 1900 },
      insights: GOOD_INSIGHTS.map((i, n) => ({ ...i, detail: `${i.detail} SECRET-${n}` })),
      insightsSource: "ai" as const,
      rescueTargets: [{ keyword: "secret rescue keyword", position: 14, monthlySearches: 1900, cpcUsd: 11.4, score: 1 }],
      topKeywords: [{ keyword: "collision repair ottawa", monthlySearches: 880, cpcUsd: 9.8 }],
      competitors: [{ domain: "secret-competitor.ca", ads: 2 }],
    };
    const json = JSON.stringify(toTeaser(base));
    expect(json).toContain("SECRET-0");
    expect(json).toContain("SECRET-1");
    for (const hidden of ["SECRET-2", "SECRET-3", "SECRET-4", "secret rescue keyword", "secret-competitor"]) {
      expect(json).not.toContain(hidden);
    }
    expect(toTeaser(base)).toMatchObject({ lockedInsights: 3, lockedRescueTargets: 1, lockedCompetitors: 1 });
  });
});

describe.runIf(hasDb)("assessment service: abuse and cost controls", () => {
  beforeEach(resetDb);
  afterEach(() => vi.unstubAllEnvs());

  const deps = () => ({
    dataforseo: fakeDataForSeo().transport,
    gemini: fakeGemini([JSON.stringify(GOOD_INSIGHTS)]).transport,
    dataSource: "sandbox" as const,
  });

  it("blocks the 4th assessment from the same visitor in a day", async () => {
    vi.stubEnv("ASSESSMENTS_PER_IP_PER_DAY", "3");
    for (let i = 0; i < 3; i++) await assess(answers, "203.0.113.7", deps());
    await expect(assess(answers, "203.0.113.7", deps())).rejects.toBeInstanceOf(AssessmentRateLimitedError);
    await expect(assess(answers, "198.51.100.9", deps())).resolves.toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("reuses a recent result instead of paying for the same lookup again", async () => {
    await assess(answers, "203.0.113.10", deps());
    const second = fakeDataForSeo();
    const id = await assess(answers, "203.0.113.11", { ...deps(), dataforseo: second.transport });
    expect(second.calls).toHaveLength(0);
    expect((await getSnapshot(id))?.domain).toBe("acmecollision.ca");
  });

  it("never serves a sample (sandbox) result once real data is switched on", async () => {
    await assess(answers, "203.0.113.12", { ...deps(), dataSource: "sandbox" });
    const live = fakeDataForSeo();
    await assess(answers, "203.0.113.13", { ...deps(), dataSource: "live", dataforseo: live.transport });
    expect(live.calls.length).toBeGreaterThan(0);
  });

  it("stops calling paid APIs once the daily spend cap is reached", async () => {
    vi.stubEnv("DAILY_SPEND_CAP_DATAFORSEO_CENTS", "1");
    await asOwner((c) =>
      c.query("INSERT INTO api_spend_daily (day, provider, micros) VALUES ((now() AT TIME ZONE 'UTC')::date, 'dataforseo', 10000)"),
    );
    const dfs = fakeDataForSeo();
    await expect(assess(answers, "203.0.113.20", { ...deps(), dataforseo: dfs.transport })).rejects.toBeInstanceOf(SpendCapReachedError);
    expect(dfs.calls).toHaveLength(0);
  });

  it("snapshot ids are unguessable and expired ones disappear", async () => {
    const id = await assess(answers, "203.0.113.30", deps());
    expect(await getSnapshot("short")).toBeNull();
    expect(await getSnapshot(id.replace(/.$/, id.endsWith("A") ? "B" : "A"))).toBeNull();
    await asOwner((c) => c.query("UPDATE public_snapshots SET expires_at = now() - interval '1 second'"));
    expect(await getSnapshot(id)).toBeNull();
  });
});
