import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/server/env";

// Google refresh tokens are encrypted at rest with AES-256-GCM (PRD §8.2).
// This is the ONLY file that decrypts them. Each ciphertext is bound to its
// organization (as GCM "additional data"), so a token copied into another
// org's row fails to decrypt instead of granting access.

export type Sealed = { ciphertext: string; iv: string; authTag: string; keyVersion: number };

export class TokenKeyMissingError extends Error {
  constructor() {
    super("TOKEN_ENCRYPTION_KEY is not set");
  }
}
export class TokenDecryptError extends Error {
  constructor() {
    super("Could not decrypt the stored Google token");
  }
}

function currentKey(): { key: Buffer; version: number } {
  const env = serverEnv();
  if (!env.TOKEN_ENCRYPTION_KEY) throw new TokenKeyMissingError();
  return { key: Buffer.from(env.TOKEN_ENCRYPTION_KEY, "base64"), version: env.TOKEN_ENCRYPTION_KEY_VERSION };
}

function seal(plain: string, aad: string): Sealed {
  const { key, version } = currentKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: version };
}

function open(sealed: Sealed, aad: string): string {
  const { key, version } = currentKey();
  // Key rotation: add the previous key here when a new version is introduced.
  if (sealed.keyVersion !== version) throw new TokenDecryptError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptError();
  }
}

export const encryptRefreshToken = (orgId: string, token: string): Sealed => seal(token, `google-refresh:${orgId}`);
export const decryptRefreshToken = (orgId: string, sealed: Sealed): string => open(sealed, `google-refresh:${orgId}`);

/** The short-lived OAuth state cookie (holds the PKCE verifier), sealed the same way. Cookie-safe characters only. */
export function sealCookie(value: object): string {
  return Buffer.from(JSON.stringify(seal(JSON.stringify(value), "google-oauth-state"))).toString("base64url");
}
export function openCookie(cookie: string): unknown {
  let sealed: Sealed;
  try {
    sealed = JSON.parse(Buffer.from(cookie, "base64url").toString("utf8"));
  } catch {
    throw new TokenDecryptError();
  }
  if (!sealed || typeof sealed !== "object" || typeof sealed.ciphertext !== "string" || typeof sealed.iv !== "string" || typeof sealed.authTag !== "string") {
    throw new TokenDecryptError();
  }
  return JSON.parse(open(sealed, "google-oauth-state"));
}
