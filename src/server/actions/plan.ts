import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AssessmentResult } from "@/server/assessment/result";
import { cityFrom } from "@/server/assessment/result";
import { loadSnapshots } from "@/server/dashboard/snapshot";
import { isHomepage } from "@/server/keywords/plan";
import { judgeSearch, mainService } from "@/server/keywords/relevance";
import { actionItems, orgAssessments, organizations, rankChecks, siteChanges, trackedSearches, type ActionKind } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";

// The action plan (PRD Module 7/12): concrete, ready-to-paste changes.
// Every item is chosen because a number about *this* business calls for
// it (its Google Maps spot, its reviews and rating against the shops above
// it, what its website actually shows, the searches it's missing), and its
// "why" cites that number. Nothing is suggested without evidence: a shop
// with more reviews than its rivals is never told to get more reviews.
// Every item is plain text.

export type SiteEvidence = {
  /** The homepage returned an error (or nothing) when we visited. */
  broken: boolean;
  /** The HTTP status we got, when known (403 = the site turned our visit away). */
  status?: number | null;
  homepage: { url: string; title: string | null; h1: string | null } | null;
  /** Pages with no description for Google's results. */
  missingDescription: string[];
  /** Neither the address nor the homepage mentions the business's name: probably a directory or someone else's site. */
  notTheirs?: boolean;
};

const NAME_NOISE = new Set("the and auto autos car cars collision collisions body shop shops repair repairs centre center service services inc ltd llc corp company group".split(" "));

/** Does a website look like it belongs to this business? (Its name shows in the address or homepage.) */
export function looksLikeTheirs(name: string, domain: string | null, homepage: { title: string | null; h1: string | null } | null): boolean {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  const distinctive = words.filter((w) => !NAME_NOISE.has(w));
  const probe = distinctive.length ? distinctive : words;
  if (!probe.length) return true;
  const haystack = `${(domain ?? "").replace(/[^a-z0-9]/g, "")} ${(homepage?.title ?? "").toLowerCase()} ${(homepage?.h1 ?? "").toLowerCase()}`;
  // Typos happen ("Collison"): a 5-letter start is enough.
  return probe.some((w) => haystack.includes(w) || (w.length >= 6 && haystack.includes(w.slice(0, 5))));
}

export type PlanInput = {
  business: { name: string; category: string; city: string; website: string | null; goals: string[] };
  /** The search we track for this business ("collision repair brampton"). */
  mainSearch: string | null;
  local: { mapRank: number | null; reviews: number | null; rating: number | null; leaderAvgReviews: number | null; leaderAvgRating: number | null } | null;
  site: SiteEvidence | null;
  keywords: { keyword: string; monthlySearches: number; cpcUsd: number; position: number | null }[];
};

export type Draft = { kind: ActionKind; title: string; why: string; content: string; keyword: string | null };

/** Rough share of a search's clicks a page-1 result earns; used for estimated value only. */
const PAGE_ONE_CLICK_SHARE = 0.1;

/** Estimated monthly value of ranking for a keyword: what those clicks would cost as ads. */
export function estimatedValue(input: PlanInput, keyword: string | null): number | null {
  if (!keyword) return null;
  const k = input.keywords.find((x) => x.keyword.toLowerCase() === keyword.toLowerCase());
  if (!k || k.monthlySearches <= 0 || k.cpcUsd <= 0) return null;
  return Math.round(k.monthlySearches * k.cpcUsd * PAGE_ONE_CLICK_SHARE);
}

const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const n = (x: number) => x.toLocaleString("en-US");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A heading that's a phone number, an address or a slogan without the service tells Google nothing. */
export function weakHeading(h1: string | null, service: string): boolean {
  if (!h1 || !/[a-z]{3}/i.test(h1)) return true;
  const letters = h1.replace(/[^a-z]/gi, "").length;
  const digits = h1.replace(/\D/g, "").length;
  if (digits >= 7 && digits >= letters / 2) return true; // mostly a phone number
  const words = service.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
  return words.length > 0 && !words.some((w) => h1.toLowerCase().includes(w.replace(/s$/, "")));
}

