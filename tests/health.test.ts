import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("GET /api/health", () => {
  it("reports not_configured without a database and never caches", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "ok", database: "not_configured" });
  });

  it("reports degraded without leaking the connection string when the DB is unreachable", async () => {
    // Port 1 on localhost refuses connections immediately.
    vi.stubEnv("DATABASE_URL", "postgresql://leaky_user:leaky_pw@127.0.0.1:1/db");
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", database: "unreachable" });
    expect(text).not.toContain("leaky");
  });
});
