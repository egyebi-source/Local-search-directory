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

describe("email sender", () => {
  it("uses EMAIL_FROM or RESEND_FROM_EMAIL, and names a bare address TorqueRank", async () => {
    const { senderAddress } = await import("@/server/email/send");
    expect(senderAddress({})).toBe("TorqueRank <onboarding@resend.dev>");
    expect(senderAddress({ RESEND_FROM_EMAIL: "login@example.com" })).toBe("TorqueRank <login@example.com>");
    expect(senderAddress({ RESEND_FROM_EMAIL: "x@example.com", EMAIL_FROM: "Acme <a@example.com>" })).toBe("Acme <a@example.com>");
  });
});
