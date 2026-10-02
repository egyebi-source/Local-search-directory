import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { looksLikeTheirs, rulePlan, type PlanInput } from "@/server/actions/plan";
import { cityFrom } from "@/server/assessment/result";
import type { DataForSeoTransport } from "@/server/dataforseo/client";
import { isDirectory } from "@/server/assessment/result";
import { auditPage, findBusiness } from "@/server/dataforseo/market";
import { campaigns, prospects, type Country } from "@/server/db/schema";
import { withUser } from "@/server/db/tenant";
import { randomToken, sha256Hex } from "@/server/security/hash";
import { appBaseUrl } from "@/server/url";
import { CLAIM_LINK_DAYS, type ProspectReport } from "./campaigns";
import { findPublishedEmail } from "./contact-finder";

// Selling to a campaign's businesses, one at a time: a deeper check (website
// scan + the same evidence-based fixes our customers get), the business's
// public contact details, a pitch, and an outreach log. Staff send messages
// from their own mailbox or phone; nothing is mass-sent from here.

export const analysisSchema = z.object({
  checkedOn: z.string(),
  site: z.object({
    status: z.number().nullable(),
    broken: z.boolean(),
    title: z.string().nullable(),
    h1: z.string().nullable(),
    notTheirs: z.boolean(),
  }),
  // Shown to the owner on the claim page too: plain text, numbers about them only.
  fixes: z.array(z.object({ title: z.string().max(140), why: z.string().max(500) })).max(3),
});
export type ProspectAnalysis = z.infer<typeof analysisSchema>;

export type ProspectProfile = {
  id: string;
  campaignId: string;
  businessName: string;
  domain: string;
  report: ProspectReport;
  status: "new" | "opened" | "claimed";
  openedAt: Date | null;
  claimedAt: Date | null;
  expiresAt: Date;
  phone: string | null;
  email: string | null;
  emailSource: string | null;
  analysis: ProspectAnalysis | null;
  analyzedAt: Date | null;
  contactedAt: Date | null;
  contactChannel: string | null;
  campaign: { name: string; category: string; city: string; country: Country; keyword: string };
};

export async function loadProspect(adminId: string, prospectId: string): Promise<ProspectProfile | null> {
  return withUser(adminId, async (tx) => {
    const [row] = await tx
      .select({ p: prospects, c: { name: campaigns.name, category: campaigns.category, city: campaigns.city, country: campaigns.country, keyword: campaigns.keyword } })
      .from(prospects)
      .innerJoin(campaigns, eq(campaigns.id, prospects.campaignId))
      .where(eq(prospects.id, prospectId));
    if (!row) return null;
    const a = analysisSchema.safeParse(row.p.analysis);
    return {
      id: row.p.id,
      campaignId: row.p.campaignId,
      businessName: row.p.businessName,
      domain: row.p.domain,
      report: row.p.report as unknown as ProspectReport,
      status: row.p.status,
      openedAt: row.p.openedAt,
      claimedAt: row.p.claimedAt,
      expiresAt: row.p.expiresAt,
      phone: row.p.phone,
      email: row.p.email,
      emailSource: row.p.emailSource,
      analysis: a.success ? a.data : null,
      analyzedAt: row.p.analyzedAt,
      contactedAt: row.p.contactedAt,
      contactChannel: row.p.contactChannel,
      campaign: row.c,
    };
  });
}

/** The fixes we'd lead with, from the Maps numbers and a scan of the homepage. Pure, for tests. */
export function prospectFixes(
  p: { businessName: string; domain: string; report: ProspectReport; campaign: { category: string; city: string; keyword: string } },
  site: PlanInput["site"],
): ProspectAnalysis["fixes"] {
  const r = p.report;
  const input: PlanInput = {
    business: { name: p.businessName, category: p.campaign.category, city: cityFrom(p.campaign.city), website: p.domain, goals: ["calls"] },
    mainSearch: p.campaign.keyword,
    local: { mapRank: r.mapRank, reviews: r.reviews, rating: r.rating, leaderAvgReviews: r.leaderAvgReviews, leaderAvgRating: r.leaderAvgRating },
    site,
    keywords: [],
  };
  // A pitch needs variety: at most one website item, then Maps, reviews and rating.
  const drafts = rulePlan(input);
  const web = drafts.filter((d) => d.kind === "site_fix" || d.kind === "page_title").slice(0, 1);
  const rest = drafts.filter((d) => d.kind !== "site_fix" && d.kind !== "page_title");
  const broken = site?.broken || site?.notTheirs;
  // A site that doesn't load (or isn't theirs) is the headline; otherwise lead with Maps.
  return (broken ? [...web, ...rest] : [...rest.slice(0, 2), ...web, ...rest.slice(2)])
    .slice(0, 3)
    .map((d) => ({ title: d.title.slice(0, 140), why: d.why.slice(0, 500) }));
}

/**
 * The deeper check for one business (about 2 cents): its homepage, its
 * published email and its listing's phone, then its top fixes.
 */
