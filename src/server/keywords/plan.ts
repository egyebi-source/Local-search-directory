import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { cityFrom, isOwnDomain } from "@/server/assessment/result";
import { loadSnapshots, type Snapshot } from "@/server/dashboard/snapshot";
import type { DataForSeoTransport } from "@/server/dataforseo/client";
import { auditPage, keywordIdeas, localSerp, siteKeywords, type SiteKeyword } from "@/server/dataforseo/market";
import { actionItems, keywordPlans, organizations, type Country } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";
import { SpendCapReachedError } from "@/server/security/spend";

// The keyword plan (core of the product): discover what people search for
// this kind of business, see which searches competitors pay for, check
// whether the business's pages match each search, and give the exact
// change to make. Pure functions are exported for tests.

const PAGE_ONE_SHARE = 0.1; // rough share of a search's clicks a page-1 result earns
const MAX_TOPICS = 8;
const SERP_CHECKS = 10; // live Google checks for the most valuable searches

// Words that describe *how* people search, not *what* for.
const MODIFIERS = new Set(
  "near me best top cheap affordable cost costs price prices how much shop shops service services company companies in near my the a an for and local on open now 24 hour hours same day emergency free estimate estimates quote quotes reviews".split(" "),
);

const kwSchema = z.object({
  keyword: z.string().max(120),
  searches: z.number().min(0),
  cpcUsd: z.number().min(0),
  position: z.number().int().min(1).max(100).nullable(),
  url: z.string().max(2048).nullable(),
  adsBy: z.array(z.string().max(253)).max(10).nullable(),
  top3: z.array(z.string().max(253)).max(3).nullable(),
});
const topicSchema = z.object({
  name: z.string().max(80),
  status: z.enum(["aligned", "weak", "missing"]),
  searches: z.number().min(0),
  valueUsd: z.number().min(0),
  bestPosition: z.number().nullable(),
  page: z.object({ url: z.string().max(2048), title: z.string().max(300).nullable(), h1: z.string().max(300).nullable() }).nullable(),
  matched: z.boolean().nullable(),
  keywords: z.array(kwSchema).max(40),
  // Omitted = write it from the topic when loading (used by demo data, so it shows the real templates).
  change: z
    .object({ kind: z.enum(["page_title", "new_page"]), title: z.string().max(120), why: z.string().max(400), content: z.string().max(3000) })
    .nullable()
    .optional(),
});
export const planSchema = z.object({ topics: z.array(topicSchema).max(MAX_TOPICS + 1), totalSearches: z.number(), totalValueUsd: z.number() });
export type KeywordPlan = z.infer<typeof planSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type PlanKeyword = z.infer<typeof kwSchema>;

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** "collision repair ottawa near me" -> "collision repair" (the topic). */
export function coreOf(keyword: string, cityWords: string[]): string {
  return words(keyword)
    .filter((w) => !MODIFIERS.has(w) && !cityWords.includes(w))
    .join(" ");
}

// Searches by people who aren't customers (job seekers, students, DIYers...).
const NOT_CUSTOMERS = new Set(
  "job jobs hiring career careers salary salaries wage wages course courses school schools training certification diy kit kits game games simulator meaning definition lawyer lawyers".split(" "),
);

/**
 * Is a search worth targeting? The research step already returns searches
 * related to the business type; drop the business's own name (it already
 * gets those) and searches by people who aren't customers.
 */
export function relevant(keyword: string, brandWords: string[]): boolean {
  const ws = words(keyword);
  if (ws.some((w) => NOT_CUSTOMERS.has(w)) || ws.includes("how") && ws.includes("to")) return false;
  return !(brandWords.length && brandWords.every((b) => ws.includes(b)));
}

export function isHomepage(url: string): boolean {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
}

/** Does a page's title or main heading already contain the topic's words? */
export function pageMatches(core: string, title: string | null, h1: string | null): boolean | null {
  if (title === null && h1 === null) return null;
  const text = words(`${title ?? ""} ${h1 ?? ""}`);
  return words(core).every((w) => text.includes(w) || text.includes(`${w}s`) || text.includes(w.replace(/s$/, "")));
}

export function topicStatus(bestPosition: number | null, matched: boolean | null): Topic["status"] {
  if (bestPosition === null) return "missing";
  if (bestPosition <= 10 && matched !== false) return "aligned";
  return "weak";
}

