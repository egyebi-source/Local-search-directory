import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createCampaign,
  emailMatchesDomain,
  listCampaigns,
  lookupClaim,
  markClaimed,
  optOut,
  reissueLinks,
} from "@/server/campaigns/campaigns";
import { analyzeProspect, emailDraft, loadProspect, markContacted, newClaimLink, pitchOpener } from "@/server/campaigns/outreach";
import { campaigns, prospects } from "@/server/db/schema";
import { createOrganization, withUser } from "@/server/db/tenant";
import { fakeDataForSeo } from "../fixtures/dataforseo";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

const tokenOf = (url: string) => url.split("/claim/")[1];

describe("claim ownership check", () => {
  it("needs an email at the business's own domain", () => {
    expect(emailMatchesDomain("owner@acmecollision.ca", "acmecollision.ca")).toBe(true);
    expect(emailMatchesDomain("Owner@Mail.AcmeCollision.ca", "acmecollision.ca")).toBe(true);
    expect(emailMatchesDomain("owner@gmail.com", "acmecollision.ca")).toBe(false);
    expect(emailMatchesDomain("owner@notacmecollision.ca", "acmecollision.ca")).toBe(false);
    expect(emailMatchesDomain("acmecollision.ca@evil.com", "acmecollision.ca")).toBe(false);
    expect(emailMatchesDomain("a@b@acmecollision.ca", "acmecollision.ca")).toBe(false);
  });
});

describe.runIf(hasDb)("claim campaigns", () => {
  let admin: { id: string };
  let customer: { id: string };
  const deps = () => ({ dataforseo: fakeDataForSeo().transport, dataSource: "live" as const });
  const input = { category: "Collision repair", city: "Ottawa", country: "CA" as const };

  beforeAll(async () => {
    admin = await createUser("campaign-admin");
    customer = await createUser("campaign-customer");
    await asOwner((c) => c.query("INSERT INTO platform_admins (user_id) VALUES ($1)", [admin.id]));
  });
  beforeEach(() => asOwner((c) => c.query("TRUNCATE campaigns, prospects, prospect_suppressions, api_spend_daily CASCADE")));

  it("one lookup prepares a report and link for each business with a website", async () => {
    const d = fakeDataForSeo();
    const { links } = await createCampaign(admin.id, input, { dataforseo: d.transport, dataSource: "live" });
    expect(d.calls).toHaveLength(2); // Maps + regular results, for the whole city
    expect(links.map((l) => l.domain)).toEqual(["rivalautobody.ca", "capitalcollision.ca", "fastfixcollision.com", "acmecollision.ca"]);
    const acme = await lookupClaim(tokenOf(links[3].url));
    expect(acme).toMatchObject({ businessName: "Acme Collision", domain: "acmecollision.ca", keyword: "collision repair ottawa", city: "Ottawa" });
    expect(acme?.report).toMatchObject({ mapRank: 6, reviews: 85, leaderAvgReviews: 400, organicRank: 7 });
    // The report carries numbers only, never other businesses' names.
    expect(JSON.stringify(acme)).not.toMatch(/Rival|Capital|Fast Fix/);
  });

  it("only admins can see campaigns; customers and anonymous requests see nothing", async () => {
    await createCampaign(admin.id, input, deps());
    expect(await listCampaigns(admin.id)).toHaveLength(1);
    const asCustomer = await withUser(customer.id, async (tx) => ({
      c: await tx.select().from(campaigns),
      p: await tx.select().from(prospects),
    }));
    expect(asCustomer).toEqual({ c: [], p: [] });
    await expectDbError(
      withUser(customer.id, (tx) => tx.insert(campaigns).values({ name: "x", category: "x", city: "x", country: "CA", keyword: "x", dataSource: "live" })),
      /row-level security/,
    );
  });

  it("links can't be guessed and the first open is recorded", async () => {
    const { links } = await createCampaign(admin.id, input, deps());
    expect(await lookupClaim("A".repeat(43))).toBeNull();
    expect(await lookupClaim("../../etc")).toBeNull();
    expect((await lookupClaim(tokenOf(links[0].url)))?.status).toBe("opened");
    const rows = await asOwner(async (c) => (await c.query("SELECT token_hash FROM prospects")).rows);
    expect(rows.map((r) => r.token_hash)).not.toContain(tokenOf(links[0].url)); // only hashes stored
  });

  it("expired links stop working", async () => {
    const { links } = await createCampaign(admin.id, input, deps());
    await asOwner((c) => c.query("UPDATE prospects SET expires_at = now() - interval '1 minute'"));
    expect(await lookupClaim(tokenOf(links[0].url))).toBeNull();
  });

  it("re-issuing links invalidates the old ones", async () => {
    const { campaignId, links } = await createCampaign(admin.id, input, deps());
    const fresh = await reissueLinks(admin.id, campaignId);
    expect(fresh).toHaveLength(4);
    expect(await lookupClaim(tokenOf(links[0].url))).toBeNull();
    expect(await lookupClaim(tokenOf(fresh[0].url))).not.toBeNull();
  });

  it("'not interested' deletes the report and the business is skipped next time", async () => {
    const { links } = await createCampaign(admin.id, input, deps());
    const acme = links.find((l) => l.domain === "acmecollision.ca")!;
    expect(await optOut(tokenOf(acme.url), "acmecollision.ca")).toBe(true);
    expect(await lookupClaim(tokenOf(acme.url))).toBeNull();
    const again = await createCampaign(admin.id, input, deps());
    expect(again.links.map((l) => l.domain)).not.toContain("acmecollision.ca");
    const stored = await asOwner(async (c) => (await c.query("SELECT domain_hash FROM prospect_suppressions")).rows);
    expect(JSON.stringify(stored)).not.toContain("acmecollision");
  });

  it("a business is claimed once, and the app can't edit reports or statuses directly", async () => {
    const { links } = await createCampaign(admin.id, input, deps());
    const t = tokenOf(links[3].url);
    const orgId = await createOrganization(customer.id, { name: "Acme Collision", websiteDomain: "acmecollision.ca" });
    expect(await markClaimed(t, orgId)).toBe(true);
    expect(await markClaimed(t, orgId)).toBe(false);
    expect((await lookupClaim(t))?.status).toBe("claimed");
    expect(await optOut(t, "acmecollision.ca")).toBe(false); // claimed businesses can't be deleted this way
    await expectDbError(
      withUser(admin.id, (tx) => tx.update(prospects).set({ status: "claimed" })),
      /permission denied/,
    );
    await expectDbError(withUser(admin.id, (tx) => tx.execute(sql`UPDATE prospects SET report = '{}'::jsonb`)), /permission denied/);
  });
});

