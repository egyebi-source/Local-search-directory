import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { sha256Hex } from "@/server/security/hash";

// Both helpers go through narrow database functions (see the RLS migration)
// because the user is not yet a member of the inviting organization.

export async function inviteOrgName(token: string): Promise<string | null> {
  const result = await getDb().execute<{ name: string | null }>(
    sql`SELECT invite_org_name(${sha256Hex(token)}) AS name`,
  );
  return result.rows[0]?.name ?? null;
}

/** Returns the joined org id, or null if the invite can't be used by this user. */
export async function acceptInvite(token: string, userId: string, email: string): Promise<string | null> {
  const result = await getDb().execute<{ org_id: string | null }>(
    sql`SELECT accept_invite(${sha256Hex(token)}, ${userId}::uuid, ${email}) AS org_id`,
  );
  return result.rows[0]?.org_id ?? null;
}
