import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ga4Daily, googleConnections, gscDaily, gscQueryDaily, linkedProperties } from "@/server/db/schema";
import type { OrgContext, Tx } from "@/server/db/tenant";
import { audit } from "@/server/org/audit";
import {
  exchangeCode,
  GA4_SCOPE,
  GoogleApiError,
  GoogleReauthError,
  GSC_SCOPE,
  listGa4Properties,
  listGscSites,
  refreshAccessToken,
  revokeToken,
  type GoogleConfig,
  type GoogleTransport,
} from "./client";
import { decryptRefreshToken, encryptRefreshToken, openCookie, sealCookie } from "./tokens";

// Connecting an organization's Google data (PRD Module 3). Owners only: the
// Google account is theirs. Only files in src/server/google/ ever see a
// decrypted token, and only long enough to get a short-lived access token.

export const OAUTH_COOKIE = "tr_goauth";
const STATE_TTL_MS = 10 * 60 * 1000;

export class GoogleForbiddenError extends Error {}

const statePayload = z.object({ state: z.string().length(43), verifier: z.string().length(43), orgId: z.uuid(), userId: z.uuid(), exp: z.number() });
export type OAuthState = z.infer<typeof statePayload>;

/** A fresh state value and PKCE pair, sealed into a short-lived cookie. */
export function beginConnect(ctx: OrgContext): { state: string; codeChallenge: string; cookie: string } {
  if (ctx.role !== "owner") throw new GoogleForbiddenError();
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(verifier).digest("base64url");
  const cookie = sealCookie({ state, verifier, orgId: ctx.orgId, userId: ctx.userId, exp: Date.now() + STATE_TTL_MS } satisfies OAuthState);
  return { state, codeChallenge, cookie };
}

/** The cookie's contents, only if it's ours, unexpired, and matches the state Google sent back. */
export function checkState(cookie: string | undefined, returnedState: string, userId: string): OAuthState | null {
  if (!cookie) return null;
  let payload: OAuthState;
  try {
    const parsed = statePayload.safeParse(openCookie(cookie));
    if (!parsed.success) return null;
    payload = parsed.data;
  } catch {
    return null;
  }
  if (payload.exp < Date.now() || payload.userId !== userId) return null;
  const a = Buffer.from(payload.state);
  const b = Buffer.from(returnedState);
  if (a.length !== b.length) return null;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0 ? payload : null;
}

export class NoRefreshTokenError extends Error {}
export class NoScopesError extends Error {}

/**
 * Finish connecting: exchange the code, keep the refresh token encrypted,
 * and replace any earlier connection (whose token is revoked at Google).
 */
export async function completeConnect(tx: Tx, ctx: OrgContext, t: GoogleTransport, cfg: GoogleConfig, code: string, verifier: string) {
  if (ctx.role !== "owner") throw new GoogleForbiddenError();
  const tokens = await exchangeCode(t, cfg, code, verifier);
  if (!tokens.scopes.length) throw new NoScopesError();
  if (!tokens.refreshToken) throw new NoRefreshTokenError();
  const old = await loadSealed(tx, ctx.orgId);
  if (old) {
    await revokeToken(t, decryptOrNull(ctx.orgId, old) ?? "").catch(() => false);
    await tx.delete(googleConnections).where(eq(googleConnections.orgId, ctx.orgId));
  }
  const sealed = encryptRefreshToken(ctx.orgId, tokens.refreshToken);
  await tx.insert(googleConnections).values({
    orgId: ctx.orgId,
    connectedByUserId: ctx.userId,
    grantedScopes: [...tokens.scopes],
    refreshTokenCiphertext: sealed.ciphertext,
    tokenIv: sealed.iv,
    tokenAuthTag: sealed.authTag,
    keyVersion: sealed.keyVersion,
    status: "active",
    lastRefreshedAt: new Date(),
  });
  await audit(tx, ctx, "google.connected", { scopes: tokens.scopes.map((s) => (s === GSC_SCOPE ? "search_console" : "analytics")) });
  return { scopes: tokens.scopes };
}

async function loadSealed(tx: Tx, orgId: string) {
  const [row] = await tx
    .select({ ciphertext: googleConnections.refreshTokenCiphertext, iv: googleConnections.tokenIv, authTag: googleConnections.tokenAuthTag, keyVersion: googleConnections.keyVersion })
    .from(googleConnections)
    .where(eq(googleConnections.orgId, orgId));
  return row ?? null;
}

function decryptOrNull(orgId: string, sealed: NonNullable<Awaited<ReturnType<typeof loadSealed>>>): string | null {
  try {
    return decryptRefreshToken(orgId, sealed);
  } catch {
    return null;
  }
}

/**
 * A short-lived access token for this org. Throws GoogleReauthError if Google
 * refuses the stored token; the caller then records that with markNeedsReauth()
 * in its own transaction (this one rolls back with the error).
 */
export async function accessTokenFor(tx: Tx, orgId: string, t: GoogleTransport, cfg: GoogleConfig): Promise<string> {
  const sealed = await loadSealed(tx, orgId);
  if (!sealed) throw new GoogleReauthError();
  const refresh = decryptOrNull(orgId, sealed);
  if (!refresh) throw new GoogleReauthError();
  const token = await refreshAccessToken(t, cfg, refresh);
  await tx.update(googleConnections).set({ lastRefreshedAt: new Date() }).where(eq(googleConnections.orgId, orgId));
  return token;
}

