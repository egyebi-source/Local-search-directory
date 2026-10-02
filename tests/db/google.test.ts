import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ga4Daily, googleConnections, gscDaily, gscQueryDaily, linkedProperties, syncRuns } from "@/server/db/schema";
import { createOrganization, withOrg, withSystemOrg } from "@/server/db/tenant";
import { authorizationUrl, GA4_SCOPE, GoogleApiError, GSC_SCOPE, type GoogleRequest, type GoogleTransport } from "@/server/google/client";
import {
  beginConnect,
  checkState,
  completeConnect,
  disconnect,
  GoogleForbiddenError,
  listChoices,
  loadConnection,
  NoScopesError,
  saveProperties,
} from "@/server/google/connection";
import { almostThere, loadGoogleData } from "@/server/google/metrics";
import { syncOrg } from "@/server/google/sync";
import { sealCookie } from "@/server/google/tokens";
import { asAppUserRaw, asOwner, createUser, hasDb } from "./helpers";

const cfg = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "test-secret", redirectUri: "https://app.test/api/google/callback" };
const NOW = new Date("2026-10-02T12:00:00Z");
const days = (start: string, end: string) => {
  const out: string[] = [];
  for (let d = Date.parse(`${start}T00:00:00Z`); d <= Date.parse(`${end}T00:00:00Z`); d += 86_400_000) out.push(new Date(d).toISOString().slice(0, 10));
  return out;
};

/** A pretend Google that records every request. */
function fakeGoogle() {
  const calls: GoogleRequest[] = [];
  const state = { revoked: false, revokedTokens: [] as string[] };
  const t: GoogleTransport = async (req) => {
    calls.push(req);
    const { url } = req;
    if (url === "https://oauth2.googleapis.com/token") {
      const f = req.form!;
      if (f.grant_type === "authorization_code") {
        if (f.code_verifier?.length !== 43) return { status: 400, body: { error: "invalid_grant" } };
        if (f.code === "none") return { status: 200, body: { access_token: "at-1", refresh_token: "rt-x", scope: "openid" } };
        const scope = f.code === "gsc-only" ? GSC_SCOPE : `${GSC_SCOPE} ${GA4_SCOPE} openid`;
        return { status: 200, body: { access_token: "at-1", refresh_token: `rt-secret-${f.code}`, scope } };
      }
      if (state.revoked) return { status: 400, body: { error: "invalid_grant" } };
      return { status: 200, body: { access_token: "at-fresh", scope: GSC_SCOPE } };
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      state.revokedTokens.push(req.form!.token);
      return { status: 200, body: {} };
    }
    if (url === "https://www.googleapis.com/webmasters/v3/sites")
      return {
        status: 200,
        body: { siteEntry: [{ siteUrl: "sc-domain:acme.test", permissionLevel: "siteOwner" }, { siteUrl: "https://notmine.test/", permissionLevel: "siteUnverifiedUser" }] },
      };
    if (url.startsWith("https://analyticsadmin.googleapis.com/v1beta/accountSummaries"))
      return { status: 200, body: { accountSummaries: [{ displayName: "Acme", propertySummaries: [{ property: "properties/123", displayName: "Acme website" }] }] } };
    if (url.includes("/searchAnalytics/query")) {
      const b = req.json as { startDate: string; endDate: string; dimensions: string[] };
      const ds = days(b.startDate, b.endDate);
      if (b.dimensions.length === 1) return { status: 200, body: { rows: ds.map((d) => ({ keys: [d], clicks: 10, impressions: 200, ctr: 0.05, position: 8.5 })) } };
      return {
        status: 200,
        body: {
          rows: ds.flatMap((d) => [
            { keys: [d, "collision repair ottawa"], clicks: 3, impressions: 40, ctr: 0.075, position: 6 },
            { keys: [d, "acme collision"], clicks: 5, impressions: 6, ctr: 0.8, position: 1 },
          ]),
        },
      };
    }
    if (url.endsWith(":runReport")) {
      const b = req.json as { dateRanges: { startDate: string; endDate: string }[] };
      const ds = days(b.dateRanges[0].startDate, b.dateRanges[0].endDate);
      return {
        status: 200,
        body: {
          rows: ds.flatMap((d) => [
            { dimensionValues: [{ value: d.replaceAll("-", "") }, { value: "Organic Search" }], metricValues: [{ value: "12" }, { value: "10" }, { value: "2" }] },
            { dimensionValues: [{ value: d.replaceAll("-", "") }, { value: "Direct" }], metricValues: [{ value: "5" }, { value: "5" }, { value: "0" }] },
          ]),
        },
      };
    }
    return { status: 404, body: null };
  };
  return { t, calls, state };
}

