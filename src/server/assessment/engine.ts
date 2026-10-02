import "server-only";
import { aiInsights } from "@/server/ai/insights";
import type { GeminiTransport } from "@/server/ai/gemini";
import { DataForSeoError, type DataForSeoTransport } from "@/server/dataforseo/client";
import { z } from "zod";
import { keywordValues, localSerp, mapsRanking, pageTwoKeywords, phraseVolumes } from "@/server/dataforseo/market";
import { SpendCapReachedError } from "@/server/security/spend";
import type { Answers } from "@/server/onboarding/answers";
import type { Country } from "@/server/db/schema";
import {
  keywordCandidates,
  localVisibility,
  mapInsights,
  opportunityScore,
  pickKeyword,
  primaryKeyword,
  ruleInsights,
  toLocalSummary,
  type AssessmentResult,
  type Market,
} from "./result";

/** `details` are our own credential-free failure reasons (see `settle`). */
export class AssessmentUnavailableError extends Error {
  constructor(public readonly details: string[] = []) {
    super("All assessment lookups failed");
  }
}

export type EngineDeps = {
  dataforseo: DataForSeoTransport;
  gemini: GeminiTransport;
  dataSource: "sandbox" | "live";
  now?: () => Date;
};

async function settle<T>(p: Promise<T>, fallback: T): Promise<{ value: T; ok: boolean; detail?: string }> {
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
            ? `${err.name}${err.cause instanceof Error ? ` (${err.cause.name})` : ""}`
            : "unknown";
    console.warn("[assessment] lookup failed:", detail);
    return { value: fallback, ok: false, detail };
  }
}

type MarketData = Omit<Market, "country"> & { country: Country; adText: string[]; ok: boolean; failures: string[] };

