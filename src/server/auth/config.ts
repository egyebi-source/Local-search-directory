import "server-only";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { escapeHtml, sendEmail } from "@/server/email/send";
import { serverEnv } from "@/server/env";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { createAuthAdapter } from "./adapter";

export const SIGN_IN_LINK_MINUTES = 15;

export class LoginEmailRateLimitedError extends Error {
  constructor() {
    super("Too many sign-in emails for this address");
  }
}

export function googleLoginEnabled(): boolean {
  const env = serverEnv();
  return Boolean(env.GOOGLE_LOGIN_CLIENT_ID && env.GOOGLE_LOGIN_CLIENT_SECRET);
}

export function buildAuthConfig(): NextAuthConfig {
  const env = serverEnv();

  const providers: NextAuthConfig["providers"] = [
    Resend({
      // The key is used by our own sendEmail(), not by this provider object.
      apiKey: "unused",
      maxAge: SIGN_IN_LINK_MINUTES * 60,
      normalizeIdentifier: (identifier) => identifier.trim().toLowerCase(),
      async sendVerificationRequest({ identifier, url }) {
        // Backstop for direct POSTs to /api/auth; the login form also limits by IP.
        if (!(await consumeRateLimit(RATE_LIMITS.loginEmailPerAddress, identifier))) {
          throw new LoginEmailRateLimitedError();
        }
        await sendEmail({
          to: identifier,
          subject: "Your TorqueRank sign-in link",
          text: `Sign in to TorqueRank:\n${url}\n\nThis link works once and expires in ${SIGN_IN_LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.`,
          html: `<p>Sign in to TorqueRank:</p><p><a href="${escapeHtml(url)}">Sign in</a></p><p>This link works once and expires in ${SIGN_IN_LINK_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>`,
        });
      },
    }),
  ];

  if (googleLoginEnabled()) {
    providers.push(
      Google({
        clientId: env.GOOGLE_LOGIN_CLIENT_ID,
        clientSecret: env.GOOGLE_LOGIN_CLIENT_SECRET,
        // Login only: basic profile (PRD §6.3). Data scopes use a separate flow.
        authorization: { params: { scope: "openid email profile" } },
      }),
    );
  }

  return {
    adapter: createAuthAdapter(),
    providers,
    secret: env.AUTH_SECRET,
    trustHost: true,
    session: { strategy: "database", maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
    pages: { signIn: "/login", verifyRequest: "/login/check-email", error: "/login" },
    callbacks: {
      signIn({ account, profile }) {
        // Only accept Google accounts whose email Google has verified.
        if (account?.provider === "google") return profile?.email_verified === true;
        return true;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
  };
}