const path = (url: string) => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

/** The plan, from evidence. Most important first; never more than 7 items. */
export function rulePlan(input: PlanInput): Draft[] {
  const { name, city } = input.business;
  const service = mainService(input.business.category);
  const Service = title(service);
  const City = title(city);
  const where = City ? ` in ${City}` : "";
  const out: Draft[] = [];
  const l = input.local;
  const site = input.site;

  // 1. The website itself.
  if (site?.notTheirs && !site.broken) {
    out.push({
      kind: "site_fix",
      title: `Check the website on file: ${input.business.website ?? "it"} may not be ${name}'s`,
      why: `Neither the address nor the homepage of ${input.business.website ?? "the website on file"} mentions "${name}"${site.homepage?.title ? ` (its homepage title is "${clip(site.homepage.title, 60)}")` : ""}. It may be a directory or another business, so we haven't suggested website changes for it.`,
      content: [
        `1. Search "${name}" on Google Maps and open its listing. Which website does it link to?`,
        "2. If that's a different site, update it under Team → Business details. We'll scan the right site and rebuild this plan.",
        "3. If the shop has no website of its own, that's the first thing to fix: a one-page site with the service, city, phone and photos is enough to start.",
      ].join("\n"),
      keyword: null,
    });
  } else if (site?.broken) {
    out.push({
      kind: "site_fix",
      title: site.status === 403 ? "Your website turned away our visit" : "Your website didn't load when we checked it",
      why:
        site.status === 403
          ? "When we visited your homepage, the site refused the visit (error 403). Some sites block automated visitors on purpose, but the same setting can keep Google from reading your pages."
          : `When we visited your homepage it returned ${site.status ? `an error (${site.status})` : "an error"} instead of the page. Customers who click your listing on Google may see the same, and Google can't rank a page it can't read.`,
      content: [
        "1. Open your website on your phone and on a computer. Does it load?",
        "2. If it doesn't: call whoever hosts or built the site (or log in to Wix, Squarespace, GoDaddy...) and check the plan hasn't expired and the domain still points to the site.",
        "3. If it loads for you: your site may be blocking automated visitors. Ask your web person to check that search engines aren't blocked (in Google Search Console, use \"URL inspection\" on your homepage).",
        "",
        "We'll check again on the next weekly scan, and this item clears once the site loads.",
      ].join("\n"),
      keyword: null,
    });
  } else if (site?.homepage) {
    const hp = site.homepage;
    if (weakHeading(hp.h1, service)) {
      out.push({
        kind: "site_fix",
        title: `Change your homepage's main heading to "${Service}${where}"`,
        why: hp.h1
          ? `Your homepage's main heading is "${clip(hp.h1, 60)}". It's the first thing Google reads to understand what the page is about, and it doesn't say what you do or where.`
          : "Your homepage has no main heading. It's the first thing Google reads to understand what the page is about.",
        content: [
          `New main heading (the biggest text at the top, set as "Heading 1"): ${Service}${where}`,
          `Line under it: ${name}: [one sentence on what makes you different, e.g. years in business or warranty].`,
          hp.h1 && /\d{3}/.test(hp.h1) ? "Keep your phone number visible as a button or in the header, just not as the heading." : "",
          "",
          "(In Wix, WordPress or Squarespace: click the top text, set its style to Heading 1. Your web person can do it in 10 minutes.)",
        ]
          .filter((x) => x !== null)
          .join("\n")
          .replace(/\n\n\n/g, "\n\n"),
        keyword: input.mainSearch,
      });
    }
    const t = hp.title?.toLowerCase() ?? "";
    const serviceWords = service.split(/\s+/).filter((w) => w.length >= 4);
    const titleMissing = !hp.title || !serviceWords.some((w) => t.includes(w.replace(/s$/, ""))) || (city && !t.includes(city.toLowerCase()));
    if (titleMissing) {
      out.push({
        kind: "page_title",
        title: "Put your service and city in your homepage title",
        why: hp.title
          ? `Your homepage title is "${clip(hp.title, 70)}". It's the blue headline people see on Google, and it should say what you do${city ? ` and where (${City})` : ""}.`
          : "Your homepage has no title, so Google writes its own headline for you.",
        content: `Homepage title (under 60 characters):\n${clip(`${Service}${where} | ${name}`, 60)}\n\nDescription (under 155 characters):\n${clip(`${Service}${where} from ${name}. [What makes you different]. Call or book a free estimate.`, 155)}\n\n(Your website manager can change these in your site's SEO settings in about 10 minutes.)`,
        keyword: input.mainSearch,
      });
    }
    if (site.missingDescription.length >= 2) {
      out.push({
        kind: "site_fix",
        title: `Add descriptions to ${site.missingDescription.length} pages`,
        why: `${site.missingDescription.length} of the pages we checked have no description, so Google shows a random snippet of text under your link instead of a reason to click.`,
        content: [
          "Write one or two sentences (under 155 characters) for each page, saying what it offers and ending with a reason to call:",
          ...site.missingDescription.slice(0, 8).map((u) => `- ${path(u)}`),
          "",
          `Example: "${clip(`${Service}${where}. [Warranty / insurers you work with / turnaround]. Free estimates, call today.`, 155)}"`,
        ].join("\n"),
        keyword: null,
      });
    }
  }

  // 2. Google Maps: only when the numbers say it's a problem.
  if (l && input.mainSearch) {
    if (l.mapRank === null) {
      out.push({
        kind: "gbp_profile",
        title: `Get into Google Maps for "${input.mainSearch}"`,
        why: `When we searched "${input.mainSearch}" in Google Maps, you weren't in the first 20 results. Most calls for local services come from the top 3.`,
        content: [
          "1. Search your business name on Google Maps. If it isn't there, create your profile at business.google.com and verify it.",
          `2. Primary category: the one closest to "${Service}" (e.g. "Auto body shop" for collision repair).`,
          `3. Address: make sure it's in ${City || "your area"} and matches your website exactly.`,
          "4. Website: link your profile to your homepage.",
          `5. Services: list each service you offer, one per line.`,
        ].join("\n"),
        keyword: input.mainSearch,
      });
    } else if (l.mapRank > 3) {
      out.push({
        kind: "gbp_profile",
        title: `Move from #${l.mapRank} toward the top 3 in Google Maps`,
        why: `You're #${l.mapRank} in Google Maps for "${input.mainSearch}". Most calls go to the top 3. Your profile's category, services and photos are the levers you control today.`,
        content: [
          `Primary category: the one closest to "${Service}".`,
          "Services (one per line, in \"Services\"):",
          ...input.keywords.slice(0, 5).map((k) => `- ${title(k.keyword.replace(city ? new RegExp(`\\s*${escapeRe(city)}\\s*`, "i") : /$^/, " ").trim())}`),
          "Photos: add 2 a week of real jobs (before and after).",
          "Hours: add holiday hours so Google never shows you as \"might be closed\".",
        ].join("\n"),
        keyword: input.mainSearch,
      });
    }
  }

  // 3. Reviews and rating, against the shops above you.
  if (l && l.reviews !== null && l.leaderAvgReviews !== null && l.reviews < l.leaderAvgReviews) {
    const gap = l.leaderAvgReviews - l.reviews;
    const perWeek = Math.max(1, Math.ceil(gap / 26));
    out.push({
      kind: "review_request",
      title: `Ask every customer for a review (about ${perWeek} a week)`,
      why: `You have ${n(l.reviews)} Google reviews; the top 3 shops in Maps average ${n(l.leaderAvgReviews)}. About ${perWeek} new review${perWeek === 1 ? "" : "s"} a week closes that gap in six months.`,
      content: `Hi [first name], thanks for choosing ${name}. If you're happy with the work, would you mind leaving us a quick Google review? It takes a minute and really helps: [your Google review link]\n\n(Find your review link in your Google Business Profile under "Ask for reviews". Send it to every customer, not just happy ones, and never offer anything in exchange. Google's rules forbid both.)`,
      keyword: null,
    });
  }
  if (l && l.rating !== null && l.leaderAvgRating !== null && l.rating <= l.leaderAvgRating - 0.2) {
    out.push({
      kind: "review_reply",
      title: `Lift your rating from ${l.rating}★ toward ${l.leaderAvgRating}★`,
      why: `Your Google rating is ${l.rating}★; the top 3 shops in Maps average ${l.leaderAvgRating}★.${l.reviews !== null && l.leaderAvgReviews !== null && l.reviews >= l.leaderAvgReviews ? ` You already have more reviews than them (${n(l.reviews)} vs ${n(l.leaderAvgReviews)}), so the rating is the gap, not the count.` : ""} People comparing shops look at the stars first.`,
      content: [
        "1. This week, read your 1–3★ reviews from the last year and note what they have in common (delays, communication, price surprises). Fix that first: it's what's costing you stars.",
        "2. Reply to every 1–3★ review, calmly and without arguing:",
        `   "Hi [name], thank you for telling us, and I'm sorry we let you down on [the issue]. I'd like to make it right. Please call me at [phone] and ask for [owner's name]. – [owner's name], ${name}"`,
        "3. Ask every customer for a review when they pick up. More recent reviews from normal jobs is what moves the average.",
      ].join("\n"),
      keyword: null,
    });
  }

  // 4. Searches you're missing (already filtered to ones your customers type).
  const targets = input.keywords.filter((k) => k.position !== null && k.position > 3).sort((a, b) => b.monthlySearches * b.cpcUsd - a.monthlySearches * a.cpcUsd);
  const missing = input.keywords.filter((k) => k.position === null).sort((a, b) => b.monthlySearches * b.cpcUsd - a.monthlySearches * a.cpcUsd);
  const pageKw = targets[0] ?? missing[0];
  if (pageKw) {
    const kw = pageKw.keyword;
    // "auto body shop near me" -> a page about "Auto Body Shop in Brampton": nobody titles a page "near me".
    const topic = kw.replace(/\bnear me\b/g, " ").replace(city ? new RegExp(`\\b${escapeRe(city)}\\b`, "i") : /$^/, " ").replace(/\s+/g, " ").trim() || service;
    const Page = `${title(topic)}${where}`;
    out.push({
      kind: "new_page",
      title: `Add a "${Page}" page`,
      why: `About ${n(pageKw.monthlySearches)} searches a month for "${kw}"${pageKw.position ? `, and you're #${pageKw.position}` : " and you don't show up"}. A page built for exactly this is the most reliable way onto page 1.`,
      content: [
        `Page address: /${Page.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}`,
        `Page title (under 60 characters): ${clip(`${Page} | ${name}`, 60)}`,
        `Main heading: ${Page}`,
        "",
        "Sections:",
        `1. What we do: 2–3 sentences on ${topic} at ${name}, in plain words.`,
        "2. Photos of 3 real jobs, with one line each.",
        "3. How it works, with typical timing.",
        "4. Why us: [certifications, warranty, years in business].",
        "5. 2–3 short quotes from real Google reviews (with the customer's first name).",
        `6. Questions people ask before buying: "How long does it take?", "How much does it cost?", "Do I need an appointment?"`,
        "7. Call button and quote form at the top and bottom.",
      ].join("\n"),
      keyword: kw,
    });
  }

  // 5. Only when there's little else to do: keep the profile active.
  if (out.length < 3 && l) {
    out.push({
      kind: "gbp_post",
      title: "Post one real job to your Google Business Profile each week",
      why: l.mapRank !== null && l.mapRank <= 3
        ? `You're already #${l.mapRank} in Google Maps. A weekly post keeps your profile active and gives searchers a reason to pick you over the next listing.`
        : "A weekly post keeps your profile active and gives searchers a reason to pick you over the next listing.",
      content: `This week's job: [what came in] → [what we did], done in [X] days. Need ${service}${where}? Call us or book a free estimate.\n\n(Add 1–2 photos and the "Call" button. Repeat weekly with a different job.)`,
      keyword: null,
    });
  }

  return out.slice(0, 7);
}

