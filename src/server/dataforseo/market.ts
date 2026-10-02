import "server-only";
import { z } from "zod";
import type { Country } from "@/server/db/schema";
import { liveTask, type DataForSeoTransport } from "./client";

// The three lookups behind the assessment (see chat/PRD §5 Module 1):
//  1. SERP API, Google organic live/advanced -> paid ads for "service + city"
//  2. Labs ranked_keywords                    -> where the site ranks (pages 2-3)
//  3. Labs keyword_suggestions                -> volume + CPC for local searches

export const LOCATION_CODE: Record<Country, number> = { CA: 2124, US: 2840 };

const num = z.number().nullable().optional();
const str = z.string().nullable().optional();

const itemsOf = z.object({ items: z.array(z.unknown()).nullable().optional() }).nullable();

/** Parse each item on its own: an odd entry is skipped instead of failing the lookup. */
function parseItems<T extends z.ZodType>(raw: unknown, item: T): z.infer<T>[] {
  const items = itemsOf.parse(raw)?.items ?? [];
  return items.flatMap((i) => {
    const r = item.safeParse(i);
    return r.success ? [r.data] : [];
  });
}

export type PaidAd = { domain: string; title: string; description: string };
export type OrganicHit = { domain: string; position: number };
export type RankedKeyword = { keyword: string; position: number; searchVolume: number; cpcUsd: number };
export type KeywordValue = { keyword: string; searchVolume: number; cpcUsd: number };

const serpItem = z.object({
  type: z.string(),
  domain: str,
  title: str,
  description: str,
  rank_group: num,
  // Google's AI answer ("AI Overview") lists the sites it draws from.
  references: z.array(z.object({ domain: str }).passthrough()).nullable().optional(),
});

export async function localSerp(
  t: DataForSeoTransport,
  keyword: string,
  country: Country,
): Promise<{ ads: PaidAd[]; organic: OrganicHit[]; aiOverview: { shown: boolean; citedDomains: string[] } }> {
  const raw = await liveTask(t, "serp/google/organic/live/advanced", {
    keyword,
    location_code: LOCATION_CODE[country],
    language_code: "en",
    device: "mobile",
    depth: 20,
  });
  const items = parseItems(raw, serpItem);
  const ads = items
    .filter((i) => i.type === "paid" && i.domain)
    .map((i) => ({ domain: i.domain!.toLowerCase(), title: i.title ?? "", description: i.description ?? "" }));
  const organic = items
    .filter((i) => i.type === "organic" && i.domain && i.rank_group)
    .map((i) => ({ domain: i.domain!.toLowerCase(), position: i.rank_group! }));
  const ai = items.filter((i) => i.type === "ai_overview");
  const citedDomains = ai.flatMap((i) => (i.references ?? []).flatMap((r) => (r.domain ? [r.domain.toLowerCase()] : [])));
  return { ads, organic, aiOverview: { shown: ai.length > 0, citedDomains } };
}

const rankedItem = z.object({
  keyword_data: z.object({
    keyword: z.string(),
    keyword_info: z.object({ search_volume: num, cpc: num }).nullable().optional(),
  }),
  ranked_serp_element: z.object({
    serp_item: z.object({ rank_group: num }).nullable().optional(),
  }),
});

/** Keywords where `domain` ranks 11-30 (pages 2-3), most searched first. */
export async function pageTwoKeywords(t: DataForSeoTransport, domain: string, country: Country): Promise<RankedKeyword[]> {
  const raw = await liveTask(t, "dataforseo_labs/google/ranked_keywords/live", {
    target: domain,
    location_code: LOCATION_CODE[country],
    language_code: "en",
    item_types: ["organic"],
    limit: 100,
    filters: [
      ["ranked_serp_element.serp_item.rank_group", ">=", 11],
      "and",
      ["ranked_serp_element.serp_item.rank_group", "<=", 30],
    ],
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  });
  return parseItems(raw, rankedItem)
    .map((i) => ({
      keyword: i.keyword_data.keyword,
      position: i.ranked_serp_element.serp_item?.rank_group ?? 0,
      searchVolume: i.keyword_data.keyword_info?.search_volume ?? 0,
      cpcUsd: i.keyword_data.keyword_info?.cpc ?? 0,
    }))
    .filter((k) => k.position >= 11 && k.position <= 30);
}

