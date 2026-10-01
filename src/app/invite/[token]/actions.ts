"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { acceptInvite } from "@/server/org/invite-accept";
import { requireUser, setCurrentOrgCookie } from "@/server/org/current";

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const token = tokenSchema.safeParse(formData.get("token"));
  const orgId = token.success ? await acceptInvite(token.data, user.id, user.email) : null;
  if (!orgId) redirect("/invite/invalid");
  await setCurrentOrgCookie(orgId);
  redirect("/app");
}
