import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { platformAdmins } from "@/server/db/schema";
import { withUser } from "@/server/db/tenant";

// TorqueRank staff area (PRD Module 9). Every read and write goes through
// admin_* database functions, which re-check admin status themselves, so a
// bug in this file can't widen access.

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx.select({ id: platformAdmins.userId }).from(platformAdmins).where(eq(platformAdmins.userId, userId)),
  );
  return rows.length > 0;
}

export type Overview = {
  assessments_30d: number;
  orgs_total: number;
  orgs_trialing: number;
  orgs_active: number;
  orgs_locked: number;
  orgs_tracking: number;
  orgs_logged_change: number;
  checks_today: number;
  spend_today: Record<string, number>;
  daily: { day: string; assessments: number; signups: number; spend_micros: number }[];
};

export type CustomerRow = {
  id: string;
  name: string;
  website_domain: string | null;
  category: string | null;
  service_area: string | null;
  plan_status: string;
  trial_ends_at: string;
  created_at: string;
  owner_email: string | null;
  members: number;
  tracked: number;
  last_check: string | null;
  changes: number;
};

export type AuditRow = {
  created_at: string;
  admin_email: string | null;
  action: string;
  org_name: string | null;
  reason: string;
  details: Record<string, unknown>;
};

export async function adminOverview(userId: string): Promise<Overview> {
  const r = await withUser(userId, (tx) => tx.execute<{ o: Overview }>(sql`SELECT admin_overview() AS o`));
  return r.rows[0].o;
}

export async function adminCustomers(userId: string, limit = 200): Promise<CustomerRow[]> {
  const r = await withUser(userId, (tx) => tx.execute<CustomerRow>(sql`SELECT * FROM admin_customers(${limit})`));
  return r.rows;
}

export type PersonRow = {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  last_active: string | null;
  is_admin: boolean;
  businesses: { name: string; role: string }[];
  agencies: { name: string; role: string }[];
};

export type AgencyRow = {
  id: string;
  name: string;
  plan_status: string;
  trial_ends_at: string;
  created_at: string;
  owner_email: string | null;
  members: number;
  locations: number;
};

/** Everyone who has signed up, including people with no business or agency yet. */
export async function adminPeople(userId: string, limit = 500): Promise<PersonRow[]> {
  const r = await withUser(userId, (tx) => tx.execute<PersonRow>(sql`SELECT * FROM admin_people(${limit})`));
  return r.rows;
}

export async function adminAgencies(userId: string, limit = 200): Promise<AgencyRow[]> {
  const r = await withUser(userId, (tx) => tx.execute<AgencyRow>(sql`SELECT * FROM admin_agencies(${limit})`));
  return r.rows;
}

export async function adminAuditRecent(userId: string, limit = 50): Promise<AuditRow[]> {
  const r = await withUser(userId, (tx) => tx.execute<AuditRow>(sql`SELECT * FROM admin_audit_recent(${limit})`));
  return r.rows;
}

export const extendTrialSchema = z.object({
  orgId: z.uuid(),
  days: z.coerce.number().int().min(1).max(30),
  reason: z.string().trim().min(5).max(300),
});

export async function adminExtendTrial(userId: string, input: z.infer<typeof extendTrialSchema>): Promise<Date> {
  const r = await withUser(userId, (tx) =>
    tx.execute<{ until: string }>(sql`SELECT admin_extend_trial(${input.orgId}, ${input.days}, ${input.reason}) AS until`),
  );
  return new Date(r.rows[0].until);
}