const suggestionItem = z.object({
  keyword: z.string(),
  keyword_info: z.object({ search_volume: num, cpc: num }).nullable().optional(),
});

/** Search volume and cost-per-click for searches containing the seed phrase. */
export async function keywordValues(t: DataForSeoTransport, seed: string, country: Country): Promise<KeywordValue[]> {
  const raw = await liveTask(t, "dataforseo_labs/google/keyword_suggestions/live", {
    keyword: seed,
    location_code: LOCATION_CODE[country],
    language_code: "en",
    include_seed_keyword: true,
    limit: 30,
    order_by: ["keyword_info.search_volume,desc"],
  });
  return parseItems(raw, suggestionItem).map((i) => ({
    keyword: i.keyword,
    searchVolume: i.keyword_info?.search_volume ?? 0,
    cpcUsd: i.keyword_info?.cpc ?? 0,
  }));
}

export type MapListing = {
  rank: number;
  name: string;
  domain: string | null;
  rating: number | null;
  reviews: number | null;
  category: string | null;
};

const mapsItem = z.object({
  type: z.string(),
  rank_group: z.number(),
  title: z.string(),
  domain: str,
  category: str,
  rating: z.object({ value: num, votes_count: num }).nullable().optional(),
});

/** Google Maps results for a local search: who gets the calls, with ratings and review counts. */
export async function mapsRanking(t: DataForSeoTransport, keyword: string, country: Country): Promise<MapListing[]> {
  const raw = await liveTask(t, "serp/google/maps/live/advanced", {
    keyword,
    location_code: LOCATION_CODE[country],
    language_code: "en",
    depth: 20,
  });
  return parseItems(raw, mapsItem)
    .filter((i) => i.type === "maps_search")
    .map((i) => ({
      rank: i.rank_group,
      name: i.title.slice(0, 120),
      domain: i.domain ? i.domain.toLowerCase() : null,
      rating: i.rating?.value ?? null,
      reviews: i.rating?.votes_count ?? null,
      category: i.category ? i.category.slice(0, 80) : null,
    }))
    .sort((a, b) => a.rank - b.rank);
}

export type BusinessListing = {
  name: string;
  address: string | null;
  domain: string | null;
  category: string | null;
  rating: number | null;
  reviews: number | null;
};

const listingItem = mapsItem.extend({ address: str });

/** Look a business up on Google Maps by name and city, so its owner can confirm it's the right one. */
export async function findBusiness(t: DataForSeoTransport, name: string, city: string, country: Country): Promise<BusinessListing[]> {
  const raw = await liveTask(t, "serp/google/maps/live/advanced", {
    keyword: `${name} ${city}`.slice(0, 200),
    location_code: LOCATION_CODE[country],
    language_code: "en",
    depth: 10,
  });
  return parseItems(raw, listingItem)
    .filter((i) => i.type === "maps_search")
    .sort((a, b) => a.rank_group - b.rank_group)
    .slice(0, 5)
    .map((i) => ({
      name: i.title.slice(0, 120),
      address: i.address ? i.address.slice(0, 200) : null,
      domain: i.domain ? i.domain.toLowerCase().replace(/^www\./, "") : null,
      category: i.category ? i.category.slice(0, 80) : null,
      rating: i.rating?.value ?? null,
      reviews: i.rating?.votes_count ?? null,
    }));
}

// --- Whole-site numbers for the SEO dashboard (weekly) ---------------------------

export type DomainOverview = {
  trafficEst: number;
  keywords: number;
  trafficValueUsd: number;
  paidKeywords: number;
  buckets: { top3: number; top10: number; top20: number; top100: number };
};

const posCounts = z
  .object({
    pos_1: num, pos_2_3: num, pos_4_10: num, pos_11_20: num, pos_21_30: num, pos_31_40: num, pos_41_50: num,
    pos_51_60: num, pos_61_70: num, pos_71_80: num, pos_81_90: num, pos_91_100: num,
    etv: num, count: num, estimated_paid_traffic_cost: num,
  })
  .nullable()
  .optional();
