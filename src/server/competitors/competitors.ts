import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import type { DataForSeoTransport } from "@/server/dataforseo/client";
import { domainCompetitors, domainOverview, siteKeywords, type DomainOverview, type SiteKeyword } from "@/server/dataforseo/market";
import { actionItems, competitorReports, competitors, organizations, type Country } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";

// Competitors (who else wins the searches, and with which words). Each
// check reads public search data for the business and up to 5 rivals:
// estimated Google visitors, how many searches they rank for, whether they
// buy ads, the searches bringing them the most visitors, and the "gap":
// searches a rival is on page 1 for and this business isn't.

export const MAX_COMPETITORS = 5;

export class CompetitorLimitError extends Error {}
export class InvalidDomainError extends Error {}

export async function listCompetitors(tx: Tx, orgId: string) {
  return tx
    .select({ id: competitors.id, domain: competitors.domain, source: competitors.source })
    .from(competitors)
    .where(eq(competitors.orgId, orgId))
    .orderBy(competitors.createdAt);
}

export async function addCompetitor(tx: Tx, orgId: string, input: string, source: "you" | "suggested" = "you"): Promise<string> {
  const domain = normalizeDomain(input);
  if (!domain) throw new InvalidDomainError();
  const [org] = await tx.select({ domain: organizations.websiteDomain }).from(organizations).where(eq(organizations.id, orgId));
  if (org?.domain && (domain === org.domain || domain.endsWith(`.${org.domain}`))) throw new InvalidDomainError();
  const current = await listCompetitors(tx, orgId);
  if (current.some((c) => c.domain === domain)) return domain;
  if (current.length >= MAX_COMPETITORS) throw new CompetitorLimitError();
  await tx.insert(competitors).values({ orgId, domain, source });
  return domain;
}

export async function removeCompetitor(tx: Tx, orgId: string, id: string): Promise<void> {
  await tx.delete(competitors).where(and(eq(competitors.orgId, orgId), eq(competitors.id, id)));
}

// --- The report ----------------------------------------------------------------

const kw = z.object({ keyword: z.string(), position: z.number(), searches: z.number(), cpcUsd: z.number(), trafficEst: z.number() });
const site = z.object({
  domain: z.string(),
  trafficEst: z.number().nullable(),
  keywords: z.number().nullable(),
  top10: z.number().nullable(),
  paidKeywords: z.number().nullable(),
  trafficValueUsd: z.number().nullable(),
  topSearches: z.array(kw),
  ok: z.boolean(),
});
const gapRow = z.object({
  keyword: z.string(),
  searches: z.number(),
  cpcUsd: z.number(),
  competitor: z.string(),
  theirPosition: z.number(),
  yourPosition: z.number().nullable(),
});
export const reportSchema = z.object({
  you: site,
  rivals: z.array(site),
  gap: z.array(gapRow),
  suggestions: z.array(z.object({ domain: z.string(), sharedSearches: z.number() })),
});
export type CompetitorReport = z.infer<typeof reportSchema>;
export type SiteSummary = z.infer<typeof site>;
export type GapRow = z.infer<typeof gapRow>;

/** "riverside-collision.ca" -> "riversidecollision": to drop searches for a rival's own name. */
export function brandOf(domain: string): string {
  return domain.split(".")[0].replace(/[^a-z0-9]/g, "");
}

export function isBrandSearch(keyword: string, domain: string): boolean {
  const brand = brandOf(domain);
  return brand.length >= 5 && keyword.replace(/[^a-z0-9]/g, "").includes(brand);
}

function summarize(domain: string, overview: DomainOverview | null, keywords: SiteKeyword[] | null): SiteSummary {
  return {
    domain,
    trafficEst: overview?.trafficEst ?? null,
    keywords: overview?.keywords ?? null,
    top10: overview?.buckets.top10 ?? null,
    paidKeywords: overview?.paidKeywords ?? null,
    trafficValueUsd: overview?.trafficValueUsd ?? null,
    topSearches: (keywords ?? [])
      .filter((k) => !isBrandSearch(k.keyword, domain))
      .slice(0, 15)
      .map((k) => ({ keyword: k.keyword, position: k.position, searches: k.searches, cpcUsd: k.cpcUsd, trafficEst: k.trafficEst })),
    ok: overview !== null || keywords !== null,
  };
}

/**
 * Searches a rival is on page 1 for and you're not (or are below), most
 * valuable first. Each rival's own brand name, and the business's, are left out.
 */
export function findGap(yourDomain: string, yours: SiteKeyword[], rivals: { domain: string; keywords: SiteKeyword[] }[], limit = 30): GapRow[] {
  const mine = new Map(yours.map((k) => [k.keyword, k.position]));
  const best = new Map<string, GapRow>();
  for (const r of rivals) {
    for (const k of r.keywords) {
      if (k.position > 10 || k.searches < 10) continue;
      if (isBrandSearch(k.keyword, r.domain) || isBrandSearch(k.keyword, yourDomain)) continue;
      const you = mine.get(k.keyword) ?? null;
      if (you !== null && you <= k.position) continue; // you already beat or match them
      if (you !== null && you <= 3) continue;
      const prev = best.get(k.keyword);
      if (!prev || k.position < prev.theirPosition) {
        best.set(k.keyword, { keyword: k.keyword, searches: k.searches, cpcUsd: k.cpcUsd, competitor: r.domain, theirPosition: k.position, yourPosition: you });
      }
    }
  }
  const value = (g: GapRow) => g.searches * Math.max(g.cpcUsd, 0.5);
  return [...best.values()].sort((a, b) => value(b) - value(a)).slice(0, limit);
}

const settle = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

