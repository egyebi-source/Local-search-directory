import { describe, expect, it } from "vitest";
import type { AdapterAccount } from "next-auth/adapters";
import { uuidv7 } from "uuidv7";
import { createAuthAdapter, stripLoginTokens } from "@/server/auth/adapter";
import { asOwner, hasDb } from "./helpers";

const googleAccount = (userId: string): AdapterAccount => ({
  userId,
  type: "oidc",
  provider: "google",
  providerAccountId: `g-${uuidv7()}`,
  access_token: "ya29.SECRET-ACCESS",
  refresh_token: "1//SECRET-REFRESH",
  id_token: "eyJ.SECRET-ID",
  session_state: "SECRET-STATE",
  token_type: "bearer",
  scope: "openid email profile",
  expires_at: 123,
});

describe("stripLoginTokens", () => {
  it("removes every token field and keeps the identity fields", () => {
    const clean = stripLoginTokens(googleAccount("u1"));
    expect(clean).not.toHaveProperty("access_token");
    expect(clean).not.toHaveProperty("refresh_token");
    expect(clean).not.toHaveProperty("id_token");
    expect(clean).not.toHaveProperty("session_state");
    expect(clean).toMatchObject({ provider: "google", userId: "u1", type: "oidc" });
  });
});

describe.runIf(hasDb)("auth adapter", () => {
  it("never writes Google login tokens to the database", async () => {
    const adapter = createAuthAdapter();
    const user = await adapter.createUser!({
      id: "",
      email: `g-${uuidv7()}@example.test`,
      emailVerified: null,
    });
    const account = googleAccount(user.id);
    await adapter.linkAccount!(account);

    const rows = await asOwner(
      async (c) =>
        (await c.query("SELECT * FROM accounts WHERE provider_account_id = $1", [account.providerAccountId])).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ access_token: null, refresh_token: null, id_token: null, session_state: null });
    expect(JSON.stringify(rows[0])).not.toContain("SECRET");
  });
});
