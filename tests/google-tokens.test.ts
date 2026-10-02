import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptRefreshToken, encryptRefreshToken, openCookie, sealCookie, TokenDecryptError, TokenKeyMissingError } from "@/server/google/tokens";

const KEY = Buffer.alloc(32, 7).toString("base64");
const ORG_A = "0190f0f0-0000-7000-8000-00000000000a";
const ORG_B = "0190f0f0-0000-7000-8000-00000000000b";

// PRD §8.2: AES-256-GCM, random IV, tamper detection, key versions.
describe("Google token encryption", () => {
  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    process.env.TOKEN_ENCRYPTION_KEY_VERSION = "1";
  });
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY_VERSION;
  });

  it("round-trips, and never stores the token in readable form", () => {
    const s = encryptRefreshToken(ORG_A, "1//refresh-token-value");
    expect(s.ciphertext).not.toContain("refresh-token");
    expect(Buffer.from(s.iv, "base64")).toHaveLength(12);
    expect(s.keyVersion).toBe(1);
    expect(decryptRefreshToken(ORG_A, s)).toBe("1//refresh-token-value");
  });

  it("uses a fresh IV every time", () => {
    const a = encryptRefreshToken(ORG_A, "same");
    const b = encryptRefreshToken(ORG_A, "same");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("detects tampering with the ciphertext or tag", () => {
    const s = encryptRefreshToken(ORG_A, "secret");
    const flipped = Buffer.from(s.ciphertext, "base64");
    flipped[0] ^= 1;
    expect(() => decryptRefreshToken(ORG_A, { ...s, ciphertext: flipped.toString("base64") })).toThrow(TokenDecryptError);
    expect(() => decryptRefreshToken(ORG_A, { ...s, authTag: Buffer.alloc(16).toString("base64") })).toThrow(TokenDecryptError);
  });

  it("a token copied into another organization's row doesn't decrypt", () => {
    const s = encryptRefreshToken(ORG_A, "secret");
    expect(() => decryptRefreshToken(ORG_B, s)).toThrow(TokenDecryptError);
  });

  it("fails closed on a different key or key version", () => {
    const s = encryptRefreshToken(ORG_A, "secret");
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptRefreshToken(ORG_A, s)).toThrow(TokenDecryptError);
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    expect(() => decryptRefreshToken(ORG_A, { ...s, keyVersion: 2 })).toThrow(TokenDecryptError);
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptRefreshToken(ORG_A, "x")).toThrow(TokenKeyMissingError);
  });

  it("the OAuth state cookie is sealed, cookie-safe, and rejects tampering", () => {
    const c = sealCookie({ state: "abc", verifier: "def" });
    expect(c).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c).not.toContain("def");
    expect(openCookie(c)).toEqual({ state: "abc", verifier: "def" });
    expect(() => openCookie(`${c.slice(0, -4)}AAAA`)).toThrow(TokenDecryptError);
    expect(() => openCookie("not-a-cookie")).toThrow(TokenDecryptError);
  });

  it("only src/server/google/ may decrypt tokens", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk("src");
    const users = files.filter((f) => /decryptRefreshToken\(|openCookie\(|["']@\/server\/google\/tokens["']/.test(readFileSync(f, "utf8")));
    for (const f of users) expect(f.replaceAll("\\", "/"), f).toMatch(/^src\/server\/google\//);
  });
});
