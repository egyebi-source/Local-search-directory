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
});

export async function localSerp(
  t: DataForSeoTransport,
  keyword: string,
  country: Country,
): Promise<{ ads: PaidAd[]; organic: OrganicHit[] }> {
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
  return { ads, organic };
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
