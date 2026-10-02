import "server-only";
import { auditLog } from "@/server/db/schema";
import type { OrgContext, Tx } from "@/server/db/tenant";

export type AuditAction =
  | "org.created"
  | "invite.created"
  | "invite.revoked"
  | "invite.accepted"
  | "member.removed"
  | "member.role_changed"
  | "agency.code_created";

export async function audit(
  tx: Tx,
  ctx: OrgContext,
  action: AuditAction,
  metadata: Record<string, unknown> = {},
) {
  await tx.insert(auditLog).values({
    orgId: ctx.orgId,
    actorUserId: ctx.userId,
    action,
    metadataJson: metadata,
  });
}