/** Everything the plan is based on, read under the org's row-level security. */
export async function loadPlanInput(tx: Tx, orgId: string): Promise<{ input: PlanInput } | null> {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  const [latest] = await tx
    .select({ result: orgAssessments.resultJson })
    .from(orgAssessments)
    .where(eq(orgAssessments.orgId, orgId))
    .orderBy(desc(orgAssessments.createdAt))
    .limit(1);
  const a = (latest?.result as AssessmentResult | undefined) ?? null;

  const [main] = await tx
    .select({ id: trackedSearches.id, keyword: trackedSearches.keyword })
    .from(trackedSearches)
    .where(and(eq(trackedSearches.orgId, orgId), eq(trackedSearches.active, true)))
    .orderBy(trackedSearches.createdAt)
    .limit(1);
  const [check] = main
    ? await tx.select().from(rankChecks).where(eq(rankChecks.trackedSearchId, main.id)).orderBy(desc(rankChecks.day)).limit(1)
    : [];

  const city = cityFrom(org.serviceArea ?? "");
  const profile = { category: org.category ?? "", city, brand: org.name };
  const fits = (k: string, alreadyRanks: boolean) => !org.category || judgeSearch(k, profile, { alreadyRanks }).topic !== null;

  const keywords = new Map<string, PlanInput["keywords"][number]>();
  for (const k of a?.rescueTargets ?? []) if (fits(k.keyword, true)) keywords.set(k.keyword, { keyword: k.keyword, monthlySearches: k.monthlySearches, cpcUsd: k.cpcUsd, position: k.position });
  for (const k of a?.topKeywords ?? []) if (!keywords.has(k.keyword) && fits(k.keyword, false)) keywords.set(k.keyword, { keyword: k.keyword, monthlySearches: k.monthlySearches, cpcUsd: k.cpcUsd, position: null });
  // The weekly site check: searches the site already ranks for.
  const snap = (await loadSnapshots(tx, orgId)).at(-1) ?? null;
  for (const k of snap?.data.keywords ?? []) {
    if (!keywords.has(k.keyword) && fits(k.keyword, true)) keywords.set(k.keyword, { keyword: k.keyword, monthlySearches: k.searches, cpcUsd: k.cpcUsd, position: k.position });
  }
  if (main && check && keywords.has(main.keyword)) keywords.get(main.keyword)!.position = check.organicRank;

  const pages = snap?.data.audit?.pages ?? [];
  const home = pages.find((p) => isHomepage(p.url)) ?? pages[0] ?? null;
  const site: SiteEvidence | null = home
    ? {
        broken: home.failed.includes("is_broken") || (home.status ?? 200) >= 400 || (home.title == null && home.h1 == null && home.score === null),
        status: home.status ?? null,
        homepage: { url: home.url, title: home.title ?? null, h1: home.h1 ?? null },
        missingDescription: pages.filter((p) => p.failed.includes("no_description")).map((p) => p.url),
        notTheirs: !looksLikeTheirs(org.name, org.websiteDomain, { title: home.title ?? null, h1: home.h1 ?? null }),
      }
    : null;

  return {
    input: {
      business: { name: org.name.replace(/\s*\(Demo\)$/, ""), category: org.category ?? "local business", city, website: org.websiteDomain, goals: org.goals ?? [] },
      mainSearch: main?.keyword ?? null,
      local: check
        ? { mapRank: check.mapRank, reviews: check.reviews, rating: check.rating, leaderAvgReviews: check.leaderAvgReviews, leaderAvgRating: check.leaderAvgRating }
        : a?.local
          ? { mapRank: a.local.yourRank, reviews: a.local.you?.reviews ?? null, rating: a.local.you?.rating ?? null, leaderAvgReviews: a.local.leaderAvgReviews, leaderAvgRating: a.local.leaderAvgRating }
          : null,
      site,
      keywords: [...keywords.values()].sort((x, y) => y.monthlySearches * y.cpcUsd - x.monthlySearches * x.cpcUsd).slice(0, 15),
    },
  };
}

