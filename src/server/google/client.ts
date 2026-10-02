import "server-only";
import { z } from "zod";
import { serverEnv } from "@/server/env";

// Google OAuth + Search Console + GA4 calls (PRD Modules 3-4). Read-only:
// the only scopes ever requested are the two below (PRD §6.3; adding one
// needs the owner's approval). Tokens are passed in, never logged, and no
// error message here ever includes a token or Google's raw response.

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const DATA_SCOPES = [GSC_SCOPE, GA4_SCOPE] as const;

export type GoogleRequest = { url: string; method: "GET" | "POST"; accessToken?: string; json?: unknown; form?: Record<string, string> };
export type GoogleResponse = { status: number; body: unknown };
/** How we talk to Google; tests pass a fake. */
export type GoogleTransport = (req: GoogleRequest) => Promise<GoogleResponse>;

export const httpGoogle: GoogleTransport = async (req) => {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (req.accessToken) headers.Authorization = `Bearer ${req.accessToken}`;
  let body: string | undefined;
  if (req.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(req.form).toString();
  } else if (req.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(req.json);
  }
  const res = await fetch(req.url, { method: req.method, headers, body, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed };
};

export type GoogleConfig = { clientId: string; clientSecret: string; redirectUri: string };

/** Null until the owner has set up the Google Cloud project (GOOGLE_DATA_* + TOKEN_ENCRYPTION_KEY). */
export function googleConfig(): GoogleConfig | null {
  const env = serverEnv();
  if (!env.GOOGLE_DATA_CLIENT_ID || !env.GOOGLE_DATA_CLIENT_SECRET || !env.GOOGLE_DATA_REDIRECT_URI || !env.TOKEN_ENCRYPTION_KEY) return null;
  return { clientId: env.GOOGLE_DATA_CLIENT_ID, clientSecret: env.GOOGLE_DATA_CLIENT_SECRET, redirectUri: env.GOOGLE_DATA_REDIRECT_URI };
}

/** Google refused the stored token (revoked, expired in Testing mode, password changed): the owner must reconnect. */
export class GoogleReauthError extends Error {
  constructor() {
    super("invalid_grant");
  }
}
/** Anything else. `code` is short and safe to store and log. */
export class GoogleApiError extends Error {
  constructor(public readonly code: "quota" | "forbidden" | "not_found" | "server" | "bad_response" | "network") {
    super(code);
  }
}

function codeFor(status: number): GoogleApiError["code"] {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "bad_response";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One call, retried twice on 429/5xx with backoff (PRD FR-4.6). */
async function call(t: GoogleTransport, req: GoogleRequest, retryDelayMs = 1000): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: GoogleResponse;
    try {
      res = await t(req);
    } catch {
      if (attempt < 2) {
        await sleep(retryDelayMs * 2 ** attempt);
        continue;
      }
      throw new GoogleApiError("network");
    }
    if (res.status >= 200 && res.status < 300) return res.body;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await sleep(retryDelayMs * 2 ** attempt);
      continue;
    }
    throw new GoogleApiError(codeFor(res.status));
  }
}

// --- OAuth --------------------------------------------------------------------

/** Google's consent screen: offline access (refresh token), both scopes, PKCE and a state value. */
export function authorizationUrl(cfg: GoogleConfig, p: { state: string; codeChallenge: string }): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: DATA_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state: p.state,
    code_challenge: p.codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(""),
  expires_in: z.number().optional(),
});

/** Exchange the one-time code. Returns only the scopes we asked for that the user actually granted. */
export async function exchangeCode(t: GoogleTransport, cfg: GoogleConfig, code: string, codeVerifier: string) {
  const res = await t({
    url: "https://oauth2.googleapis.com/token",
    method: "POST",
    form: { code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code", code_verifier: codeVerifier },
  }).catch(() => {
    throw new GoogleApiError("network");
  });
  if (res.status !== 200) throw new GoogleApiError(codeFor(res.status));
  const parsed = tokenResponse.safeParse(res.body);
  if (!parsed.success) throw new GoogleApiError("bad_response");
  const granted = parsed.data.scope.split(" ");
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token ?? null,
    scopes: DATA_SCOPES.filter((s) => granted.includes(s)),
  };
}

/** A fresh access token (kept in memory only, about an hour). */
export async function refreshAccessToken(t: GoogleTransport, cfg: GoogleConfig, refreshToken: string): Promise<string> {
  let res: GoogleResponse;
  try {
    res = await t({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      form: { client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" },
    });
  } catch {
    throw new GoogleApiError("network");
  }
  const err = (res.body as { error?: unknown } | null)?.error;
  if (res.status === 400 && (err === "invalid_grant" || err === "unauthorized_client")) throw new GoogleReauthError();
  if (res.status !== 200) throw new GoogleApiError(codeFor(res.status));
  const parsed = tokenResponse.safeParse(res.body);
  if (!parsed.success) throw new GoogleApiError("bad_response");
  return parsed.data.access_token;
}

/** Best effort: tell Google to forget the token. Disconnecting continues even if this fails. */
export async function revokeToken(t: GoogleTransport, token: string): Promise<boolean> {
  try {
    const res = await t({ url: "https://oauth2.googleapis.com/revoke", method: "POST", form: { token } });
    return res.status === 200;
  } catch {
    return false;
  }
}

// --- Listing what the user can pick -----------------------------------------------

export type GscSite = { siteUrl: string };
export type Ga4Property = { property: string; displayName: string; account: string };

const sitesResponse = z.object({ siteEntry: z.array(z.object({ siteUrl: z.string().min(1).max(300), permissionLevel: z.string() })).default([]) });

export async function listGscSites(t: GoogleTransport, accessToken: string): Promise<GscSite[]> {
  const body = await call(t, { url: "https://www.googleapis.com/webmasters/v3/sites", method: "GET", accessToken });
  const parsed = sitesResponse.safeParse(body ?? {});
  if (!parsed.success) throw new GoogleApiError("bad_response");
  return parsed.data.siteEntry.filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => ({ siteUrl: s.siteUrl }));
}

