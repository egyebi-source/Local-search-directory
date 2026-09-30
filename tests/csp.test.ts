import { describe, expect, it } from "vitest";
import { API_CSP, buildPageCsp, generateNonce } from "@/server/security/csp";
import { SECURITY_HEADERS } from "@/server/security/headers";

describe("generateNonce", () => {
  it("returns a fresh, unpredictable value each time", () => {
    const nonces = new Set(Array.from({ length: 100 }, generateNonce));
    expect(nonces.size).toBe(100);
    for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe("buildPageCsp (production)", () => {
  const csp = buildPageCsp("abc123", false);

  it("only allows scripts carrying the nonce", () => {
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
  });

  it("never allows inline or eval'd code", () => {
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("blocks framing, plugins and base-tag hijacking", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });
});

describe("buildPageCsp (development)", () => {
  it("adds unsafe-eval only in development (React dev tooling needs it)", () => {
    expect(buildPageCsp("n", true)).toContain("'unsafe-eval'");
  });
});

describe("API_CSP", () => {
  it("denies everything", () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(API_CSP).toContain("frame-ancestors 'none'");
  });
});

describe("SECURITY_HEADERS", () => {
  const byKey = Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it("includes the headers required by PRD §8.4", () => {
    expect(byKey["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(byKey["X-Frame-Options"]).toBe("DENY");
  });
});
