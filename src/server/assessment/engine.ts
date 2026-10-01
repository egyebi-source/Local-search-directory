import "server-only";
import { aiInsights } from "@/server/ai/insights";
import type { GeminiTransport } from "@/server/ai/gemini";
import type { DataForSeoTransport } from "@/server/dataforseo/client";
import { keywordValues, localSerp, pageTwoKeywords } from "@/server/dataforseo/market";
import { SpendCapReachedError } from "@/server/security/spend";
import type { Answers } from "@/server/onboarding/answers";
import { opportunityScore, primaryKeyword, ruleInsights, type AssessmentResult } from "./result";

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
    // Log the error class only; messages can contain request details.
    console.warn("[assessment] lookup failed:", err instanceof Error ? err.constructor.name : "unknown");
    return { value: fallback, ok: false };
  }
}

export async function runAssessment(answers: Answers, deps: EngineDeps): Promise<AssessmentResult> {
  const keyword = primaryKeyword(answers.category, answers.serviceArea, answers.reach);
  const [serp, ranked, values] = await Promise.all([
    settle(localSerp(deps.dataforseo, keyword, answers.country), { ads: [], organic: [] }),
    settle(pageTwoKeywords(deps.dataforseo, answers.website, answers.country), []),
    settle(keywordValues(deps.dataforseo, keyword, answers.country), []),
  ]);
  if (!serp.ok && !ranked.ok && !values.ok) throw new AssessmentUnavailableError();

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

  const base: Omit<AssessmentResult, "insights" | "insightsSource"> = {
    version: 1,
    domain: own,
    country: answers.country,
    serviceArea: answers.serviceArea,
    reach: answers.reach,
    category: answers.category,
    primaryKeyword: keyword,
    dataSource: deps.dataSource,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
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

  const ai = await aiInsights(
    deps.gemini,
    {
      business: {
        category: answers.category,
        serviceArea: answers.serviceArea,
        goal: answers.primaryGoal,
        adSpend: answers.adSpendRange,
      },
      metrics: base.metrics,
      topKeywords,
      rescueTargets: rescueTargets.map((k) => ({ keyword: k.keyword, position: k.position, monthlySearches: k.monthlySearches, cpcUsd: k.cpcUsd })),
      competitorAdText: competitorAds.slice(0, 5).map((a) => `${a.title} — ${a.description}`),
    },
    competitors.map((c) => c.domain),
  );

  return ai
    ? { ...base, insights: ai, insightsSource: "ai" }
    : { ...base, insights: ruleInsights(base, answers.primaryGoal), insightsSource: "rules" };
}
