import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { generate, type GeminiTransport } from "@/server/ai/gemini";
import type { AssessmentResult } from "@/server/assessment/result";
import { cityFrom } from "@/server/assessment/result";
import { actionItems, orgAssessments, organizations, rankChecks, siteChanges, trackedSearches, type ActionKind } from "@/server/db/schema";
import type { Tx } from "@/server/db/tenant";

// The action plan (PRD Module 7/12): concrete, ready-to-paste changes,
// ranked by estimated value. Gemini writes them when available; built-in
// templates are the always-available fallback. Every item is plain text.

export type PlanInput = {
  business: { name: string; category: string; city: string; website: string | null; goals: string[] };
  local: { mapRank: number | null; reviews: number | null; rating: number | null; leaderAvgReviews: number | null; leaderAvgRating: number | null } | null;
  keywords: { keyword: string; monthlySearches: number; cpcUsd: number; position: number | null }[];
};

export type Draft = { kind: ActionKind; title: string; why: string; content: string; keyword: string | null };

export const KINDS = ["review_request", "review_reply", "gbp_profile", "gbp_post", "page_title", "new_page"] as const;

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

/** Deterministic plan from templates. Always produces something useful. */
export function rulePlan(input: PlanInput): Draft[] {
  const { name, category, city } = input.business;
  const cat = category.toLowerCase();
  const City = title(city);
  const out: Draft[] = [];
  const l = input.local;

  const gap = l && l.leaderAvgReviews !== null && l.reviews !== null ? l.leaderAvgReviews - l.reviews : null;
  out.push({
    kind: "review_request",
    title: "Text every customer a review request the day they pick up",
    why:
      gap !== null && gap > 0
        ? `You have ${l!.reviews} Google reviews; the top 3 in Google Maps average ${l!.leaderAvgReviews}. Reviews are one of the biggest factors in who shows first in Maps.`
        : "A steady flow of new reviews keeps you high in Google Maps.",
    content: `Hi [first name], thanks for choosing ${name}. If you're happy with the work, would you mind leaving us a quick Google review? It takes a minute and really helps a local business: [your Google review link]\n\n(Find your review link in your Google Business Profile under "Ask for reviews". Send it to every customer, not just happy ones, and never offer anything in exchange. Google's rules forbid both.)`,
    keyword: null,
  });

  out.push({
    kind: "gbp_profile",
    title: "Complete your Google Business Profile",
    why:
      l?.mapRank && l.mapRank > 3
        ? `You're #${l.mapRank} in Google Maps. A complete profile is one of the fastest ways to move toward the top 3, where most calls happen.`
        : "A complete profile helps Google show you for more searches in Maps.",
    content: [
      `Primary category: ${title(category)}`,
      `Services to add (one per line in "Services"):`,
      ...input.keywords.slice(0, 6).map((k) => `- ${title(k.keyword.replace(new RegExp(`\\s*${city}\\s*`, "i"), " ").trim())}`),
      "Hours: add holiday hours so Google never shows you as 'might be closed'.",
      "Photos: at least 10 (storefront, team, before/after of real jobs). Add 2 new photos a week.",
      "Description (750 characters max):",
      `${name} is a ${cat} business serving ${City} and the surrounding area. [Years in business], [certifications or insurance companies you work with], [what makes you different]. Call or book online for a free estimate.`,
    ].join("\n"),
    keyword: null,
  });

  const targets = input.keywords.filter((k) => k.position !== null && k.position > 3).sort((a, b) => b.monthlySearches * b.cpcUsd - a.monthlySearches * a.cpcUsd);
  const top = targets[0] ?? input.keywords[0];
  if (top) {
    const kw = top.keyword;
    out.push({
      kind: "page_title",
      title: `Rewrite the page title for "${kw}"`,
      why: top.position
        ? `You're #${top.position} on Google for "${kw}" (about ${top.monthlySearches.toLocaleString("en-US")} searches a month). A clear title that matches the search wins more clicks and helps you move up.`
        : `About ${top.monthlySearches.toLocaleString("en-US")} people a month search "${kw}". A clear title that matches the search helps you show up.`,
      content: `Page title (under 60 characters):\n${clip(`${title(kw)} | ${name}`, 60)}\n\nMeta description (under 155 characters):\n${clip(`Need ${cat} in ${City}? ${name} offers free estimates, works with all insurers and gets you back on the road fast. Call today.`, 155)}\n\n(Your website manager can change these in your site's SEO settings in about 10 minutes.)`,
      keyword: kw,
    });
  }

  const pageKw = targets.find((k) => k !== top && k.keyword.includes(" ")) ?? targets[1];
  if (pageKw) {
    const kw = pageKw.keyword;
    out.push({
      kind: "new_page",
      title: `Add a dedicated page for "${kw}"`,
      why: `About ${pageKw.monthlySearches.toLocaleString("en-US")} searches a month${pageKw.position ? `, and you're only #${pageKw.position}` : ""}. A page built for exactly this search is the most reliable way onto page 1.`,
      content: [
        `Page address: /${kw.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
        `Main heading: ${title(kw)}`,
        "",
        "Sections:",
        `1. What we do: 2–3 sentences on ${kw} at ${name}, in plain words.`,
        "2. Photos of 3 real jobs (before and after), with one line each.",
        "3. How it works: estimate → insurance → repair → pick-up, with typical timing.",
        "4. Why us: certifications, warranty, years in business, insurers you work with.",
        "5. Reviews: 2–3 short quotes from real Google reviews (with the customer's first name).",
        `6. FAQ: "How long does ${kw} take?", "Do you work with my insurance?", "Do I need an appointment?"`,
        "7. Call button and quote form at the top and bottom.",
      ].join("\n"),
      keyword: kw,
    });
  }

  out.push({
    kind: "gbp_post",
    title: "Post an update to your Google Business Profile this week",
    why: "Weekly posts keep your profile active and give searchers a reason to call you over the next listing.",
    content: `Before/after of the week 🚗 This [car] came in after a [rear-end collision]. ${name} handled the insurance claim and had it back to the owner in [X] days. Need ${cat} in ${City}? Call us or book a free estimate.\n\n(Add 1–2 photos and the "Call" button. Repeat weekly with a different job.)`,
    keyword: null,
  });

  out.push({
    kind: "review_reply",
    title: "Reply to every review, including old ones",
    why: "Replies show Google and customers you're active, and a calm reply to a bad review often wins the next customer.",
    content: `Positive review:\nThank you, [name]! We're glad your [car] is back to looking like new. We appreciate you choosing ${name}, and we're here if you ever need us again.\n\nNegative review:\nHi [name], thank you for the feedback, and I'm sorry we fell short. I'd like to make this right. Please call me directly at [phone] and ask for [owner's name]. – [owner's name], ${name}`,
    keyword: null,
  });

  return out;
}

const draftSchema = z.object({
  kind: z.enum(KINDS),
  title: z.string().trim().min(5).max(90),
  why: z.string().trim().min(10).max(300),
  content: z.string().trim().min(20).max(2500),
  keyword: z.string().trim().max(80).nullable().optional(),
});
const draftsSchema = z.array(draftSchema).min(4).max(8);

const SYSTEM = `You write a short action plan of concrete, ready-to-use changes for the owner of a small local business, to win more customers from Google searches and Google Maps.

Rules:
- Return 5 to 7 items as JSON matching the schema. Each item has a kind, a short title (what to do), a "why" (one or two sentences using only the numbers provided), and "content": the actual text to paste or the exact steps, written for this business.
- Kinds: review_request (message asking customers for a Google review), review_reply (reply templates), gbp_profile (Google Business Profile fields), gbp_post (a profile post), page_title (page title + meta description for a keyword), new_page (outline of a page for a keyword).
- For page_title and new_page, set "keyword" to one of the provided keywords exactly.
- Use only the numbers in "data". Never invent statistics, prices, years, certifications or claims. Use [square brackets] for details the owner must fill in.
- Never name or mention any other business. No links, no URLs, no HTML or markdown.
- Review requests must follow Google's rules: ask every customer, never offer anything in exchange, never ask only happy customers.
- Plain English, friendly, no hype.`;

const RESPONSE_SCHEMA = {
  type: "ARRAY",
  minItems: 4,
  maxItems: 8,
  items: {
    type: "OBJECT",
    properties: {
      kind: { type: "STRING", enum: [...KINDS] },
      title: { type: "STRING" },
      why: { type: "STRING" },
      content: { type: "STRING" },
      keyword: { type: "STRING", nullable: true },
    },
    required: ["kind", "title", "why", "content"],
  },
};

/** Same safety rules as findings: no links, markup, injected instructions or other businesses' names. */
export function draftViolatesRules(items: Draft[], otherBusinesses: string[]): boolean {
  const names = otherBusinesses.map((n) => n.toLowerCase().replace(/\(fictional\)/, "").trim()).filter((n) => n.length >= 4);
  return items.some((i) => {
    const text = `${i.title} ${i.why} ${i.content}`.toLowerCase();
    return (
      /https?:|www\.|<[a-z/]|\]\(/.test(text) ||
      /ignore (all |the )?(previous|prior|above)|system prompt|as an ai/.test(text) ||
      names.some((n) => text.includes(n))
    );
  });
}

export async function aiPlan(t: GeminiTransport, input: PlanInput, otherBusinesses: string[]): Promise<Draft[] | null> {
  const user = JSON.stringify({ data: input });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await generate(t, { system: SYSTEM, user, responseSchema: RESPONSE_SCHEMA, maxOutputTokens: 3000 });
      const parsed = draftsSchema.safeParse(JSON.parse(text));
      if (!parsed.success) continue;
      const items = parsed.data.map((d) => ({ ...d, keyword: d.keyword ?? null }));
      // Keywords must be ones we have data for; otherwise drop the keyword.
      const known = new Set(input.keywords.map((k) => k.keyword.toLowerCase()));
      for (const i of items) if (i.keyword && !known.has(i.keyword.toLowerCase())) i.keyword = null;
      if (!draftViolatesRules(items, otherBusinesses)) return items;
    } catch {
      // retry, then fall back to templates
    }
  }
  return null;
}

/** Everything the plan is based on, read under the org's row-level security. */
export async function loadPlanInput(tx: Tx, orgId: string): Promise<{ input: PlanInput; otherBusinesses: string[] } | null> {
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

  const keywords = new Map<string, PlanInput["keywords"][number]>();
  for (const k of a?.rescueTargets ?? []) keywords.set(k.keyword, { keyword: k.keyword, monthlySearches: k.monthlySearches, cpcUsd: k.cpcUsd, position: k.position });
  for (const k of a?.topKeywords ?? []) if (!keywords.has(k.keyword)) keywords.set(k.keyword, { keyword: k.keyword, monthlySearches: k.monthlySearches, cpcUsd: k.cpcUsd, position: null });
  if (main && check && keywords.has(main.keyword)) keywords.get(main.keyword)!.position = check.organicRank;

  return {
    input: {
      business: {
        name: org.name.replace(/\s*\(Demo\)$/, ""),
        category: org.category ?? "local business",
        city: cityFrom(org.serviceArea ?? ""),
        website: org.websiteDomain,
        goals: org.goals ?? [],
      },
      local: check
        ? { mapRank: check.mapRank, reviews: check.reviews, rating: check.rating, leaderAvgReviews: check.leaderAvgReviews, leaderAvgRating: check.leaderAvgRating }
        : a?.local
          ? { mapRank: a.local.yourRank, reviews: a.local.you?.reviews ?? null, rating: a.local.you?.rating ?? null, leaderAvgReviews: a.local.leaderAvgReviews, leaderAvgRating: a.local.leaderAvgRating }
          : null,
      keywords: [...keywords.values()].slice(0, 15),
    },
    otherBusinesses: [...(a?.local?.leaders.map((l) => l.name) ?? []), ...(a?.competitors.map((c) => c.domain) ?? [])],
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
  gemini: GeminiTransport | null,
): Promise<{ count: number; source: "ai" | "rules" }> {
  const loaded = await run((tx) => loadPlanInput(tx, orgId));
  if (!loaded) return { count: 0, source: "rules" };
  const ai = gemini ? await aiPlan(gemini, loaded.input, loaded.otherBusinesses) : null;
  const drafts = ai ?? rulePlan(loaded.input);
  const source: "ai" | "rules" = ai ? "ai" : "rules";

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
  const order: ActionKind[] = ["review_request", "gbp_profile", "page_title", "new_page", "gbp_post", "review_reply"];
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
