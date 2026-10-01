import "server-only";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { getDb } from "@/server/db/client";
import { accounts, sessions, users, verificationTokens } from "@/server/db/schema";

const TOKEN_FIELDS = ["access_token", "refresh_token", "id_token", "session_state"] as const;

/**
 * Login only needs to know *who* someone is. Google hands Auth.js tokens on
 * every sign-in; we drop them before they reach the database so no login
 * credential is ever stored (CLAUDE.md security rule 3). The separate
 * "connect Google data" flow (Phase 3) stores its own token, encrypted.
 */
export function stripLoginTokens(account: AdapterAccount): AdapterAccount {
  const clean: AdapterAccount = { ...account };
  for (const field of TOKEN_FIELDS) delete clean[field];
  return clean;
}

export function createAuthAdapter(): Adapter {
  const base = DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });
  return {
    ...base,
    linkAccount: (account) => base.linkAccount!(stripLoginTokens(account)),
  };
}
