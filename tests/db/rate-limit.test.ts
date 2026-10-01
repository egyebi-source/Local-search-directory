import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { asOwner, hasDb } from "./helpers";

describe.runIf(hasDb)("rate limiting", () => {
  const rule = { name: `test-${uuidv7()}`, limit: 3, windowSeconds: 3600 };

  it("allows up to the limit, then blocks", async () => {
    const id = "someone@example.test";
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(rule, id));
    expect(results).toEqual([true, true, true, false]);
    // Identifiers are case-insensitive, so changing case doesn't reset the count.
    expect(await consumeRateLimit(rule, id.toUpperCase())).toBe(false);
  });

  it("keeps counters separate per identifier", async () => {
    expect(await consumeRateLimit(rule, "other@example.test")).toBe(true);
  });

  it("starts a new window once the old one has passed", async () => {
    const id = "window@example.test";
    for (let i = 0; i < 4; i++) await consumeRateLimit(rule, id);
    await asOwner((c) => c.query("UPDATE rate_limits SET window_start = now() - interval '2 hours'"));
    expect(await consumeRateLimit(rule, id)).toBe(true);
  });

  it("stores hashed keys, never the raw email or IP", async () => {
    await consumeRateLimit(rule, "visible@example.test");
    const keys = await asOwner(async (c) => (await c.query("SELECT key FROM rate_limits")).rows);
    for (const { key } of keys) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
