import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDigest, renderDigest, runWeeklyDigest, unsubscribe, unsubscribeUrl, verifyUnsubscribe } from "@/server/digest/digest";
import { getDb } from "@/server/db/client";
import { digestSends, users } from "@/server/db/schema";
import type { Email } from "@/server/email/send";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { seedBaseline } from "@/server/tracking/checks";
import { asOwner, createUser, hasDb } from "./helpers";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

describe.runIf(hasDb)("weekly email", () => {
  let owner: { id: string; email: string };
  let orgId: string;

  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "x".repeat(40));
    const [u] = await getDb().insert(users).values({ email: `owner-${uuidv7()}@acmecollision.ca` }).returning();
    owner = u;
    orgId = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acmecollision.ca" });
    await withOrg(owner.id, orgId, async (tx) => {
      await seedBaseline(tx, orgId, {
        keyword: "collision repair ottawa", country: "CA", day: day(-8), dataSource: "live",
        values: { mapRank: 7, organicRank: 12, rating: 4.4, reviews: 60, leaderAvgRating: 4.8, leaderAvgReviews: 400 },
      });
    });
    await asOwner((c) =>
      c.query(
        `INSERT INTO rank_checks (id, org_id, tracked_search_id, day, map_rank, organic_rank, rating, reviews, leader_avg_rating, leader_avg_reviews, source, data_source)
         SELECT gen_random_uuid(), org_id, id, $2::date, 4, 9, 4.5, 72, 4.8, 402, 'daily', 'live' FROM tracked_searches WHERE org_id = $1`,
        [orgId, day(0)],
      ),
    );
    await asOwner((c) =>
      c.query("INSERT INTO site_changes (id, org_id, title, made_on) VALUES (gen_random_uuid(), $1, 'Added a Kanata page', $2)", [orgId, day(-2)]),
    );
  });
  beforeEach(() => asOwner((c) => c.query("DELETE FROM digest_sends")));
  afterEach(() => asOwner((c) => c.query("UPDATE users SET weekly_digest = true WHERE id = $1", [owner.id])));

  it("summarizes the week from the org's own data", async () => {
    const d = await withOrg(owner.id, orgId, (tx) => buildDigest(tx, orgId));
    expect(d?.subject).toBe('Acme Collision: Google Maps #7 → #4 for "collision repair ottawa" this week');
    expect(d?.lines[0].text).toContain("Google Maps #7 → #4 (up 3)");
    expect(d?.lines.at(-1)?.text).toContain("+12 this week");
    expect(d?.changes).toEqual(["Added a Kanata page"]);
  });

  it("sends once per week to owners, never twice, and never to test addresses", async () => {
    const sent: Email[] = [];
    const send = async (e: Email) => void sent.push(e);
    const first = await runWeeklyDigest(send);
    const mine = sent.filter((e) => e.to === owner.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent.every((e) => !e.to.endsWith(".test"))).toBe(true);
    expect(first.sent).toBeGreaterThanOrEqual(1);
    await runWeeklyDigest(send);
    expect(sent.filter((e) => e.to === owner.email)).toHaveLength(1);
    const [row] = await withOrg(owner.id, orgId, (tx) => tx.select().from(digestSends).where(eq(digestSends.orgId, orgId)));
    expect(row.recipients).toBe(1);
  });

  it("respects opt-out and skips locked accounts", async () => {
    const sent: Email[] = [];
    await unsubscribe(owner.id);
    await runWeeklyDigest(async (e) => void sent.push(e));
    expect(sent.filter((e) => e.to === owner.email)).toHaveLength(0);
    await asOwner(async (c) => {
      await c.query("UPDATE users SET weekly_digest = true WHERE id = $1", [owner.id]);
      await c.query("UPDATE organizations SET plan_status = 'locked' WHERE id = $1", [orgId]);
      await c.query("DELETE FROM digest_sends");
    });
    await runWeeklyDigest(async (e) => void sent.push(e));
    expect(sent.filter((e) => e.to === owner.email)).toHaveLength(0);
    await asOwner((c) => c.query("UPDATE organizations SET plan_status = 'trialing' WHERE id = $1", [orgId]));
  });

  it("unsubscribe links are signed and can't be forged", async () => {
    const url = new URL(unsubscribeUrl(owner.id));
    const sig = url.searchParams.get("s")!;
    expect(verifyUnsubscribe(owner.id, sig)).toBe(true);
    expect(verifyUnsubscribe(owner.id, sig.replace(/.$/, sig.endsWith("A") ? "B" : "A"))).toBe(false);
    const other = await createUser("other");
    expect(verifyUnsubscribe(other.id, sig)).toBe(false);
    expect(verifyUnsubscribe("not-a-uuid", sig)).toBe(false);
  });

  it("escapes business data in the HTML email", () => {
    const { html } = renderDigest(
      { businessName: "<script>x</script>", subject: "s", lines: [{ label: "a", text: "<b>", good: null }], changes: ["<img src=x>"], next: null },
      { progress: "https://example.com/app", unsubscribe: "https://example.com/u" },
    );
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<img src=x>");
  });
});