export function changeFor(t: Pick<Topic, "name" | "status" | "keywords" | "page" | "bestPosition">, business: { name: string; city: string }): Topic["change"] {
  if (t.status === "aligned") return null;
  const Core = titleCase(t.name);
  const City = titleCase(business.city);
  const phrases = [...t.keywords].sort((a, b) => b.searches - a.searches).slice(0, 5).map((k) => k.keyword);
  const title = clip(`${Core} in ${City} | ${business.name}`, 60);
  const h1 = `${Core} in ${City}`;
  const questions = t.keywords.some((k) => /cost|price|how much/.test(k.keyword))
    ? [`How much does ${t.name} cost in ${City}?`, `How long does ${t.name} take?`, "Do you work with my insurance?"]
    : [`How long does ${t.name} take?`, "Do you work with my insurance?", "Do I need an appointment?"];
  // Only the homepage ranks: it can't be retitled for every service, so each topic gets its own page.
  const onlyHome = Boolean(t.page && isHomepage(t.page.url));
  if (t.status === "missing" || !t.page || onlyHome) {
    const total = t.keywords.reduce((s, k) => s + k.searches, 0).toLocaleString("en-US");
    return {
      kind: "new_page",
      title: `Add a "${Core}" page`,
      why: onlyHome
        ? `People search for this about ${total} times a month. Only your homepage shows up${t.bestPosition ? ` (best #${t.bestPosition})` : ""}, and it can't be about every service. A page built around these exact words usually ranks much higher. Keep your homepage as it is.`
        : `People search for this about ${total} times a month and none of your pages show up. A page built around these exact words is how you get found.`,
      content: [
        `Page address: /${`${t.name} ${business.city}`.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        `Page title (under 60 characters): ${title}`,
        `Main heading: ${h1}`,
        "",
        "Use these exact phrases naturally on the page (they're what people type):",
        ...phrases.map((p) => `- ${p}`),
        "",
        "Sections:",
        `1. What we do: 2–3 sentences about ${t.name} at ${business.name}.`,
        "2. Photos of 3 real jobs (before and after).",
        "3. How it works, with typical timing.",
        "4. Why us: certifications, warranty, insurers you work with.",
        "5. 2–3 short quotes from real Google reviews.",
        `6. Questions: ${questions.join(" / ")}`,
        "7. Call button and quote form at the top and bottom.",
        "",
        `Google Business Profile: add "${Core}" under Services.`,
      ].join("\n"),
    };
  }
  return {
    kind: "page_title",
    title: `Match your "${Core}" page to what people search`,
    why: `Your page ${t.bestPosition !== null ? `is #${t.bestPosition}` : "shows up"} for these searches${t.page.title ? `, but its title is "${clip(t.page.title, 70)}"` : ""}. Using the exact words people type in the title and heading is one of the strongest signals to Google.`,
    content: [
      `Page: ${t.page.url}`,
      `New page title (under 60 characters): ${title}`,
      `New main heading: ${h1}`,
      "",
      "Make sure these phrases appear in the page text:",
      ...phrases.map((p) => `- ${p}`),
      "",
      `Add a short questions section: ${questions.join(" / ")}`,
      `Google Business Profile: list "${Core}" under Services.`,
    ].join("\n"),
  };
}

/** Group searches into topics and judge each against the business's pages. */
export function assemblePlan(
  input: {
    business: { name: string; city: string; domain: string; category: string };
    ideas: { keyword: string; searches: number; cpcUsd: number }[];
    site: SiteKeyword[];
    pages: Map<string, { title: string | null; h1: string | null }>;
    serp: Map<string, { adsBy: string[]; top3: string[] }>;
  },
): KeywordPlan {
  const { business } = input;
  const cityWords = words(business.city);
  const catWords = words(business.category).filter((w) => !MODIFIERS.has(w));
  const brandWords = words(business.name).filter((w) => !catWords.includes(w) && !MODIFIERS.has(w));
  const ranks = new Map(input.site.map((k) => [k.keyword.toLowerCase(), k]));

  // All candidate searches: discovered ideas plus anything the site already ranks for.
  const pool = new Map<string, { keyword: string; searches: number; cpcUsd: number }>();
  for (const k of input.ideas) pool.set(k.keyword.toLowerCase(), k);
  for (const k of input.site) if (!pool.has(k.keyword.toLowerCase())) pool.set(k.keyword.toLowerCase(), { keyword: k.keyword, searches: k.searches, cpcUsd: k.cpcUsd });

  const groups = new Map<string, PlanKeyword[]>();
  for (const k of pool.values()) {
    if (k.searches <= 0 || !relevant(k.keyword, brandWords)) continue;
    const core = coreOf(k.keyword, cityWords) || words(business.category).join(" ");
    const r = ranks.get(k.keyword.toLowerCase());
    const s = input.serp.get(k.keyword.toLowerCase());
    const list = groups.get(core) ?? [];
    list.push({
      keyword: k.keyword,
      searches: k.searches,
      cpcUsd: Math.round(k.cpcUsd * 100) / 100,
      position: r?.position ?? null,
      url: r?.url ?? null,
      adsBy: s ? s.adsBy : null,
      top3: s ? s.top3 : null,
    });
    groups.set(core, list);
  }

  const value = (ks: PlanKeyword[]) => Math.round(ks.reduce((v, k) => v + k.searches * k.cpcUsd * PAGE_ONE_SHARE, 0));
  const topics: Topic[] = [...groups]
    .map(([name, ks]) => ({ name, ks: ks.sort((a, b) => b.searches - a.searches).slice(0, 40) }))
    .sort((a, b) => value(b.ks) - value(a.ks))
    .slice(0, MAX_TOPICS)
    .map(({ name, ks }) => {
      const ranked = ks.filter((k) => k.position !== null).sort((a, b) => a.position! - b.position!);
      const best = ranked[0] ?? null;
      const pageUrl = best?.url ?? null;
      const meta = pageUrl ? input.pages.get(pageUrl) : undefined;
      const page = pageUrl ? { url: pageUrl, title: meta?.title ?? null, h1: meta?.h1 ?? null } : null;
      const matched = page ? pageMatches(name, page.title, page.h1) : null;
      const bestPosition = best?.position ?? null;
      const status = topicStatus(bestPosition, matched);
      const t = { name, status, keywords: ks, page, bestPosition };
      return {
        ...t,
        matched,
        searches: ks.reduce((s, k) => s + k.searches, 0),
        valueUsd: value(ks),
        change: changeFor(t, { name: business.name, city: business.city }),
      };
    });
  return planSchema.parse({
    topics,
    totalSearches: topics.reduce((s, t) => s + t.searches, 0),
    totalValueUsd: topics.reduce((s, t) => s + t.valueUsd, 0),
  });
}

function capOr<T>(fallback: T) {
  return (err: unknown): T => {
    if (err instanceof SpendCapReachedError) throw err;
    return fallback;
  };
}

/** Gather the data (about 12–16 DataForSEO calls) and build the plan. */
export async function buildKeywordPlan(
  t: DataForSeoTransport,
  org: { name: string; domain: string; category: string; city: string; country: Country },
  latest: Snapshot | null,
): Promise<KeywordPlan> {
  const seeds = [org.category, `${org.category} ${org.city}`, `${org.category} near me`].map((s) => s.toLowerCase());
  const fresh = latest && Date.now() - new Date(`${latest.takenOn}T00:00:00Z`).getTime() < 8 * 86_400_000;
  const [ideas, site] = await Promise.all([
    keywordIdeas(t, seeds, org.country).catch(capOr([])),
    fresh ? Promise.resolve(latest!.data.keywords) : siteKeywords(t, org.domain, org.country).catch(capOr([] as SiteKeyword[])),
  ]);

  // Live Google check of the most valuable searches: who pays for ads, who's top 3.
  const valuable = [...ideas].sort((a, b) => b.searches * b.cpcUsd - a.searches * a.cpcUsd).slice(0, SERP_CHECKS);
  const serp = new Map<string, { adsBy: string[]; top3: string[] }>();
  await Promise.all(
    valuable.map(async (k) => {
      const r = await localSerp(t, k.keyword, org.country).catch(capOr(null));
      if (!r) return;
      const host = (d: string) => normalizeDomain(d) ?? d;
      serp.set(k.keyword, {
        adsBy: [...new Set(r.ads.map((a) => host(a.domain)).filter((d) => !isOwnDomain(d, org.domain)))].slice(0, 10),
        top3: r.organic.filter((o) => o.position <= 3).map((o) => host(o.domain)).slice(0, 3),
      });
    }),
  );

  // Titles and headings of the pages that rank (from the weekly site check, plus a few more).
  const pages = new Map<string, { title: string | null; h1: string | null }>();
  for (const p of latest?.data.audit?.pages ?? []) pages.set(p.url, { title: p.title ?? null, h1: p.h1 ?? null });
  const rankingUrls = [...new Set(site.map((k) => k.url).filter((u): u is string => Boolean(u)))]
    .filter((u) => {
      try {
        return normalizeDomain(new URL(u).hostname) === org.domain && !pages.has(u);
      } catch {
        return false;
      }
    })
    .slice(0, 4);
  for (const url of rankingUrls) {
    const p = await auditPage(t, url).catch(capOr(null));
    if (p) pages.set(url, { title: p.title, h1: p.h1 });
  }

  return assemblePlan({ business: { name: org.name, city: org.city, domain: org.domain, category: org.category }, ideas, site, pages, serp });
}

export async function savePlan(tx: Tx, orgId: string, dataSource: "sandbox" | "live", plan: KeywordPlan) {
  await tx.insert(keywordPlans).values({ orgId, builtOn: new Date().toISOString().slice(0, 10), dataSource, data: plan });
}

export async function loadPlan(tx: Tx, orgId: string): Promise<{ builtOn: string; dataSource: "sandbox" | "live"; plan: KeywordPlan } | null> {
  const [row] = await tx.select().from(keywordPlans).where(eq(keywordPlans.orgId, orgId)).orderBy(desc(keywordPlans.createdAt)).limit(1);
  if (!row) return null;
  const parsed = planSchema.safeParse(row.data);
  if (!parsed.success) return null;
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  const business = { name: (org?.name ?? "").replace(/\s*\(Demo\)$/, ""), city: cityFrom(org?.serviceArea ?? "") };
  const topics = parsed.data.topics.map((t) => (t.change === undefined ? { ...t, change: changeFor(t, business) } : t));
  return { builtOn: row.builtOn, dataSource: row.dataSource, plan: { ...parsed.data, topics } };
}

export async function buildAndSavePlan(
  orgId: string,
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  deps: { dataforseo: DataForSeoTransport; dataSource: "sandbox" | "live" },
): Promise<KeywordPlan | null> {
  const ctx = await run(async (tx) => ({
    org: (await tx.select().from(organizations).where(eq(organizations.id, orgId)))[0],
    latest: (await loadSnapshots(tx, orgId)).at(-1) ?? null,
  }));
  const o = ctx.org;
  if (!o?.websiteDomain || !o.category) return null;
  const plan = await buildKeywordPlan(
    deps.dataforseo,
    { name: o.name.replace(/\s*\(Demo\)$/, ""), domain: o.websiteDomain, category: o.category, city: cityFrom(o.serviceArea ?? ""), country: (o.country ?? "CA") as Country },
    ctx.latest,
  );
  await run((tx) => savePlan(tx, orgId, deps.dataSource, plan));
  return plan;
}

/** Each topic's best position in each weekly snapshot: before vs now. */
export function topicHistory(topic: Topic, snapshots: Snapshot[]): { day: string; best: number | null; inTop10: number }[] {
  const names = new Set(topic.keywords.map((k) => k.keyword.toLowerCase()));
  return snapshots.map((s) => {
    const hits = s.data.keywords.filter((k) => names.has(k.keyword.toLowerCase()));
    return {
      day: s.takenOn,
      best: hits.length ? Math.min(...hits.map((k) => k.position)) : null,
      inTop10: hits.filter((k) => k.position <= 10).length,
    };
  });
}

/** "Add to my action plan" for one topic's change (no duplicates). */
export async function addTopicToActions(tx: Tx, orgId: string, topic: Topic): Promise<boolean> {
  if (!topic.change) return false;
  const [existing] = await tx
    .select({ id: actionItems.id })
    .from(actionItems)
    .where(and(eq(actionItems.orgId, orgId), eq(actionItems.title, topic.change.title)));
  if (existing) return false;
  await tx.insert(actionItems).values({
    orgId,
    kind: topic.change.kind,
    title: topic.change.title,
    why: topic.change.why,
    content: topic.change.content,
    keyword: topic.keywords[0]?.keyword ?? null,
    valueUsdMonth: topic.valueUsd || null,
    source: "rules",
  });
  return true;
}