const overviewItem = z.object({ metrics: z.object({ organic: posCounts, paid: z.object({ count: num }).nullable().optional() }) });

/** Estimated Google traffic and how many searches the site ranks for, by position band. */
export async function domainOverview(t: DataForSeoTransport, domain: string, country: Country): Promise<DomainOverview | null> {
  const raw = await liveTask(t, "dataforseo_labs/google/domain_rank_overview/live", {
    target: domain,
    location_code: LOCATION_CODE[country],
    language_code: "en",
  });
  const [item] = parseItems(raw, overviewItem);
  const o = item?.metrics.organic;
  if (!o) return null;
  const n = (v: number | null | undefined) => v ?? 0;
  const top3 = n(o.pos_1) + n(o.pos_2_3);
  const top10 = top3 + n(o.pos_4_10);
  const top20 = top10 + n(o.pos_11_20);
  const top100 = top20 + n(o.pos_21_30) + n(o.pos_31_40) + n(o.pos_41_50) + n(o.pos_51_60) + n(o.pos_61_70) + n(o.pos_71_80) + n(o.pos_81_90) + n(o.pos_91_100);
  return {
    trafficEst: Math.round(n(o.etv)),
    keywords: n(o.count),
    trafficValueUsd: Math.round(n(o.estimated_paid_traffic_cost)),
    paidKeywords: n(item.metrics.paid?.count),
    buckets: { top3, top10, top20, top100 },
  };
}

export type SiteKeyword = { keyword: string; position: number; searches: number; cpcUsd: number; url: string | null; trafficEst: number };

const siteKeywordItem = z.object({
  keyword_data: z.object({ keyword: z.string(), keyword_info: z.object({ search_volume: num, cpc: num }).nullable().optional() }),
  ranked_serp_element: z.object({ serp_item: z.object({ rank_group: num, url: str, etv: num }).nullable().optional() }),
});

/** The searches a site ranks for (top 100), most traffic first. */
export async function siteKeywords(t: DataForSeoTransport, domain: string, country: Country, limit = 200): Promise<SiteKeyword[]> {
  const raw = await liveTask(t, "dataforseo_labs/google/ranked_keywords/live", {
    target: domain,
    location_code: LOCATION_CODE[country],
    language_code: "en",
    item_types: ["organic"],
    limit,
    order_by: ["ranked_serp_element.serp_item.etv,desc"],
  });
  return parseItems(raw, siteKeywordItem).flatMap((i) => {
    const pos = i.ranked_serp_element.serp_item?.rank_group;
    if (!pos || pos > 100) return [];
    return [
      {
        keyword: i.keyword_data.keyword.slice(0, 120),
        position: pos,
        searches: i.keyword_data.keyword_info?.search_volume ?? 0,
        cpcUsd: i.keyword_data.keyword_info?.cpc ?? 0,
        url: i.ranked_serp_element.serp_item?.url ?? null,
        trafficEst: Math.round((i.ranked_serp_element.serp_item?.etv ?? 0) * 10) / 10,
      },
    ];
  });
}

export type PageAudit = { url: string; score: number | null; failed: string[]; title: string | null; h1: string | null; status: number | null };

const pageItem = z.object({
  url: str,
  status_code: num,
  onpage_score: num,
  checks: z.record(z.string(), z.boolean().nullable()).nullable().optional(),
  meta: z
    .object({
      title: str,
      htags: z.object({ h1: z.array(z.string()).nullable().optional() }).passthrough().nullable().optional(),
    })
    .passthrough()
    .nullable()
    .optional(),
});

/** Checks that are problems when true (DataForSEO on-page "checks"). */
export const BAD_CHECKS = [
  "no_title", "title_too_long", "title_too_short", "no_description", "no_h1_tag", "duplicate_title_tag",
  "low_content_rate", "high_loading_time", "has_render_blocking_resources", "is_broken", "no_image_alt",
  "no_favicon", "is_http", "large_page_size", "has_meta_refresh_redirect", "no_doctype",
] as const;