describe("Google consent screen", () => {
  it("asks only for the two read-only scopes, offline, with PKCE and a state value", () => {
    const u = new URL(authorizationUrl(cfg, { state: "s".repeat(43), codeChallenge: "c".repeat(43) }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")!.split(" ").sort()).toEqual([GA4_SCOPE, GSC_SCOPE].sort());
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe("s".repeat(43));
  });
  it("quickest wins are searches seen often just off the top 3", () => {
    const r = (query: string, impressions: number, position: number) => ({ query, clicks: 1, impressions, ctr: 1, position });
    expect(almostThere([r("a", 500, 2), r("b", 300, 7), r("c", 10, 6), r("d", 900, 14), r("e", 400, 35)]).map((x) => x.query)).toEqual(["d", "b"]);
  });
});

describe.runIf(hasDb)("Google data connection (PRD Modules 3-5)", () => {
  let owner: { id: string };
  let member: { id: string };
  let other: { id: string };
  let org: string;
  let otherOrg: string;
  const g = fakeGoogle();

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
    [owner, member, other] = await Promise.all(["gowner", "gmember", "gother"].map(createUser));
    org = await createOrganization(owner.id, { name: "Acme Collision", websiteDomain: "acme.test" });
    otherOrg = await createOrganization(other.id, { name: "Other Shop" });
    await asOwner((c) => c.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'member')", [org, member.id]));
  });
  afterAll(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it("only an owner can start connecting; the state cookie works once, for that user, until it expires", async () => {
    await expect(withOrg(member.id, org, async (_tx, ctx) => beginConnect(ctx))).rejects.toBeInstanceOf(GoogleForbiddenError);
    const s = await withOrg(owner.id, org, async (_tx, ctx) => beginConnect(ctx));
    expect(checkState(s.cookie, s.state, owner.id)).toMatchObject({ orgId: org });
    expect(checkState(s.cookie, "x".repeat(43), owner.id)).toBeNull();
    expect(checkState(s.cookie, s.state, member.id)).toBeNull();
    expect(checkState(undefined, s.state, owner.id)).toBeNull();
    const expired = sealCookie({ state: s.state, verifier: "v".repeat(43), orgId: org, userId: owner.id, exp: Date.now() - 1 });
    expect(checkState(expired, s.state, owner.id)).toBeNull();
  });

  it("connecting stores only the encrypted refresh token, and only the scopes we asked for", async () => {
    const r = await withOrg(owner.id, org, (tx, ctx) => completeConnect(tx, ctx, g.t, cfg, "good", "v".repeat(43)));
    expect(r.scopes.sort()).toEqual([GA4_SCOPE, GSC_SCOPE].sort());
    const raw = await asOwner((c) => c.query("SELECT * FROM google_connections WHERE org_id = $1", [org]));
    expect(JSON.stringify(raw.rows[0])).not.toContain("rt-secret");
    expect(JSON.stringify(raw.rows[0])).not.toContain("at-1");
    expect(raw.rows[0].granted_scopes.sort()).toEqual([GA4_SCOPE, GSC_SCOPE].sort());
    const view = await withOrg(member.id, org, (tx) => loadConnection(tx, org));
    expect(view).toMatchObject({ status: "active", scopes: { searchConsole: true, analytics: true }, gsc: null, ga4: null });
    expect(Object.keys(view!).join(",")).not.toMatch(/token|cipher|iv|tag/i);
  });

  it("refuses a connection where none of our scopes were granted", async () => {
    await expect(withOrg(other.id, otherOrg, (tx, ctx) => completeConnect(tx, ctx, g.t, cfg, "none", "v".repeat(43)))).rejects.toBeInstanceOf(NoScopesError);
  });

  it("lists only verified sites, and saves only picks Google says this account can see", async () => {
    const choices = await withOrg(owner.id, org, (tx) => listChoices(tx, org, g.t, cfg));
    expect(choices!.sites).toEqual([{ siteUrl: "sc-domain:acme.test" }]);
    expect(choices!.properties).toEqual([{ property: "properties/123", displayName: "Acme website", account: "Acme" }]);
    await expect(
      withOrg(owner.id, org, (tx, ctx) => saveProperties(tx, ctx, g.t, cfg, { gsc: "https://notmine.test/", ga4: null })),
    ).rejects.toBeInstanceOf(GoogleApiError);
    await expect(withOrg(member.id, org, (tx, ctx) => saveProperties(tx, ctx, g.t, cfg, { gsc: "sc-domain:acme.test", ga4: null }))).rejects.toBeInstanceOf(
      GoogleForbiddenError,
    );
    await withOrg(owner.id, org, (tx, ctx) => saveProperties(tx, ctx, g.t, cfg, { gsc: "sc-domain:acme.test", ga4: "properties/123" }));
    const view = await withOrg(owner.id, org, (tx) => loadConnection(tx, org));
    expect(view).toMatchObject({ gsc: { displayName: "acme.test" }, ga4: { displayName: "Acme website" } });
  });

  it("the daily job claims an org once (a lease stops double syncing)", async () => {
    const claim = () => asAppUserRaw(async (c) => (await c.query("SELECT google_claim_orgs_for_sync(50) AS id")).rows.map((r) => r.id));
    expect(await claim()).toContain(org);
    expect(await claim()).not.toContain(org);
    await asOwner((c) => c.query("UPDATE google_connections SET sync_started_at = NULL WHERE org_id = $1", [org]));
  });

  it("the first sync fetches 16 months of Search Console, 28 days of searches and 90 days of GA4", async () => {
    g.calls.length = 0;
    const r = await syncOrg(org, { google: g.t, config: cfg, now: NOW });
    expect(r.status).toBe("ok");
    const gscCalls = g.calls.filter((c) => c.url.includes("searchAnalytics")).map((c) => c.json as { startDate: string; endDate: string; dimensions: string[] });
    expect(gscCalls.map((c) => [c.dimensions.join("+"), c.startDate, c.endDate])).toEqual([
      ["date", "2025-06-03", "2026-10-01"],
      ["date+query", "2026-09-04", "2026-10-01"],
    ]);
    expect(g.calls.every((c) => !c.url.includes("searchAnalytics") || c.accessToken === "at-fresh")).toBe(true);
    const data = await withSystemOrg(org, async (tx) => ({
      days: (await tx.select().from(gscDaily)).length,
      queries: (await tx.select().from(gscQueryDaily)).length,
      ga4: (await tx.select().from(ga4Daily)).length,
      runs: await tx.select().from(syncRuns),
    }));
    expect(data.days).toBe(486);
    expect(data.queries).toBe(28 * 2);
    expect(data.ga4).toBe(90 * 2);
    expect(data.runs.map((x) => [x.source, x.status]).sort()).toEqual([["ga4", "ok"], ["gsc", "ok"]]);
  });

  it("later syncs re-fetch the last 10 days and update in place", async () => {
    g.calls.length = 0;
    await syncOrg(org, { google: g.t, config: cfg, now: NOW });
    const starts = g.calls.filter((c) => c.url.includes("searchAnalytics")).map((c) => (c.json as { startDate: string }).startDate);
    expect(starts).toEqual(["2026-09-22", "2026-09-22"]);
    const n = await withSystemOrg(org, async (tx) => (await tx.select().from(gscDaily)).length);
    expect(n).toBe(486);
  });

  it("the dashboard shows the last 28 days against the 28 before", async () => {
    const d = await withOrg(member.id, org, (tx) => loadGoogleData(tx, org, NOW));
    expect(d.gsc).toMatchObject({ through: "2026-10-01", clicks: 280, impressions: 5600, ctr: 5, position: 8.5, clicksChange: 0 });
    expect(d.gsc!.topQueries[0]).toMatchObject({ query: "acme collision", clicks: 140 });
    expect(d.gsc!.almostThere.map((q) => q.query)).toEqual(["collision repair ottawa"]);
    expect(d.ga4).toMatchObject({ sessions: 28 * 17, organicSessions: 28 * 12, keyEvents: 56 });
  });

  it("another organization sees none of it, and nothing is visible without an org", async () => {
    await withOrg(other.id, otherOrg, async (tx) => {
      for (const table of [googleConnections, linkedProperties, gscDaily, gscQueryDaily, ga4Daily, syncRuns]) expect(await tx.select().from(table)).toEqual([]);
      expect(await tx.select().from(gscDaily).where(eq(gscDaily.orgId, org))).toEqual([]);
    });
    await asAppUserRaw(async (c) => {
      expect((await c.query("SELECT count(*)::int AS n FROM google_connections")).rows[0].n).toBe(0);
      expect((await c.query("SELECT count(*)::int AS n FROM gsc_daily")).rows[0].n).toBe(0);
    });
  });

  it("when Google refuses the token, the connection asks for a reconnect and stops syncing", async () => {
    g.state.revoked = true;
    const r = await syncOrg(org, { google: g.t, config: cfg, now: NOW });
    expect(r.status).toBe("needs_reauth");
    expect((await withOrg(owner.id, org, (tx) => loadConnection(tx, org)))!.status).toBe("needs_reauth");
    const claimed = await asAppUserRaw(async (c) => (await c.query("SELECT google_claim_orgs_for_sync(50) AS id")).rows.map((x) => x.id));
    expect(claimed).not.toContain(org);
    g.state.revoked = false;
  });

  it("disconnecting revokes at Google, deletes the stored token, and can keep or delete the numbers", async () => {
    await expect(withOrg(member.id, org, (tx, ctx) => disconnect(tx, ctx, g.t, false))).rejects.toBeInstanceOf(GoogleForbiddenError);
    const r = await withOrg(owner.id, org, (tx, ctx) => disconnect(tx, ctx, g.t, false));
    expect(r.revoked).toBe(true);
    expect(g.state.revokedTokens).toContain("rt-secret-good");
    const left = await asOwner(async (c) => ({
      conn: (await c.query("SELECT count(*)::int AS n FROM google_connections WHERE org_id = $1", [org])).rows[0].n,
      data: (await c.query("SELECT count(*)::int AS n FROM gsc_daily WHERE org_id = $1", [org])).rows[0].n,
    }));
    expect(left).toEqual({ conn: 0, data: 486 });

    await withOrg(owner.id, org, (tx, ctx) => completeConnect(tx, ctx, g.t, cfg, "again", "v".repeat(43)));
    await withOrg(owner.id, org, (tx, ctx) => disconnect(tx, ctx, g.t, true));
    const data = await asOwner(async (c) => (await c.query("SELECT count(*)::int AS n FROM gsc_daily WHERE org_id = $1", [org])).rows[0].n);
    expect(data).toBe(0);
  });
});
