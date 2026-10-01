import "server-only";
import { createHash, randomBytes } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** URL-safe random token with 256 bits of entropy. */
export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
