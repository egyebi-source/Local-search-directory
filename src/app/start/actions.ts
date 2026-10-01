"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { auth } from "@/server/auth";

export type StartState = { error?: string };

/**
 * Home-page website box. Until the public assessment ships (Phase 2), this
 * validates the site and carries it into the gate, pre-filled.
 */
export async function startAssessmentAction(_prev: StartState, formData: FormData): Promise<StartState> {
  const raw = z.string().max(253).safeParse(formData.get("website"));
  const domain = raw.success ? normalizeDomain(raw.data) : null;
  if (!domain) return { error: "Enter your website address, like yourbusiness.com" };

  const next = `/onboarding?website=${encodeURIComponent(domain)}`;
  if ((await auth())?.user) redirect(next);
  redirect(`/login?callbackUrl=${encodeURIComponent(next)}`);
}
