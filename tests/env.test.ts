import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/server/env";

describe("parseServerEnv", () => {
  it("accepts a postgres connection string", () => {
    const env = parseServerEnv({ NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@h/db" });
    expect(env.DATABASE_URL).toBe("postgresql://u:p@h/db");
  });

  it("rejects a malformed value and names the variable without echoing its value", () => {
    const secretish = "mysql://user:hunter2@host/db";
    expect(() => parseServerEnv({ DATABASE_URL: secretish })).toThrow(/DATABASE_URL/);
    try {
      parseServerEnv({ DATABASE_URL: secretish });
    } catch (e) {
      expect(String(e)).not.toContain("hunter2");
    }
  });
});