async function lookupMarket(answers: Answers, country: Country, keyword: string, deps: EngineDeps): Promise<MarketData> {
  // Google Maps only matters for businesses serving a local area.
  const local = answers.reach !== "national";
  const [serp, ranked, values, maps] = await Promise.all([
    settle(localSerp(deps.dataforseo, keyword, country), { ads: [], organic: [], aiOverview: { shown: false, citedDomains: [] } }),
    settle(pageTwoKeywords(deps.dataforseo, answers.website, country), []),
    settle(keywordValues(deps.dataforseo, keyword, country), []),
    local ? settle(mapsRanking(deps.dataforseo, keyword, country), []) : Promise.resolve({ value: [], ok: false, detail: undefined }),
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
    ok: serp.ok || ranked.ok || values.ok || maps.ok,
    failures: [serp.detail, ranked.detail, values.detail, maps.detail].filter((d): d is string => !!d),
    adText: competitorAds.slice(0, 5).map((a) => `${a.title} — ${a.description}`),
    metrics: {
      advertisers: competitors.length,
      topCpcUsd: cpcs.length ? Math.max(...cpcs) : null,
      monthlySearches: topKeywords.reduce((s, k) => s + k.monthlySearches, 0),
      yourPosition: ownHit?.position ?? null,
      rescueTargets: rescueTargets.length,
      rescueMonthlySearches: rescueTargets.reduce((s, k) => s + k.monthlySearches, 0),
      googleChecked: serp.ok,
    },
    rescueTargets,
    topKeywords,
    competitors,
    ...(maps.ok ? { local: localVisibility(keyword, maps.value, serp.value.organic, own) } : {}),
  };
}

/** The AI sees the numbers only (the googleChecked flag decides whether it runs at all). */
function numbersOnly(m: AssessmentResult["metrics"]): Omit<AssessmentResult["metrics"], "googleChecked"> {
  const rest = { ...m };
  delete rest.googleChecked;
  return rest;
}

/**
 * People rarely search the exact business description typed in the form
 * ("collision repair buying group for independent shops"). Check how often
 * shorter versions are searched (one call) and use the most specific one
 * people actually type, saying so on the report.
 */
async function chooseKeyword(answers: Answers, deps: EngineDeps): Promise<{ keyword: string; keywordNote?: string }> {
  const typed = primaryKeyword(answers.category, answers.serviceArea, answers.reach);
  const candidates = keywordCandidates(answers.category, answers.serviceArea, answers.reach);
  if (candidates.length < 2) return { keyword: typed };
  const volumes = await settle(phraseVolumes(deps.dataforseo, candidates, answers.countries[0]), new Map<string, number>());
  const picked = pickKeyword(candidates, volumes.value);
  if (picked.keyword === candidates[0]) return { keyword: picked.keyword };
  const typedSearches = volumes.value.get(candidates[0]) ?? 0;
  return {
    keyword: picked.keyword,
    keywordNote: `Few people search "${candidates[0]}" (${typedSearches ? `about ${typedSearches} a month` : "too few to measure"}), so we used "${picked.keyword}"${picked.searches ? `, searched about ${picked.searches.toLocaleString("en-US")} times a month` : ""}.`,
  };
}

export async function runAssessment(answers: Answers, deps: EngineDeps): Promise<AssessmentResult> {
  const { keyword, keywordNote } = await chooseKeyword(answers, deps);
  // One set of lookups per country, in parallel; the first country leads.
  const markets = await Promise.all(answers.countries.map((c) => lookupMarket(answers, c, keyword, deps)));
  if (!markets.some((m) => m.ok)) throw new AssessmentUnavailableError([...new Set(markets.flatMap((m) => m.failures))]);
  const [main, ...others] = markets;
  const strip = (m: MarketData): Market => ({
    country: m.country,
    metrics: m.metrics,
    rescueTargets: m.rescueTargets,
    topKeywords: m.topKeywords,
    competitors: m.competitors,
    ...(m.local ? { local: m.local } : {}),
  });

  const base: Omit<AssessmentResult, "insights" | "insightsSource"> = {
    version: 1,
    domain: answers.website,
    serviceArea: answers.serviceArea,
    reach: answers.reach,
    category: answers.category,
    primaryKeyword: keyword,
    ...(keywordNote ? { keywordNote } : {}),
    dataSource: deps.dataSource,
    generatedAt: (deps.now?.() ?? new Date()).toISOString(),
    ...strip(main),
    ...(others.length ? { otherMarkets: others.map(strip) } : {}),
  };

  // If Google's results are missing, the AI would read "0 advertisers" as a
  // fact; the rule-based findings say plainly that it wasn't checked.
  const ai = main.metrics.googleChecked === false ? null : await aiInsights(
    deps.gemini,
    {
      business: {
        category: answers.category,
        serviceArea: answers.serviceArea,
        goals: answers.goals,
        adSpend: answers.adSpendRange,
        countries: answers.countries,
      },
      metrics: numbersOnly(main.metrics),
      otherMarkets: others.map((m) => ({ country: m.country, metrics: numbersOnly(m.metrics) })),
      topKeywords: main.topKeywords,
      rescueTargets: main.rescueTargets.map((k) => ({
        keyword: k.keyword,
        position: k.position,
        monthlySearches: k.monthlySearches,
        cpcUsd: k.cpcUsd,
      })),
      ...(main.local ? { local: toLocalSummary(main.local) } : {}),
      competitorAdText: markets.flatMap((m) => m.adText).slice(0, 8),
    },
    [
      ...markets.flatMap((m) => m.competitors.map((c) => c.domain)),
      ...markets.flatMap((m) => m.local?.leaders.flatMap((l) => [l.name, ...(l.domain ? [l.domain] : [])]) ?? []),
    ],
  );

  // Map position and reviews are facts we state ourselves, always first;
  // the AI adds the rest.
  const lead = main.local ? mapInsights(main.local, answers.category) : [];
  return ai
    ? { ...base, insights: [...lead, ...ai].slice(0, 5), insightsSource: "ai" }
    : { ...base, insights: ruleInsights(base, answers.goals), insightsSource: "rules" };
}
