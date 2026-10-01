import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/lib/domain";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("normalizeDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["https://www.Example.com/contact?x=1", "example.com"],
    ["  shop.example.co.uk  ", "shop.example.co.uk"],
    ["http://example.ca.", "example.ca"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "localhost", "192.168.0.1", "ftp://example.com", "user:pw@example.com", "example.com:8080", "-bad-.com", "javascript:alert(1)"])(
    "rejects %j",
    (input) => {
      expect(normalizeDomain(input)).toBeNull();
    },
  );
});

describe("safeRedirectPath", () => {
  it("keeps same-site paths", () => {
    expect(safeRedirectPath("/invite/abc")).toBe("/invite/abc");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", 42, undefined])(
    "falls back for %j",
    (value) => {
      expect(safeRedirectPath(value)).toBe("/app");
    },
  );
});