/**
 * Build a fresh plan. Open items are replaced; done and dismissed items are
 * kept, and suggestions matching them aren't repeated. Network calls happen
 * outside database transactions.
 */
export async function refreshPlan(
  orgId: string,
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
): Promise<{ count: number; source: "rules" }> {
  const loaded = await run((tx) => loadPlanInput(tx, orgId));
  if (!loaded) return { count: 0, source: "rules" };
  const drafts = rulePlan(loaded.input);
  const source = "rules" as const;

  return run(async (tx) => {
    const kept = await tx
      .select({ title: actionItems.title })
      .from(actionItems)
      .where(and(eq(actionItems.orgId, orgId), inArray(actionItems.status, ["done", "dismissed"])));
    const seen = new Set(kept.map((k) => k.title.toLowerCase()));
    await tx.delete(actionItems).where(and(eq(actionItems.orgId, orgId), eq(actionItems.status, "open")));
    const fresh = drafts.filter((d) => !seen.has(d.title.toLowerCase()));
    if (fresh.length) {
      await tx.insert(actionItems).values(
        fresh.map((d) => ({ orgId, ...d, valueUsdMonth: estimatedValue(loaded.input, d.keyword), source })),
      );
    }
    return { count: fresh.length, source };
  });
}

export type ActionItem = typeof actionItems.$inferSelect;

