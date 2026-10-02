import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { localVisibility, primaryKeyword } from "@/server/assessment/result";
import type { DataForSeoTransport } from "@/server/dataforseo/client";
import { localSerp, mapsRanking } from "@/server/dataforseo/market";
import { getDb } from "@/server/db/client";
import { campaigns, prospects, prospectSuppressions, type Country } from "@/server/db/schema";
import { withUser } from "@/server/db/tenant";
import { randomToken, sha256Hex } from "@/server/security/hash";
import { appBaseUrl } from "@/server/url";

// "Claim your ranking" campaigns (PRD Module 14). Staff pick a category and
// a city; we look up who's in Google Maps for that search (2 API calls for
// the whole city) and prepare a private report + claim link per business.

export const CLAIM_LINK_DAYS = 60;

/** Numbers only. Other businesses are never named in a prospect's report. */
export type ProspectReport = {
  mapRank: number | null;
  rating: number | null;
  reviews: number | null;
  leaderAvgRating: number | null;
  leaderAvgReviews: number | null;
  organicRank: number | null;
  directoriesInTop10: number;
  listingsChecked: number;
  checkedOn: string;
  dataSource: "sandbox" | "live";
};

export const campaignInputSchema = z.object({
  category: z.string().trim().min(3).max(60),
  city: z.string().trim().min(2).max(60),
  country: z.enum(["CA", "US"]),
});

export type ClaimLink = { businessName: string; domain: string; mapRank: number | null; url: string };

const domainHash = (domain: string) => sha256Hex(`suppress:${domain}`);
const expiry = () => new Date(Date.now() + CLAIM_LINK_DAYS * 24 * 60 * 60 * 1000);
const claimUrl = (token: string) => `${appBaseUrl()}/claim/${token}`;

export async function createCampaign(
  adminId: string,
  input: z.infer<typeof campaignInputSchema>,
  deps: { dataforseo: DataForSeoTransport; dataSource: "sandbox" | "live" },
): Promise<{ campaignId: string; links: ClaimLink[] }> {
  const keyword = primaryKeyword(input.category, input.city);
  const country = input.country as Country;
  const [listings, serp] = await Promise.all([
    mapsRanking(deps.dataforseo, keyword, country),
    localSerp(deps.dataforseo, keyword, country).catch(() => ({ ads: [], organic: [] })),
  ]);
  const checkedOn = new Date().toISOString().slice(0, 10);

  return withUser(adminId, async (tx) => {
    const suppressed = new Set((await tx.select({ h: prospectSuppressions.domainHash }).from(prospectSuppressions)).map((r) => r.h));
    const [campaign] = await tx
      .insert(campaigns)
      .values({ name: `${input.category} · ${input.city}`, category: input.category, city: input.city, country, keyword, dataSource: deps.dataSource, createdByUserId: adminId })
      .returning({ id: campaigns.id });

    const seen = new Set<string>();
    const links: ClaimLink[] = [];
    for (const l of listings) {
      const domain = l.domain ? normalizeDomain(l.domain) : null;
      // No website = no way to verify ownership; franchises share a domain, keep the best-ranked.
      if (!domain || seen.has(domain) || suppressed.has(domainHash(domain))) continue;
      seen.add(domain);
      const v = localVisibility(keyword, listings, serp.organic, domain);
      const report: ProspectReport = {
        mapRank: v.yourRank,
        rating: v.you?.rating ?? null,
        reviews: v.you?.reviews ?? null,
        leaderAvgRating: v.leaderAvgRating,
        leaderAvgReviews: v.leaderAvgReviews,
        organicRank: serp.organic.find((o) => normalizeDomain(o.domain) === domain)?.position ?? null,
        directoriesInTop10: v.directoriesInTop10,
        listingsChecked: listings.length,
        checkedOn,
        dataSource: deps.dataSource,
      };
      const token = randomToken();
      await tx.insert(prospects).values({
        campaignId: campaign.id,
        businessName: l.name.slice(0, 120),
        domain,
        report,
        tokenHash: sha256Hex(token),
        expiresAt: expiry(),
      });
      links.push({ businessName: l.name, domain, mapRank: v.yourRank, url: claimUrl(token) });
    }
    return { campaignId: campaign.id, links };
  });
}