export async function analyzeProspect(
  adminId: string,
  prospectId: string,
  deps: { dataforseo: DataForSeoTransport; findEmail?: (domain: string) => Promise<{ email: string; source: string } | null> },
): Promise<ProspectProfile | null> {
  const findEmail = deps.findEmail ?? findPublishedEmail;
  const p = await loadProspect(adminId, prospectId);
  if (!p) return null;
  const directory = isDirectory(p.domain);
  const [page, emailFound, listings] = await Promise.all([
    auditPage(deps.dataforseo, `https://${p.domain}/`).catch(() => null),
    directory ? Promise.resolve(null) : findEmail(p.domain).catch(() => null),
    p.phone ? Promise.resolve([]) : findBusiness(deps.dataforseo, p.businessName, p.campaign.city, p.campaign.country).catch(() => []),
  ]);
  const broken = !page || page.failed.includes("is_broken") || (page.status ?? 200) >= 400;
  const homepage = page ? { url: page.url, title: page.title, h1: page.h1 } : null;
  const notTheirs = !broken && !looksLikeTheirs(p.businessName, p.domain, homepage);
  const site: PlanInput["site"] = {
    broken,
    status: page?.status ?? null,
    homepage,
    missingDescription: [],
    notTheirs,
  };
  const analysis: ProspectAnalysis = {
    checkedOn: new Date().toISOString().slice(0, 10),
    site: { status: page?.status ?? null, broken, title: page?.title ?? null, h1: page?.h1 ?? null, notTheirs },
    fixes: prospectFixes(p, site),
  };
  const phone = p.phone ?? listings.find((l) => l.domain === p.domain)?.phone ?? null;
  await withUser(adminId, (tx) =>
    tx
      .update(prospects)
      .set({
        analysis,
        analyzedAt: new Date(),
        phone,
        email: emailFound?.email ?? p.email,
        emailSource: emailFound?.source ?? p.emailSource,
      })
      .where(eq(prospects.id, prospectId)),
  );
  return loadProspect(adminId, prospectId);
}

/** A fresh private link for one business (its earlier link stops working). */
export async function newClaimLink(adminId: string, prospectId: string): Promise<string | null> {
  const token = randomToken();
  const done = await withUser(adminId, (tx) =>
    tx
      .update(prospects)
      .set({ tokenHash: sha256Hex(token), expiresAt: new Date(Date.now() + CLAIM_LINK_DAYS * 86_400_000) })
      .where(and(eq(prospects.id, prospectId)))
      .returning({ id: prospects.id }),
  );
  return done.length ? `${appBaseUrl()}/claim/${token}` : null;
}

export const CHANNELS = ["email", "phone", "visit", "mail"] as const;
export type Channel = (typeof CHANNELS)[number];

export async function markContacted(adminId: string, prospectId: string, channel: Channel): Promise<void> {
  await withUser(adminId, (tx) => tx.update(prospects).set({ contactedAt: new Date(), contactChannel: channel }).where(eq(prospects.id, prospectId)));
}

/** What to say on the phone or at the counter: short, with their numbers. */
export function pitchOpener(p: Pick<ProspectProfile, "businessName" | "report" | "analysis" | "campaign">): string {
  const r = p.report;
  const where =
    r.mapRank === null
      ? `you're not in the top 20 on Google Maps when people search "${p.campaign.keyword}"`
      : `you're #${r.mapRank} on Google Maps when people search "${p.campaign.keyword}"`;
  const lead = p.analysis?.fixes[0]?.title;
  return `Hi, this is [your name] with TorqueRank. I looked at how ${p.businessName} shows up on Google: ${where}. Most calls go to the top 3.${lead ? ` The first thing I'd fix: ${lead.charAt(0).toLowerCase()}${lead.slice(1)}.` : ""} I put together a free, private report for you. Can I send it over?`;
}

/** Email draft for staff to send from their own mailbox. Placeholders in [brackets] must be filled first. */
export function emailDraft(p: Pick<ProspectProfile, "businessName" | "report" | "analysis" | "campaign">, link: string): { subject: string; body: string } {
  const r = p.report;
  const lines = [
    r.mapRank === null
      ? `- You're not in the top 20 on Google Maps for "${p.campaign.keyword}".`
      : `- You're #${r.mapRank} on Google Maps for "${p.campaign.keyword}" (most calls go to the top 3).`,
    ...(r.reviews !== null && r.leaderAvgReviews !== null
      ? [`- You have ${r.reviews.toLocaleString("en-US")} Google reviews; the top 3 average ${r.leaderAvgReviews.toLocaleString("en-US")}.`]
      : []),
    ...(p.analysis?.fixes.map((f) => `- ${f.title}`) ?? []),
  ].slice(0, 4);
  return {
    subject: `${p.businessName}: where you stand on Google`,
    body: [
      "Hi [owner's name],",
      "",
      `I looked at how ${p.businessName} shows up when people in ${p.campaign.city} search Google for ${p.campaign.category.toLowerCase()}:`,
      "",
      ...lines,
      "",
      "Your full report is free and private to you (no sign-up needed to read it):",
      link,
      "",
      "Happy to walk you through it in 10 minutes if that's useful.",
      "",
      "[Your name]",
      "TorqueRank · [your phone]",
      "[Your mailing address]",
      "",
      "You're getting this because your business email is published on your website. If you'd rather not hear from us, reply \"remove\" or use the link at the bottom of your report, and we won't contact you again.",
    ].join("\n"),
  };
}