const summariesResponse = z.object({
  accountSummaries: z
    .array(
      z.object({
        displayName: z.string().max(200).default(""),
        propertySummaries: z.array(z.object({ property: z.string().regex(/^properties\/\d+$/), displayName: z.string().max(200).default("") })).default([]),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

export async function listGa4Properties(t: GoogleTransport, accessToken: string): Promise<Ga4Property[]> {
  const out: Ga4Property[] = [];
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ pageSize: "200", ...(page ? { pageToken: page } : {}) });
    const body = await call(t, { url: `https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${q}`, method: "GET", accessToken });
    const parsed = summariesResponse.safeParse(body ?? {});
    if (!parsed.success) throw new GoogleApiError("bad_response");
    for (const a of parsed.data.accountSummaries)
      for (const p of a.propertySummaries) out.push({ property: p.property, displayName: p.displayName || p.property, account: a.displayName });
    page = parsed.data.nextPageToken;
    if (!page) break;
  }
  return out;
}

// --- Reports ------------------------------------------------------------------

const gscRows = z.object({
  rows: z
    .array(z.object({ keys: z.array(z.string()), clicks: z.number(), impressions: z.number(), ctr: z.number(), position: z.number() }))
    .default([]),
});

export type GscDay = { date: string; clicks: number; impressions: number; ctr: number; position: number };
export type GscQueryDay = { date: string; query: string; clicks: number; impressions: number; position: number };

async function gscQuery(t: GoogleTransport, accessToken: string, siteUrl: string, payload: object) {
  const body = await call(t, {
    url: `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    method: "POST",
    accessToken,
    json: payload,
  });
  const parsed = gscRows.safeParse(body ?? {});
  if (!parsed.success) throw new GoogleApiError("bad_response");
  return parsed.data.rows;
}

const isDay = (s: string | undefined): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Clicks, impressions, CTR and position per day for the whole site. */
export async function gscDailyTotals(t: GoogleTransport, accessToken: string, siteUrl: string, start: string, end: string): Promise<GscDay[]> {
  const rows = await gscQuery(t, accessToken, siteUrl, { startDate: start, endDate: end, dimensions: ["date"], rowLimit: 25000, dataState: "all" });
  return rows.filter((r) => isDay(r.keys[0])).map((r) => ({ date: r.keys[0], clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: r.ctr, position: r.position }));
}

/** What people typed into Google to find the site, per day. Search text is untrusted: kept as plain text, length-capped. */
export async function gscQueriesByDay(t: GoogleTransport, accessToken: string, siteUrl: string, start: string, end: string): Promise<GscQueryDay[]> {
  const rows = await gscQuery(t, accessToken, siteUrl, { startDate: start, endDate: end, dimensions: ["date", "query"], rowLimit: 25000, dataState: "all" });
  return rows
    .filter((r) => isDay(r.keys[0]) && typeof r.keys[1] === "string" && r.keys[1].length > 0)
    .map((r) => ({ date: r.keys[0], query: r.keys[1].slice(0, 200), clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), position: r.position }));
}

const ga4Response = z.object({
  rows: z
    .array(z.object({ dimensionValues: z.array(z.object({ value: z.string() })), metricValues: z.array(z.object({ value: z.string() })) }))
    .default([]),
});

export type Ga4Day = { date: string; channel: string; sessions: number; users: number; keyEvents: number };

/** Sessions, users and key events (GA4's name for conversions) per day and channel. */
export async function ga4DailyReport(t: GoogleTransport, accessToken: string, property: string, start: string, end: string): Promise<Ga4Day[]> {
  if (!/^properties\/\d+$/.test(property)) throw new GoogleApiError("bad_response");
  const body = await call(t, {
    url: `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
    method: "POST",
    accessToken,
    json: {
      dateRanges: [{ startDate: start, endDate: end }],
      dimensions: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }],
      limit: 100000,
    },
  });
  const parsed = ga4Response.safeParse(body ?? {});
  if (!parsed.success) throw new GoogleApiError("bad_response");
  return parsed.data.rows.flatMap((r) => {
    const d = r.dimensionValues[0]?.value ?? "";
    if (!/^\d{8}$/.test(d)) return [];
    const n = (i: number) => {
      const v = Number(r.metricValues[i]?.value ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    return [{ date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`, channel: (r.dimensionValues[1]?.value || "Unassigned").slice(0, 60), sessions: Math.round(n(0)), users: Math.round(n(1)), keyEvents: n(2) }];
  });
}