/** Open items first, highest estimated value first; then the rest by date. */
export async function listActions(tx: Tx, orgId: string): Promise<{ open: ActionItem[]; done: ActionItem[] }> {
  const rows = await tx.select().from(actionItems).where(eq(actionItems.orgId, orgId)).orderBy(desc(actionItems.createdAt));
  const order: ActionKind[] = ["site_fix", "review_request", "review_reply", "gbp_profile", "page_title", "new_page", "gbp_post"];
  const open = rows
    .filter((r) => r.status === "open")
    .sort((a, b) => (b.valueUsdMonth ?? -1) - (a.valueUsdMonth ?? -1) || order.indexOf(a.kind) - order.indexOf(b.kind));
  const done = rows.filter((r) => r.status === "done").sort((a, b) => (b.doneAt?.getTime() ?? 0) - (a.doneAt?.getTime() ?? 0));
  return { open, done };
}

/** "I did this": mark done and log it on the Progress timeline so its effect is measured. */
export async function markActionDone(tx: Tx, ctx: { orgId: string; userId: string }, id: string, now = new Date()): Promise<boolean> {
  const [item] = await tx
    .select()
    .from(actionItems)
    .where(and(eq(actionItems.id, id), eq(actionItems.orgId, ctx.orgId), eq(actionItems.status, "open")));
  if (!item) return false;
  const [change] = await tx
    .insert(siteChanges)
    .values({ orgId: ctx.orgId, createdByUserId: ctx.userId, title: item.title.slice(0, 120), note: null, madeOn: now.toISOString().slice(0, 10) })
    .returning({ id: siteChanges.id });
  await tx.update(actionItems).set({ status: "done", doneAt: now, changeId: change.id }).where(eq(actionItems.id, id));
  return true;
}

export async function dismissAction(tx: Tx, orgId: string, id: string): Promise<void> {
  await tx
    .update(actionItems)
    .set({ status: "dismissed" })
    .where(and(eq(actionItems.id, id), eq(actionItems.orgId, orgId), eq(actionItems.status, "open")));
}