/** Stop syncing and show "Reconnect" (PRD FR-3.5). */
export async function markNeedsReauth(tx: Tx, orgId: string): Promise<void> {
  await tx.update(googleConnections).set({ status: "needs_reauth", lastError: "invalid_grant", syncStartedAt: null }).where(eq(googleConnections.orgId, orgId));
}

export type ConnectionView = {
  status: "active" | "needs_reauth" | "revoked";
  scopes: { searchConsole: boolean; analytics: boolean };
  connectedAt: Date;
  lastSyncedAt: Date | null;
  lastError: string | null;
  gsc: { externalId: string; displayName: string } | null;
  ga4: { externalId: string; displayName: string } | null;
};

/** What the app may show about the connection. Never includes token columns. */
export async function loadConnection(tx: Tx, orgId: string): Promise<ConnectionView | null> {
  const [c] = await tx
    .select({
      status: googleConnections.status,
      scopes: googleConnections.grantedScopes,
      connectedAt: googleConnections.createdAt,
      lastSyncedAt: googleConnections.lastSyncedAt,
      lastError: googleConnections.lastError,
    })
    .from(googleConnections)
    .where(eq(googleConnections.orgId, orgId));
  if (!c) return null;
  const props = await tx
    .select({ type: linkedProperties.type, externalId: linkedProperties.externalId, displayName: linkedProperties.displayName })
    .from(linkedProperties)
    .where(eq(linkedProperties.orgId, orgId));
  const pick = (type: "gsc" | "ga4") => {
    const p = props.find((x) => x.type === type);
    return p ? { externalId: p.externalId, displayName: p.displayName } : null;
  };
  return {
    status: c.status,
    scopes: { searchConsole: c.scopes.includes(GSC_SCOPE), analytics: c.scopes.includes(GA4_SCOPE) },
    connectedAt: c.connectedAt,
    lastSyncedAt: c.lastSyncedAt,
    lastError: c.lastError,
    gsc: pick("gsc"),
    ga4: pick("ga4"),
  };
}

/** The Search Console sites and GA4 properties this Google account can see (for the picker). */
export async function listChoices(tx: Tx, orgId: string, t: GoogleTransport, cfg: GoogleConfig) {
  const conn = await loadConnection(tx, orgId);
  if (!conn || conn.status !== "active") return null;
  const token = await accessTokenFor(tx, orgId, t, cfg);
  const [sites, properties] = await Promise.all([
    conn.scopes.searchConsole ? listGscSites(t, token).catch(() => null) : Promise.resolve([]),
    conn.scopes.analytics ? listGa4Properties(t, token).catch(() => null) : Promise.resolve([]),
  ]);
  return { sites, properties, scopes: conn.scopes };
}

/**
 * Save the owner's picks. Each pick is checked against what Google says this
 * account can see right now, never trusted from the browser.
 */
export async function saveProperties(tx: Tx, ctx: OrgContext, t: GoogleTransport, cfg: GoogleConfig, pick: { gsc: string | null; ga4: string | null }) {
  if (ctx.role !== "owner") throw new GoogleForbiddenError();
  const choices = await listChoices(tx, ctx.orgId, t, cfg);
  if (!choices) throw new GoogleReauthError();
  const site = pick.gsc ? choices.sites?.find((s) => s.siteUrl === pick.gsc) : undefined;
  const prop = pick.ga4 ? choices.properties?.find((p) => p.property === pick.ga4) : undefined;
  if ((pick.gsc && !site) || (pick.ga4 && !prop)) throw new GoogleApiError("not_found");
  const [conn] = await tx.select({ id: googleConnections.id }).from(googleConnections).where(eq(googleConnections.orgId, ctx.orgId));
  await tx.delete(linkedProperties).where(eq(linkedProperties.orgId, ctx.orgId));
  if (site) await tx.insert(linkedProperties).values({ orgId: ctx.orgId, connectionId: conn.id, type: "gsc", externalId: site.siteUrl, displayName: site.siteUrl.replace(/^sc-domain:/, "") });
  if (prop) await tx.insert(linkedProperties).values({ orgId: ctx.orgId, connectionId: conn.id, type: "ga4", externalId: prop.property, displayName: prop.displayName });
  // A new pick means a fresh first sync (16 months of Search Console history).
  await tx.update(googleConnections).set({ lastSyncedAt: null, syncStartedAt: null }).where(eq(googleConnections.orgId, ctx.orgId));
  await audit(tx, ctx, "google.properties_chosen", { gsc: Boolean(site), ga4: Boolean(prop) });
}

/** Disconnect (PRD FR-3.6): revoke at Google, delete the encrypted token, optionally delete the cached numbers. */
export async function disconnect(tx: Tx, ctx: OrgContext, t: GoogleTransport, deleteData: boolean): Promise<{ revoked: boolean }> {
  if (ctx.role !== "owner") throw new GoogleForbiddenError();
  const sealed = await loadSealed(tx, ctx.orgId);
  if (!sealed) return { revoked: false };
  const token = decryptOrNull(ctx.orgId, sealed);
  const revoked = token ? await revokeToken(t, token) : false;
  await tx.delete(googleConnections).where(eq(googleConnections.orgId, ctx.orgId));
  if (deleteData) {
    await tx.delete(gscDaily).where(eq(gscDaily.orgId, ctx.orgId));
    await tx.delete(gscQueryDaily).where(eq(gscQueryDaily.orgId, ctx.orgId));
    await tx.delete(ga4Daily).where(eq(ga4Daily.orgId, ctx.orgId));
  }
  await audit(tx, ctx, "google.disconnected", { revoked_at_google: revoked, deleted_data: deleteData });
  return { revoked };
}
