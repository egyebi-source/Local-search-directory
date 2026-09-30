import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Security checklist §13: no secret may use a NEXT_PUBLIC_ prefix, because
// Next.js copies NEXT_PUBLIC_ values into the browser bundle.
const ALLOWED_PUBLIC = new Set(["NEXT_PUBLIC_TURNSTILE_SITE_KEY"]);

describe("NEXT_PUBLIC_ variables", () => {
  it("only the Turnstile site key is exposed to the browser", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((f) => f && !f.startsWith("tests/") && !f.endsWith(".md") && f !== "package-lock.json");

    const found = new Set<string>();
    for (const file of files) {
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const m of text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]+/g)) found.add(m[0]);
    }

    const disallowed = [...found].filter((name) => !ALLOWED_PUBLIC.has(name));
    expect(disallowed).toEqual([]);
  });
});