/** One page checked live (title, description, headings, speed, images...). */
export async function auditPage(t: DataForSeoTransport, url: string): Promise<PageAudit | null> {
  const raw = await liveTask(t, "on_page/instant_pages", { url, enable_javascript: false });
  const [item] = parseItems(raw, pageItem);
  if (!item) return null;
  const checks = item.checks ?? {};
  return {
    url,
    score: item.onpage_score ?? null,
    failed: BAD_CHECKS.filter((c) => checks[c] === true),
    title: item.meta?.title?.slice(0, 300) ?? null,
    h1: item.meta?.htags?.h1?.[0]?.slice(0, 300) ?? null,
    status: item.status_code ?? null,
  };
}

export type KeywordIdea = { keyword: string; searches: number; cpcUsd: number; competition: number | null };

const ideaItem = z.object({
  keyword: z.string(),
  keyword_info: z.object({ search_volume: num, cpc: num, competition: num }).nullable().optional(),
});

/** Searches related to the seed phrases (what people type), with volume and ad cost. */
export async function keywordIdeas(t: DataForSeoTransport, seeds: string[], country: Country, limit = 150): Promise<KeywordIdea[]> {
  const raw = await liveTask(t, "dataforseo_labs/google/keyword_ideas/live", {
    keywords: seeds.slice(0, 20),
    location_code: LOCATION_CODE[country],
    language_code: "en",
    limit,
    order_by: ["keyword_info.search_volume,desc"],
  });
  return parseItems(raw, ideaItem).map((i) => ({
    keyword: i.keyword.toLowerCase().slice(0, 120),
    searches: i.keyword_info?.search_volume ?? 0,
    cpcUsd: i.keyword_info?.cpc ?? 0,
    competition: i.keyword_info?.competition ?? null,
  }));
}

const phraseItem = z.object({
  keyword: z.string(),
  keyword_info: z.object({ search_volume: num, cpc: num }).nullable().optional(),
});

/** Monthly searches for each exact phrase, in one call (phrases with no data are left out). */
export async function phraseVolumes(t: DataForSeoTransport, phrases: string[], country: Country): Promise<Map<string, number>> {
  const raw = await liveTask(t, "dataforseo_labs/google/keyword_overview/live", {
    keywords: phrases.slice(0, 50),
    location_code: LOCATION_CODE[country],
    language_code: "en",
  });
  return new Map(parseItems(raw, phraseItem).map((i) => [i.keyword.toLowerCase(), i.keyword_info?.search_volume ?? 0]));
}

export type DomainCompetitor = { domain: string; sharedSearches: number; trafficEst: number };

const competitorItem = z.object({
  domain: z.string(),
  intersections: num,
  full_domain_metrics: z.object({ organic: z.object({ etv: num }).nullable().optional() }).nullable().optional(),
});

/** Big general sites that compete with everyone; never useful as "your competitor". */
const GENERIC = /(^|\.)(google|youtube|facebook|instagram|linkedin|twitter|x|tiktok|reddit|pinterest|wikipedia|amazon|ebay|yelp|yellowpages|bbb|indeed|glassdoor|quora|apple|microsoft|kijiji|craigslist|mapquest|tripadvisor|nextdoor|angi|homeadvisor|thumbtack|houzz)\.[a-z.]+$/;

/** Sites that rank for many of the same searches as `domain` (Google's view of your competitors). */
export async function domainCompetitors(t: DataForSeoTransport, domain: string, country: Country, limit = 12): Promise<DomainCompetitor[]> {
  const raw = await liveTask(t, "dataforseo_labs/google/competitors_domain/live", {
    target: domain,
    location_code: LOCATION_CODE[country],
    language_code: "en",
    limit: limit + 10,
    exclude_top_domains: true,
  });
  return parseItems(raw, competitorItem)
    .map((i) => ({
      domain: i.domain.toLowerCase().replace(/^www\./, ""),
      sharedSearches: i.intersections ?? 0,
      trafficEst: Math.round(i.full_domain_metrics?.organic?.etv ?? 0),
    }))
    .filter((c) => c.domain !== domain && !GENERIC.test(c.domain))
    .slice(0, limit);
}