/** New links for every unclaimed prospect; old links stop working. */
export async function reissueLinks(adminId: string, campaignId: string): Promise<ClaimLink[]> {
  return withUser(adminId, async (tx) => {
    const rows = await tx
      .select({ id: prospects.id, name: prospects.businessName, domain: prospects.domain, report: prospects.report, status: prospects.status })
      .from(prospects)
      .where(eq(prospects.campaignId, campaignId));
    const links: ClaimLink[] = [];
    for (const r of rows) {
      if (r.status === "claimed") continue;
      const token = randomToken();
      await tx.update(prospects).set({ tokenHash: sha256Hex(token), expiresAt: expiry() }).where(eq(prospects.id, r.id));
      links.push({ businessName: r.name, domain: r.domain, mapRank: (r.report as ProspectReport).mapRank, url: claimUrl(token) });
    }
    return links.sort((a, b) => (a.mapRank ?? 99) - (b.mapRank ?? 99));
  });
}

export async function listCampaigns(adminId: string) {
  return withUser(adminId, (tx) =>
    tx
      .select({
        id: campaigns.id,
        name: campaigns.name,
        keyword: campaigns.keyword,
        country: campaigns.country,
        dataSource: campaigns.dataSource,
        createdAt: campaigns.createdAt,
        total: sql<number>`(SELECT count(*)::int FROM prospects p WHERE p.campaign_id = ${campaigns.id})`,
        opened: sql<number>`(SELECT count(*)::int FROM prospects p WHERE p.campaign_id = ${campaigns.id} AND p.status <> 'new')`,
        claimed: sql<number>`(SELECT count(*)::int FROM prospects p WHERE p.campaign_id = ${campaigns.id} AND p.status = 'claimed')`,
      })
      .from(campaigns)
      .orderBy(desc(campaigns.createdAt)),
  );
}

export async function campaignProspects(adminId: string, campaignId: string) {
  return withUser(adminId, (tx) =>
    tx
      .select({
        id: prospects.id,
        businessName: prospects.businessName,
        domain: prospects.domain,
        report: prospects.report,
        status: prospects.status,
        openedAt: prospects.openedAt,
        claimedAt: prospects.claimedAt,
        expiresAt: prospects.expiresAt,
      })
      .from(prospects)
      .where(and(eq(prospects.campaignId, campaignId)))
      .orderBy(sql`(${prospects.report}->>'mapRank')::int NULLS LAST`),
  );
}

// --- Public claim page -------------------------------------------------------------

export type ClaimView = {
  businessName: string;
  domain: string;
  report: ProspectReport;
  keyword: string;
  city: string;
  category: string;
  country: Country;
  status: "new" | "opened" | "claimed";
};

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const isClaimToken = (t: unknown): t is string => tokenSchema.safeParse(t).success;

/** The prospect behind a claim link, or null (unknown, malformed or expired). Records the first open. */
export async function lookupClaim(token: string): Promise<ClaimView | null> {
  if (!isClaimToken(token)) return null;
  const r = await getDb().execute<{
    business_name: string; domain: string; report: ProspectReport; keyword: string; city: string; category: string; country: Country; status: ClaimView["status"];
  }>(sql`SELECT * FROM claim_lookup(${sha256Hex(token)})`);
  const row = r.rows[0];
  return row
    ? { businessName: row.business_name, domain: row.domain, report: row.report, keyword: row.keyword, city: row.city, category: row.category, country: row.country, status: row.status }
    : null;
}

export async function optOut(token: string, domain: string): Promise<boolean> {
  if (!isClaimToken(token)) return false;
  const r = await getDb().execute<{ ok: boolean }>(sql`SELECT claim_opt_out(${sha256Hex(token)}, ${domainHash(domain)}) AS ok`);
  return Boolean(r.rows[0]?.ok);
}

export async function markClaimed(token: string, orgId: string): Promise<boolean> {
  const r = await getDb().execute<{ ok: boolean }>(sql`SELECT claim_complete(${sha256Hex(token)}, ${orgId}::uuid) AS ok`);
  return Boolean(r.rows[0]?.ok);
}

/**
 * Proof of ownership for a claim: the email must be at the business's own
 * website domain (or a subdomain of it), e.g. owner@acmecollision.ca.
 */
export function emailMatchesDomain(email: string, domain: string): boolean {
  const at = email.trim().toLowerCase().split("@");
  if (at.length !== 2 || !at[0]) return false;
  const host = at[1].replace(/\.$/, "");
  const d = domain.toLowerCase();
  return host === d || host.endsWith(`.${d}`);
}