describe.runIf(hasDb)("selling to a campaign's businesses", () => {
  let admin: { id: string };
  let customer: { id: string };
  beforeAll(async () => {
    admin = await createUser("outreach-admin");
    customer = await createUser("outreach-customer");
    await asOwner((c) => c.query("INSERT INTO platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING", [admin.id]));
  });
  beforeEach(() => asOwner((c) => c.query("TRUNCATE campaigns, prospects, prospect_suppressions, api_spend_daily CASCADE")));

  it("the deeper check finds contacts and top fixes; the owner's report shows the fixes but never the contacts", async () => {
    const d = fakeDataForSeo();
    await createCampaign(admin.id, { category: "Collision repair", city: "Ottawa", country: "CA" }, { dataforseo: d.transport, dataSource: "live" });
    const [acme] = await withUser(admin.id, (tx) => tx.select().from(prospects).where(sql`domain = 'acmecollision.ca'`));
    const p = await analyzeProspect(admin.id, acme.id, {
      dataforseo: d.transport,
      findEmail: async () => ({ email: "info@acmecollision.ca", source: "https://acmecollision.ca/contact" }),
    });
    expect(p?.email).toBe("info@acmecollision.ca");
    expect(p?.analysis?.fixes.length).toBeGreaterThan(0);
    expect(p?.analysis?.fixes.some((f) => /reviews?/i.test(f.title))).toBe(true); // 85 vs 400 reviews

    const link = await newClaimLink(admin.id, acme.id);
    const view = await lookupClaim(tokenOf(link!));
    expect(view?.fixes).toEqual(p?.analysis?.fixes);
    expect(JSON.stringify(view)).not.toContain("info@acmecollision.ca");

    const draft = emailDraft(p!, link!);
    expect(draft.body).toContain(link!);
    expect(draft.body).toContain("[Your mailing address]"); // CASL: sender must add it
    expect(draft.body).toMatch(/reply "remove"/);
    expect(pitchOpener(p!)).toContain("#6 on Google Maps");

    await markContacted(admin.id, acme.id, "phone");
    expect((await loadProspect(admin.id, acme.id))?.contactChannel).toBe("phone");
  });

  it("customers can't read or change any of it", async () => {
    await createCampaign(admin.id, { category: "Collision repair", city: "Ottawa", country: "CA" }, { dataforseo: fakeDataForSeo().transport, dataSource: "live" });
    expect(await withUser(customer.id, (tx) => tx.select().from(prospects))).toEqual([]);
    const r = await withUser(customer.id, (tx) => tx.update(prospects).set({ email: "x@y.z" }).returning({ id: prospects.id }));
    expect(r).toEqual([]); // row-level security: nothing visible, nothing changed
    expect(await loadProspect(customer.id, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
