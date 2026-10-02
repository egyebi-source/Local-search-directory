import "server-only";
import { serverEnv } from "@/server/env";

export type Email = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email sending is not configured (RESEND_API_KEY missing)");
  }
}

const DEFAULT_FROM = "TorqueRank <onboarding@resend.dev>";

/** "TorqueRank <login@example.com>"; a bare address gets the TorqueRank name. */
export function senderAddress(env: { EMAIL_FROM?: string; RESEND_FROM_EMAIL?: string }): string {
  const raw = (env.EMAIL_FROM ?? env.RESEND_FROM_EMAIL ?? "").trim();
  if (!raw) return DEFAULT_FROM;
  return raw.includes("<") ? raw : `TorqueRank <${raw}>`;
}

export async function sendEmail(email: Email): Promise<void> {
  const env = serverEnv();

  if (!env.RESEND_API_KEY) {
    // Local development only: print the email so sign-in links work offline.
    // On Vercel (preview or production) an email provider is mandatory, so
    // sign-in links never end up in hosted logs.
    if (env.NODE_ENV === "development" && !env.VERCEL_ENV) {
      console.info(`\n[dev email] to=${email.to}\nsubject: ${email.subject}\n${email.text}\n`);
      return;
    }
    throw new EmailNotConfiguredError();
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: senderAddress(env),
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      ...(email.headers ? { headers: email.headers } : {}),
    }),
  });

  if (!res.ok) {
    // Resend's short reason (e.g. "domain is not verified") helps fix setup. Never
    // the request or our message content; capped and stripped of addresses.
    const reason = await res
      .json()
      .then((b: { message?: unknown }) => (typeof b?.message === "string" ? b.message : ""))
      .catch(() => "");
    const safe = reason.replace(/[^\s@<>]+@[^\s@<>]+/g, "[address]").slice(0, 160);
    throw new Error(`Email provider rejected the message (HTTP ${res.status})${safe ? `: ${safe}` : ""}`);
  }
}

/** Escape text for inclusion in an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
