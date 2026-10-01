import type { Insight } from "@/server/ai/insights";
import type { Country } from "@/server/db/schema";

// Shape of a stored assessment, and the reduced "teaser" shown before
// sign-up. Pure functions only (unit-tested without a database).

export type AssessmentResult = {
  version: 1;
  domain: string;
  country: Country;
  serviceArea: string;
  category: string;
  primaryKeyword: string;
  dataSource: "sandbox" | "live";
  generatedAt: string;
  metrics: {
    advertisers: number;
    topCpcUsd: number | null;
    monthlySearches: number;
    yourPosition: number | null;
    rescueTargets: number;
    rescueMonthlySearches: number;
  };
  insights: Insight[];
  insightsSource: "ai" | "rules";
  rescueTargets: { keyword: string; position: number; monthlySearches: number; cpcUsd: number; score: number }[];
  topKeywords: { keyword: string; monthlySearches: number; cpcUsd: number }[];
  competitors: { domain: string; ads: number }[];
};

export const FREE_INSIGHTS = 2;

export type Teaser = {
  domain: string;
  serviceArea: string;
  category: string;
  primaryKeyword: string;
  dataSource: AssessmentResult["dataSource"];
  metrics: AssessmentResult["metrics"];
  insights: Insight[];
  lockedInsights: number;
  lockedRescueTargets: number;
  lockedCompetitors: number;
};

/**
 * Everything a visitor may see before creating an account. Built by
 * copying allowed fields — never by deleting from the full result — so a
 * new field added to AssessmentResult stays private by default.
 */
export function toTeaser(r: AssessmentResult): Teaser {
  return {
    domain: r.domain,
    serviceArea: r.serviceArea,
    category: r.category,
    primaryKeyword: r.primaryKeyword,
    dataSource: r.dataSource,
    metrics: { ...r.metrics },
    insights: r.insights.slice(0, FREE_INSIGHTS).map((i) => ({ title: i.title, detail: i.detail })),
    lockedInsights: Math.max(0, r.insights.length - FREE_INSIGHTS),
    lockedRescueTargets: r.rescueTargets.length,
    lockedCompetitors: r.competitors.length,
  };
}

/** "Ottawa, ON" -> "ottawa"; used to build the local search phrase. */
export function cityFrom(serviceArea: string): string {
  return serviceArea.split(/[,(\n]/)[0].trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
}

export function primaryKeyword(category: string, serviceArea: string): string {
  return `${category.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60)} ${cityFrom(serviceArea)}`.trim();
}

/** Page 11 is far closer to page 1 than page 30: weight 1.0 at #11 down to 0.05 at #30. */
export function opportunityScore(position: number, monthlySearches: number, cpcUsd: number): number {
  const closeness = Math.max(0.05, (31 - position) / 20);
  return Math.round(monthlySearches * cpcUsd * closeness * 100) / 100;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Deterministic findings used when the AI is unavailable or misbehaves. */
export function ruleInsights(r: Omit<AssessmentResult, "insights" | "insightsSource">, goal: string): Insight[] {
  const m = r.metrics;
  const top = r.rescueTargets[0];
  const goalLine: Record<string, string> = {
    calls: "Put your phone number at the top of every page and in your Google Business Profile so searchers can call in one tap.",
    form_leads: "Add a short quote-request form near the top of your service pages; fewer fields means more requests.",
    walk_ins: "Keep your Google Business Profile hours, address and photos current; it drives map views and visits.",
    lower_ad_spend: "Searches you can win in regular results are clicks you don't have to pay for. Start with your rescue targets.",
  };
  return [
    {
      title: m.advertisers > 0 ? `${m.advertisers} businesses are paying for ads on your top search` : "No one is advertising on your top search yet",
      detail:
        m.advertisers > 0
          ? `People searching "${r.primaryKeyword}" see paid ads first. Estimated cost per click: ${m.topCpcUsd !== null ? usd(m.topCpcUsd) : "not available"}.`
          : `Searches for "${r.primaryKeyword}" show no paid ads right now, so ranking well in regular results gets you seen first.`,
    },
    {
      title:
        m.yourPosition !== null ? `You rank #${m.yourPosition} for "${r.primaryKeyword}"` : `You're not in the top 20 for "${r.primaryKeyword}"`,
      detail:
        m.yourPosition !== null && m.yourPosition <= 3
          ? "You're near the top. Protect it with fresh reviews and an up-to-date service page."
          : "A dedicated page for this service and city, plus steady Google reviews, is the most reliable way to move up.",
    },
    {
      title: `${m.rescueTargets} searches where you're on page 2 or 3`,
      detail: top
        ? `Your best opportunity: "${top.keyword}" (position ${top.position}, about ${top.monthlySearches.toLocaleString("en-US")} searches a month). Moving to page 1 is usually faster than starting from scratch.`
        : "We didn't find searches where you're close to page 1 yet. Building service pages for each job type you offer is the first step.",
    },
    {
      title: `About ${m.monthlySearches.toLocaleString("en-US")} local searches a month for what you do`,
      detail: "That's the demand in your area for your main services. Each search you show up for is a chance at a call or quote.",
    },
    { title: "Your quickest next step", detail: goalLine[goal] ?? goalLine.calls },
  ];
}
