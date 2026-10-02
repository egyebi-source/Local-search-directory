import type { Insight } from "@/server/ai/insights";
import type { Country } from "@/server/db/schema";
import type { MapListing } from "@/server/dataforseo/market";

// Shape of a stored assessment, and the reduced "teaser" shown before
// sign-up. Pure functions only (unit-tested without a database).

export type AssessmentResult = {
  version: 1;
  domain: string;
  country: Country;
  serviceArea: string;
  reach?: "local" | "national";
  category: string;
  primaryKeyword: string;
  /** Set when we searched a shorter phrase than the one typed, because few people search the typed one. */
  keywordNote?: string;
  dataSource: "sandbox" | "live";
  generatedAt: string;
  metrics: {
    advertisers: number;
    topCpcUsd: number | null;
    monthlySearches: number;
    yourPosition: number | null;
    rescueTargets: number;
    rescueMonthlySearches: number;
    /** False when Google's results couldn't be fetched: ads and position are unknown, not zero. Absent on older results (= checked). */
    googleChecked?: boolean;
  };
  insights: Insight[];
  insightsSource: "ai" | "rules";
  rescueTargets: { keyword: string; position: number; monthlySearches: number; cpcUsd: number; score: number }[];
  topKeywords: { keyword: string; monthlySearches: number; cpcUsd: number }[];
  competitors: { domain: string; ads: number }[];
  /** Google Maps visibility (local businesses only; absent on older assessments). */
  local?: LocalVisibility;
  /** Extra countries for nationwide businesses (the fields above are the first country). */
  otherMarkets?: Market[];
};

export type Market = Pick<AssessmentResult, "country" | "metrics" | "rescueTargets" | "topKeywords" | "competitors" | "local">;

export type LocalVisibility = {
  keyword: string;
  /** Position in Google Maps results (top 20 checked), or null if not found. */
  yourRank: number | null;
  you: { name: string; rating: number | null; reviews: number | null } | null;
  /** The top 3 map listings other than the business itself. */
  leaders: MapListing[];
  leaderAvgRating: number | null;
  leaderAvgReviews: number | null;
  /** Directory sites (Yelp, Reddit…) in the top 10 regular results. */
  directoriesInTop10: number;
};

/** Numbers only: safe to show before sign-up (no competitor names). */
export type LocalSummary = Pick<LocalVisibility, "yourRank" | "you" | "leaderAvgRating" | "leaderAvgReviews" | "directoriesInTop10">;

const DIRECTORIES = [
  "yelp.", "reddit.com", "autobody.ca", "n49.com", "yellowpages.", "homestars.com", "bbb.org", "facebook.com",
  "houzz.", "angi.com", "thumbtack.com", "tripadvisor.", "yell.com", "nextdoor.com", "instagram.com", "kijiji.ca",
];
export const isDirectory = (domain: string) => DIRECTORIES.some((d) => domain.includes(d));

const host = (d: string) => d.toLowerCase().replace(/^www\./, "");
/** True when `domain` is the business's own site (or a subdomain of it). */
export function isOwnDomain(domain: string | null, own: string): boolean {
  if (!domain) return false;
  const d = host(domain);
  const o = host(own);
  return d === o || d.endsWith(`.${o}`);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function localVisibility(
  keyword: string,
  listings: MapListing[],
  organic: { domain: string; position: number }[],
  ownDomain: string,
): LocalVisibility {
  const self = listings.find((l) => isOwnDomain(l.domain, ownDomain)) ?? null;
  const leaders = listings.filter((l) => l !== self).slice(0, 3);
  const rating = avg(leaders.flatMap((l) => (l.rating === null ? [] : [l.rating])));
  const reviews = avg(leaders.flatMap((l) => (l.reviews === null ? [] : [l.reviews])));
  return {
    keyword,
    yourRank: self?.rank ?? null,
    you: self ? { name: self.name, rating: self.rating, reviews: self.reviews } : null,
    leaders,
    leaderAvgRating: rating === null ? null : Math.round(rating * 10) / 10,
    leaderAvgReviews: reviews === null ? null : Math.round(reviews),
    directoriesInTop10: organic.filter((o) => o.position <= 10 && isDirectory(o.domain)).length,
  };
}

export function toLocalSummary(l: LocalVisibility): LocalSummary {
  return {
    yourRank: l.yourRank,
    you: l.you ? { name: l.you.name, rating: l.you.rating, reviews: l.you.reviews } : null,
    leaderAvgRating: l.leaderAvgRating,
    leaderAvgReviews: l.leaderAvgReviews,
    directoriesInTop10: l.directoriesInTop10,
  };
}

/**
 * How many new reviews a week would reach the leaders' average in about
 * six months (26 weeks). At least 1 when there is any gap.
 */
export function reviewsPerWeekToCatchUp(yours: number, leaders: number): number {
  const gap = leaders - yours;
  return gap <= 0 ? 0 : Math.max(1, Math.ceil(gap / 26));
}

export const FREE_INSIGHTS = 2;

export type Teaser = {
  domain: string;
  serviceArea: string;
  category: string;
  primaryKeyword: string;
  keywordNote: string | null;
  dataSource: AssessmentResult["dataSource"];
  metrics: AssessmentResult["metrics"];
  insights: Insight[];
  lockedInsights: number;
  lockedRescueTargets: number;
  lockedCompetitors: number;
  /** Names of map leaders stay locked; only numbers are shown. */
  local: LocalSummary | null;
  lockedLeaders: number;
  otherCountries: Country[];
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
    keywordNote: r.keywordNote ?? null,
    dataSource: r.dataSource,
    metrics: { ...r.metrics },
    insights: r.insights.slice(0, FREE_INSIGHTS).map((i) => ({ title: i.title, detail: i.detail })),
    lockedInsights: Math.max(0, r.insights.length - FREE_INSIGHTS),
    lockedRescueTargets: r.rescueTargets.length,
    lockedCompetitors: r.competitors.length,
    local: r.local ? toLocalSummary(r.local) : null,
    lockedLeaders: r.local?.leaders.length ?? 0,
    otherCountries: (r.otherMarkets ?? []).map((m) => m.country),
  };
}

