"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/lib/i18n/en";
import { signOut } from "@/server/auth";
import { escapeHtml, sendEmail } from "@/server/email/send";
import { organizations } from "@/server/db/schema";
import { withOrg } from "@/server/db/tenant";
import { currentOrganization, requireUser, setCurrentOrgCookie, withCurrentOrg } from "@/server/org/current";
import {
  changeRole,
  canInvite,
  createInvite,
  ForbiddenError,
  removeMember,
  revokeInvite,
  TeamRuleError,
} from "@/server/org/team";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";
import { createConnectCode, endAgencyForOrg } from "@/server/agency/agency";
import { appBaseUrl } from "@/server/url";

export type ActionState = { error?: string; ok?: string };

const roleSchema = z.enum(["owner", "member"]);
const idSchema = z.uuid();

function teamError(err: unknown): ActionState {
  if (err instanceof ForbiddenError) return { error: t.team.ownersOnly };
  if (err instanceof TeamRuleError) {
    if (err.code === "already_member") return { error: t.team.errors.alreadyMember };
    if (err.code === "last_owner") return { error: t.team.errors.lastOwner };
    return { error: t.login.errors.generic };
  }
  throw err;
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}

export async function switchOrgAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = idSchema.safeParse(formData.get("orgId"));
  if (orgId.success) {
    const { orgs } = await currentOrganization(user);
    if (orgs.some((o) => o.id === orgId.data)) await setCurrentOrgCookie(orgId.data);
  }
  redirect("/app");
}

class InviteRateLimitedError extends Error {}

export async function inviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.email().max(254), role: roleSchema })
    .safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: t.team.errors.invalidEmail };

  let created: { inviteId: string; token: string; orgName: string; orgId: string; userId: string };
  try {
    created = await withCurrentOrg(async (tx, ctx) => {
      if (!canInvite(ctx)) throw new ForbiddenError();
      if (!(await consumeRateLimit(RATE_LIMITS.invitePerOrg, ctx.orgId))) {
        throw new InviteRateLimitedError();
      }
      const [org] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId));
      const { inviteId, token } = await createInvite(tx, ctx, parsed.data);
      return { inviteId, token, orgName: org.name, orgId: ctx.orgId, userId: ctx.userId };
    });
  } catch (err) {
    if (err instanceof InviteRateLimitedError) return { error: t.team.errors.rateLimited };
    return teamError(err);
  }

  const url = `${appBaseUrl()}/invite/${created.token}`;
  try {
    await sendEmail({
      to: parsed.data.email,
      subject: t.invite.emailSubject(created.orgName),
      text: t.invite.emailBody(created.orgName, url),
      html: `<p>${escapeHtml(t.invite.body(created.orgName))}</p><p><a href="${escapeHtml(url)}">${escapeHtml(t.invite.accept)}</a></p><p>This link works once and expires in 7 days. If you weren't expecting it, ignore this email.</p>`,
    });
  } catch {
    // Don't leave behind an invite nobody received; the token is discarded either way.
    await withOrg(created.userId, created.orgId, (tx, ctx) => revokeInvite(tx, ctx, created.inviteId));
    return { error: t.team.errors.emailFailed };
  }

  revalidatePath("/app/team");
  return { ok: t.team.inviteSent };
}

/** For the small one-click team buttons: report rule violations via the URL. */
async function runTeamAction(fn: Parameters<typeof withCurrentOrg>[0]): Promise<void> {
  let errorCode: string | null = null;
  try {
    await withCurrentOrg(fn);
  } catch (err) {
    if (err instanceof ForbiddenError) errorCode = "owners_only";
    else if (err instanceof TeamRuleError) errorCode = err.code;
    else throw err;
  }
  revalidatePath("/app/team");
  if (errorCode) redirect(`/app/team?error=${errorCode}`);
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const inviteId = idSchema.parse(formData.get("inviteId"));
  await runTeamAction((tx, ctx) => revokeInvite(tx, ctx, inviteId));
}

export async function removeMemberAction(formData: FormData): Promise<void> {
  const userId = idSchema.parse(formData.get("userId"));
  await runTeamAction((tx, ctx) => removeMember(tx, ctx, userId));
}

export async function changeRoleAction(formData: FormData): Promise<void> {
  const userId = idSchema.parse(formData.get("userId"));
  const role = roleSchema.parse(formData.get("role"));
  await runTeamAction((tx, ctx) => changeRole(tx, ctx, userId, role));
}

// --- Agency access (PRD Module 11) ------------------------------------------

export type ConnectCodeState = { code?: string; error?: string };

/** The owner creates a one-time code to give their agency. Shown once; only the hash is stored. */
export async function createConnectCodeAction(): Promise<ConnectCodeState> {
  try {
    const code = await withCurrentOrg(async (tx, ctx) => {
      if (ctx.role !== "owner") throw new ForbiddenError();
      if (!(await consumeRateLimit(RATE_LIMITS.connectCodePerOrg, ctx.orgId))) return null;
      return createConnectCode(tx, ctx);
    });
    if (!code) return { error: "You've made several codes today. Try again tomorrow." };
    return { code };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: t.team.ownersOnly };
    throw err;
  }
}

export async function endAgencyAction(): Promise<void> {
  await withCurrentOrg(async (tx, ctx) => {
    if (ctx.role !== "owner") return;
    await endAgencyForOrg(tx, ctx);
  });
  revalidatePath("/app", "layout");
  redirect("/app/team");
}
