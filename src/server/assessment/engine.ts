import "server-only";
import { aiInsights } from "@/server/ai/insights";
import type { GeminiTransport } from "@/server/ai/gemini";
import { DataForSeoError, type DataForSeoTransport } from "@/server/dataforseo/client";
import { z } from "zod";
import { keywordValues, localSerp, pageTwoKeywords } from "@/server/dataforseo/market";
import { SpendCapReachedError } from "@/server/security/spend";
import type { Answers } from "@/server/onboarding/answers";
import type { Country } from "@/server/db/schema";
import { opportunityScore, primaryKeyword, ruleInsights, type AssessmentResult, type Market } from "./result";

export class AssessmentUnavailableError extends Error {}

export type EngineDeps = {
  dataforseo: DataForSeoTransport;
  gemini: GeminiTransport;
  dataSource: "sandbox" | "live";
  now?: () => Date;
};

async function settle<T>(p: Promise<T>, fallback: T): Promise<{ value: T; ok: boolean }> {
  try {
    return { value: await p, ok: true };
  } catch (err) {
    if (err instanceof SpendCapReachedError) throw err;
    // Our DataForSEO errors carry safe, credential-free messages (status
    // codes); anything else is logged by type only.
    const detail =
      err instanceof DataForSeoError
        ? err.message
        : err instanceof z.ZodError
          ? `response format changed at ${err.issues[0]?.path.join(".") || "root"}`
          : err instanceof Error
            ? err.name
            : "unknown";
    console.warn("[assessment] lookup failed:", detail);
    return { value: fallback, ok: false };
  }
}

type MarketData = Omit<Market, "country"> & { country: Country; adText: string[]; ok: boolean };

async function lookupMarket(answers: Answers, country: Country, keyword: string, deps: EngineDeps): Promise<MarketData> {
  const [serp, ranked, values] = await Promise.all([
    settle(localSerp(deps.dataforseo, keyword, country), { ads: [], organic: [] }),
    settle(pageTwoKeywords(deps.dataforseo, answers.website, country), []),
    settle(keywordValues(deps.dataforseo, keyword, country), []),
  ]);

  const own = answers.website;
  const isOwn = (d: string) => d === own || d.endsWith(`.${own}`);
  const competitorAds = serp.value.ads.filter((a) => !isOwn(a.domain));
  const competitors = [...competitorAds.reduce((m, a) => m.set(a.domain, (m.get(a.domain) ?? 0) + 1), new Map<string, number>())]
    .map(([domain, ads]) => ({ domain, ads }))
    .sort((a, b) => b.ads - a.ads);

  const rescueTargets = ranked.value
    .map((k) => ({
      keyword: k.keyword,
      position: k.position,
      monthlySearches: k.searchVolume,
      cpcUsd: k.cpcUsd,
      score: opportunityScore(k.position, k.searchVolume, k.cpcUsd),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const topKeywords = values.value
    .map((v) => ({ keyword: v.keyword, monthlySearches: v.searchVolume, cpcUsd: v.cpcUsd }))
    .slice(0, 10);
  const cpcs = topKeywords.map((k) => k.cpcUsd).filter((c) => c > 0);
  const ownHit = serp.value.organic.find((o) => isOwn(o.domain));

  return {
    country,
    ok: serp.ok || ranked.ok || values.ok,
    adText: competitorAds.slice(0, 5).map((a) => `${a.title} — ${a.description}`),
    metrics: {
      advertisers: competitors.length,
      topCpcUsd: cpcs.length ? Math.max(...cpcs) : null,
      monthlySearches: topKeywords.reduce((s, k) => s + k.monthlySearches, 0),
      yourPosition: ownHit?.position ?? null,
      rescueTargets: rescueTargets.length,
      rescueMonthlySearches: rescueTargets.reduce((s, k) => s + k.monthlySearches, 0),
    },
    rescueTargets,
    topKeywords,
    competitors,
  };
}

export async function runAssessment(answers: Answers, deps: EngineDeps): Promise<AssessmentResult> {
  const keyword = primaryKeyword(answers.category, answers.serviceArea, answers.reach);
  // One set of lookups per country, in parallel; the first country leads.
  const markets = await Promise.all(answers.countries.map((c) => lookupMarket(answers, c, keyword, deps)));
  if (!markets.some((m) => m.ok)) throw new AssessmentUnavailableError();
  const [main, ...others] = markets;
  const strip = (m: MarketData): Market => ({
    country: m.country,
    metrics: m.metrics,
    rescueTargets: m.rescueTargets,
    topKeywords: m.topKeywords,
    competitors: m.competitors,
  });

  const base: Omit<AssessmentResult, "insights" | "insightsSource"> = {
    version: 1,
    domain: answers.website,
    serviceArea: answers.serviceArea,
    reach: answers.reach,
    category: answers.category,
    primaryKeyword: keyword,
    dataSource: deps.dataSource,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    ...strip(main),
    ...(others.length ? { otherMarkets: others.map(strip) } : {}),
  };

  const ai = await aiInsights(
    deps.gemini,
    {
      business: {
        category: answers.category,
        serviceArea: answers.serviceArea,
        goals: answers.goals,
        adSpend: answers.adSpendRange,
        countries: answers.countries,
      },
      metrics: main.metrics,
      otherMarkets: others.map((m) => ({ country: m.country, metrics: m.metrics })),
      topKeywords: main.topKeywords,
      rescueTargets: main.rescueTargets.map((k) => ({
        keyword: k.keyword,
        position: k.position,
        monthlySearches: k.monthlySearches,
        cpcUsd: k.cpcUsd,
      })),
      competitorAdText: markets.flatMap((m) => m.adText).slice(0, 8),
    },
    markets.flatMap((m) => m.competitors.map((c) => c.domain)),
  );

  return ai
    ? { ...base, insights: ai, insightsSource: "ai" }
    : { ...base, insights: ruleInsights(base, answers.goals), insightsSource: "rules" };
}
