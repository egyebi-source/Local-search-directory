import "server-only";
import { serverEnv } from "@/server/env";

export type Email = { to: string; subject: string; text: string; html: string };

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email sending is not configured (RESEND_API_KEY missing)");
  }
}

const DEFAULT_FROM = "TorqueRank <onboarding@resend.dev>";

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
      from: env.EMAIL_FROM ?? DEFAULT_FROM,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  });

  if (!res.ok) {
    // Status only: the response body can echo the message content.
    throw new Error(`Email provider rejected the message (HTTP ${res.status})`);
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