/** "Ottawa, ON" -> "ottawa"; used to build the local search phrase. */
export function cityFrom(serviceArea: string): string {
  return serviceArea.split(/[,(\n]/)[0].trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
}

/** "collision repair ottawa" for a local business; just "collision repair" nationwide. */
export function primaryKeyword(category: string, serviceArea: string, reach: "local" | "national" = "local"): string {
  const service = category.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60);
  return reach === "national" ? service : `${service} ${cityFrom(serviceArea)}`.trim();
}

const TRAILING = new Set(["for", "in", "of", "and", "the", "to", "with", "near", "at", "on", "a"]);

/**
 * Ways people might search for this business, most specific first: the
 * phrase as typed, then shorter versions ("collision repair buying group",
 * "collision repair"), each with the city for a local business.
 */
export function keywordCandidates(category: string, serviceArea: string, reach: "local" | "national" = "local"): string[] {
  const words = category.trim().toLowerCase().replace(/[^\p{L}\p{N}&' -]/gu, " ").split(/\s+/).filter(Boolean).slice(0, 10);
  const city = reach === "national" ? "" : cityFrom(serviceArea);
  const out: string[] = [];
  for (let n = words.length; n >= 1; n--) {
    const head = words.slice(0, n);
    if (TRAILING.has(head[n - 1])) continue;
    if (n === 1 && words.length > 1) continue; // a single generic word is too broad
    const phrase = head.join(" ");
    out.push(city ? `${phrase} ${city}` : phrase);
  }
  return [...new Set(out)].slice(0, 8);
}

/** Enough searches to say anything useful about ads and rankings. */
export const MIN_MONTHLY_SEARCHES = 30;

/** The most specific phrase people actually search; the typed phrase if none have data. */
export function pickKeyword(candidates: string[], volumes: Map<string, number>): { keyword: string; searches: number | null } {
  const specific = candidates.find((c) => (volumes.get(c) ?? 0) >= MIN_MONTHLY_SEARCHES);
  if (specific) return { keyword: specific, searches: volumes.get(specific)! };
  const best = [...candidates].sort((a, b) => (volumes.get(b) ?? 0) - (volumes.get(a) ?? 0))[0];
  return best && (volumes.get(best) ?? 0) > 0 ? { keyword: best, searches: volumes.get(best)! } : { keyword: candidates[0], searches: null };
}

/** Page 11 is far closer to page 1 than page 30: weight 1.0 at #11 down to 0.05 at #30. */
export function opportunityScore(position: number, monthlySearches: number, cpcUsd: number): number {
  const closeness = Math.max(0.05, (31 - position) / 20);
  return Math.round(monthlySearches * cpcUsd * closeness * 100) / 100;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Deterministic findings used when the AI is unavailable or misbehaves. */
export function ruleInsights(r: Omit<AssessmentResult, "insights" | "insightsSource">, goals: string[]): Insight[] {
  const goal = goals[0] ?? "calls";
  const m = r.metrics;
  const top = r.rescueTargets[0];
  const goalLine: Record<string, string> = {
    calls: "Put your phone number at the top of every page and in your Google Business Profile so searchers can call in one tap.",
    form_leads: "Add a short quote-request form near the top of your service pages; fewer fields means more requests.",
    walk_ins: "Keep your Google Business Profile hours, address and photos current; it drives map views and visits.",
    lower_ad_spend: "Searches you can win in regular results are clicks you don't have to pay for. Start with your rescue targets.",
  };
  const ads = {
      title: m.advertisers > 0 ? `${m.advertisers} businesses are paying for ads on your top search` : "No one is advertising on your top search yet",
      detail:
        m.advertisers > 0
          ? `People searching "${r.primaryKeyword}" see paid ads first. Estimated cost per click: ${m.topCpcUsd !== null ? usd(m.topCpcUsd) : "not available"}.`
          : `Searches for "${r.primaryKeyword}" show no paid ads right now, so ranking well in regular results gets you seen first.`,
  };
  const organic = {
      title:
        m.yourPosition !== null ? `You rank #${m.yourPosition} for "${r.primaryKeyword}"` : `You're not in the top 20 for "${r.primaryKeyword}"`,
      detail:
        m.yourPosition !== null && m.yourPosition <= 3
          ? "You're near the top. Protect it with fresh reviews and an up-to-date service page."
          : "A dedicated page for this service and city, plus steady Google reviews, is the most reliable way to move up.",
  };
  const rescue = {
      title: `${m.rescueTargets} searches where you're on page 2 or 3`,
      detail: top
        ? `Your best opportunity: "${top.keyword}" (position ${top.position}, about ${top.monthlySearches.toLocaleString("en-US")} searches a month). Moving to page 1 is usually faster than starting from scratch.`
        : "We didn't find searches where you're close to page 1 yet. Building service pages for each job type you offer is the first step.",
  };
  const demand = {
      title:
        r.reach === "national"
          ? `About ${m.monthlySearches.toLocaleString("en-US")} searches a month across the country for what you do`
          : `About ${m.monthlySearches.toLocaleString("en-US")} local searches a month for what you do`,
      detail:
        r.reach === "national"
          ? "That's national demand for your main services. Each search you show up for is a chance at a lead."
          : "That's the demand in your area for your main services. Each search you show up for is a chance at a call or quote.",
  };
  const next = { title: "Your quickest next step", detail: goalLine[goal] ?? goalLine.calls };
  if (m.googleChecked === false) {
    // Never present missing data as a finding.
    const unchecked = {
      title: "We couldn't check Google's results this time",
      detail: "Google returned a temporary error, so who's advertising and where you rank are unknown for now. Your dashboard checks again automatically.",
    };
    if (!r.local) return [unchecked, rescue, demand, next];
    return [...mapInsights(r.local, r.category), unchecked, rescue, next];
  }
  if (!r.local) return [ads, organic, rescue, demand, next];
  return [...mapInsights(r.local, r.category), organic, rescue, next];
}

const stars = (n: number | null) => (n === null ? "no rating" : `${n.toFixed(1)}★`);
const count = (n: number | null) => (n === null ? "no" : n.toLocaleString("en-US"));

/** The two findings that matter most for a local business: map position and reviews. */
export function mapInsights(l: LocalVisibility, category: string): Insight[] {
  const rank: Insight =
    l.yourRank === null
      ? {
          title: `You don't show up in Google Maps for "${l.keyword}"`,
          detail: `Most calls for local services come from the top 3 map listings. Check that your Google Business Profile is verified, lists "${category}" as its main category, and links to your website.`,
        }
      : l.yourRank <= 3
        ? {
            title: `You're #${l.yourRank} in Google Maps for "${l.keyword}"`,
            detail: "You're in the top 3, where most calls happen. Keep it with a steady flow of new reviews and replies to every review.",
          }
        : {
            title: `You're #${l.yourRank} in Google Maps for "${l.keyword}"`,
            detail: "The top 3 map listings get most of the calls. Reviews, a complete Business Profile and a page on your site for this service and city are what move you up.",
          };
  const lead = `The top 3 map listings average ${stars(l.leaderAvgRating)} from ${count(l.leaderAvgReviews)} reviews`;
  const yours = l.you?.reviews ?? 0;
  const perWeek = l.leaderAvgReviews === null ? 0 : reviewsPerWeekToCatchUp(yours, l.leaderAvgReviews);
  const reviews: Insight = {
    title: l.you ? `You have ${count(l.you.reviews)} reviews; the leaders average ${count(l.leaderAvgReviews)}` : lead,
    detail: l.you
      ? `${lead}; you have ${stars(l.you.rating)} from ${count(l.you.reviews)}. ${
          perWeek > 0
            ? `Asking for about ${perWeek} new review${perWeek === 1 ? "" : "s"} a week would close the gap in roughly 6 months.`
            : "You're ahead on reviews. Keep replying to each one."
        }`
      : `${lead}. Reviews are one of the biggest factors in who Google shows first for local searches.`,
  };
  return [rank, reviews];
}