export async function buildReport(
  t: DataForSeoTransport,
  yourDomain: string,
  rivalDomains: string[],
  country: Country,
): Promise<CompetitorReport> {
  const [yourOverview, yourKeywords, suggested, ...rivalData] = await Promise.all([
    settle(domainOverview(t, yourDomain, country)),
    settle(siteKeywords(t, yourDomain, country, 300)),
    settle(domainCompetitors(t, yourDomain, country)),
    ...rivalDomains.map((d) => Promise.all([settle(domainOverview(t, d, country)), settle(siteKeywords(t, d, country, 150))])),
  ]);
  const rivals = rivalDomains.map((d, i) => {
    const [overview, keywords] = rivalData[i] as [DomainOverview | null, SiteKeyword[] | null];
    return { domain: d, overview, keywords };
  });
  const taken = new Set([yourDomain, ...rivalDomains]);
  return {
    you: summarize(yourDomain, yourOverview as DomainOverview | null, yourKeywords as SiteKeyword[] | null),
    rivals: rivals.map((r) => summarize(r.domain, r.overview, r.keywords)),
    gap: findGap(
      yourDomain,
      (yourKeywords as SiteKeyword[] | null) ?? [],
      rivals.map((r) => ({ domain: r.domain, keywords: r.keywords ?? [] })),
    ),
    suggestions: ((suggested as Awaited<ReturnType<typeof domainCompetitors>> | null) ?? [])
      .filter((s) => !taken.has(s.domain))
      .slice(0, 8)
      .map((s) => ({ domain: s.domain, sharedSearches: s.sharedSearches })),
  };
}

export async function saveReport(tx: Tx, orgId: string, dataSource: "sandbox" | "live", report: CompetitorReport, now = new Date()) {
  await tx.insert(competitorReports).values({ orgId, takenOn: now.toISOString().slice(0, 10), dataSource, data: report });
}

export async function loadReport(tx: Tx, orgId: string): Promise<{ takenOn: string; dataSource: "sandbox" | "live"; report: CompetitorReport } | null> {
  const [row] = await tx
    .select()
    .from(competitorReports)
    .where(eq(competitorReports.orgId, orgId))
    .orderBy(desc(competitorReports.createdAt))
    .limit(1);
  if (!row) return null;
  const parsed = reportSchema.safeParse(row.data);
  return parsed.success ? { takenOn: row.takenOn, dataSource: row.dataSource, report: parsed.data } : null;
}

/** One plain-English summary line for the top of the page. */
export function competitorNote(r: CompetitorReport): string {
  const leader = [...r.rivals].filter((s) => s.trafficEst !== null).sort((a, b) => (b.trafficEst ?? 0) - (a.trafficEst ?? 0))[0];
  const parts: string[] = [];
  const yours = r.you.trafficEst ?? 0;
  if (leader && (leader.trafficEst ?? 0) > yours) {
    const top = leader.topSearches[0];
    parts.push(
      `${leader.domain} gets about ${(leader.trafficEst ?? 0).toLocaleString("en-US")} visitors a month from Google; you get about ${yours.toLocaleString("en-US")}.` +
        (top ? ` Their biggest source is "${top.keyword}" (#${top.position}).` : ""),
    );
  } else if (leader) {
    parts.push(`You get more Google visitors than the rivals you're tracking (about ${yours.toLocaleString("en-US")} a month).`);
  }
  const g = r.gap[0];
  if (g) {
    parts.push(
      `Biggest gap: "${g.keyword}" (about ${g.searches.toLocaleString("en-US")} searches a month), where ${g.competitor} is #${g.theirPosition} and you're ${g.yourPosition === null ? "not in the top 100" : `#${g.yourPosition}`}.`,
    );
  }
  const advertisers = r.rivals.filter((s) => (s.paidKeywords ?? 0) > 0).map((s) => s.domain);
  if (advertisers.length) parts.push(`${advertisers.join(", ")} also ${advertisers.length === 1 ? "pays" : "pay"} for Google ads.`);
  return parts.join(" ") || "Add a competitor and run a check to see how they get found.";
}

/** Turn a gap search into an action-plan item (once). */
export async function addGapToActions(tx: Tx, orgId: string, g: GapRow): Promise<boolean> {
  const title = `Win "${g.keyword}" (${g.competitor} is #${g.theirPosition})`;
  const [existing] = await tx
    .select({ id: actionItems.id })
    .from(actionItems)
    .where(and(eq(actionItems.orgId, orgId), eq(actionItems.title, title)));
  if (existing) return false;
  const slug = g.keyword.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  await tx.insert(actionItems).values({
    orgId,
    kind: "new_page",
    title,
    why: `About ${g.searches.toLocaleString("en-US")} searches a month${g.cpcUsd > 0 ? ` (ads cost about $${g.cpcUsd.toFixed(2)} a click)` : ""}. ${g.competitor} is on page 1; you're ${g.yourPosition === null ? "not in the top 100" : `#${g.yourPosition}`}.`,
    content: [
      `Page address: /${slug}`,
      `Page title (under 60 characters): ${g.keyword.replace(/\b\w/g, (c) => c.toUpperCase())}`,
      `Main heading: ${g.keyword.replace(/\b\w/g, (c) => c.toUpperCase())}`,
      "",
      `Look at ${g.competitor}'s page for this search: what it covers, how long it is, what questions it answers. Write a clearer, more complete page:`,
      "1. Say plainly what you offer for this, and who it's for.",
      "2. Proof: real numbers, examples or customer results.",
      "3. Answer the 3-5 questions people ask before buying.",
      "4. A clear next step (call, quote or sign-up) at the top and bottom.",
      "5. Link to it from your homepage and menu.",
    ].join("\n"),
    keyword: g.keyword,
    valueUsdMonth: Math.round(g.searches * g.cpcUsd * 0.1) || null,
    source: "rules",
  });
  return true;
}
