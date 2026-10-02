import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { refreshPlan } from "@/server/actions/plan";
import { accessState, type AccessState } from "@/server/billing/access";
import { loadDashboard } from "@/server/dashboard/dashboard";
import { agencies, agencyConnectCodes, agencyLocations, agencyMembers, country, type AgencyRole, type Country, type PlanStatus } from "@/server/db/schema";
import { NotMemberError, withOrg, withUser, type OrgContext, type Tx } from "@/server/db/tenant";
import { loadPlan } from "@/server/keywords/plan";
import { audit } from "@/server/org/audit";
import { sha256Hex } from "@/server/security/hash";
import { addTrackedSearch, keywordSchema } from "@/server/tracking/checks";
import { loadProgress } from "@/server/tracking/progress";

// Agencies and networks (PRD Module 11). One login over many businesses.
// Each location stays its own organization; the database decides who may
// open it (agency_can_open) and every change goes through an agency_*
// function that checks the caller itself. This file only calls them.

export const CONNECT_CODE_TTL_DAYS = 7;

export type MyAgency = { id: string; name: string; role: AgencyRole; access: AccessState };

/** Agencies the user is on the team of. */
export async function listMyAgencies(userId: string): Promise<MyAgency[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ id: agencies.id, name: agencies.name, role: agencyMembers.role, planStatus: agencies.planStatus, trialEndsAt: agencies.trialEndsAt })
      .from(agencyMembers)
      .innerJoin(agencies, eq(agencies.id, agencyMembers.agencyId))
      .where(eq(agencyMembers.userId, userId))
      .orderBy(agencies.createdAt),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role, access: accessState(r) }));
}

export const agencyNameSchema = z.string().trim().min(2).max(80);

export async function createAgency(userId: string, name: string): Promise<string> {
  const n = agencyNameSchema.parse(name);
  return withUser(userId, async (tx) => {
    const r = await tx.execute<{ id: string }>(sql`SELECT agency_create(${n}) AS id`);
    return r.rows[0].id;
  });
}

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, ""))
  .pipe(z.string().max(253).regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a website like example.com"));

export const newLocationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: domainSchema,
  serviceArea: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(80),
  country: z.enum(country.enumValues),
});
export type NewLocation = z.infer<typeof newLocationSchema>;

/** The search to track from day one: "<service> <city>", e.g. "collision repair ottawa". */
export function mainSearchFor(loc: Pick<NewLocation, "category" | "serviceArea">): string | null {
  const city = loc.serviceArea.split(",")[0];
  const parsed = keywordSchema.safeParse(`${loc.category} ${city}`);
  return parsed.success ? parsed.data : null;
}

/** Set up a new client location. Its numbers fill in with the next daily and weekly checks. */
export async function addLocation(userId: string, agencyId: string, input: NewLocation): Promise<string> {
  const loc = newLocationSchema.parse(input);
  const aid = z.uuid().parse(agencyId);
  const orgId = await withUser(userId, async (tx) => {
    const r = await tx.execute<{ id: string }>(
      sql`SELECT agency_add_location(${aid}, ${loc.name}, ${loc.website}, ${loc.serviceArea}, ${loc.category}, ${loc.country}::country) AS id`,
    );
    return r.rows[0].id;
  });
  const keyword = mainSearchFor(loc);
  if (keyword) await withOrg(userId, orgId, (tx) => addTrackedSearch(tx, orgId, keyword, loc.country as Country));
  // A first action plan from templates (no AI cost).
  await refreshPlan(orgId, (fn) => withOrg(userId, orgId, fn), null);
  return orgId;
}

// --- Connect codes: the owner's consent to be managed ------------------------

// Crockford base32 (no I, L, O, U): easy to read out over the phone.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 12 characters = 60 random bits, shown as XXXX-XXXX-XXXX. */
export function newConnectCode(): string {
  let s = "";
  for (let i = 0; i < 12; i++) s += ALPHABET[randomInt(32)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Canonical form for hashing: what people type, forgiving dashes, spaces and look-alikes. */
export function normalizeConnectCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

export class AgencyForbiddenError extends Error {}

/** The owner creates a code to give their agency. Only its hash is stored. */
export async function createConnectCode(tx: Tx, ctx: OrgContext): Promise<string> {
  if (ctx.role !== "owner") throw new AgencyForbiddenError();
  const code = newConnectCode();
  await tx.insert(agencyConnectCodes).values({
    orgId: ctx.orgId,
    codeHash: sha256Hex(normalizeConnectCode(code)!),
    createdByUserId: ctx.userId,
    expiresAt: new Date(Date.now() + CONNECT_CODE_TTL_DAYS * 24 * 60 * 60 * 1000),
  });
  await audit(tx, ctx, "agency.code_created");
  return code;
}

/** The agency enters the owner's code. Null for a wrong, used or expired code, or a location already managed. */
export async function connectLocation(userId: string, agencyId: string, code: string): Promise<string | null> {
  const aid = z.uuid().parse(agencyId);
  const canonical = normalizeConnectCode(code);
  if (!canonical) return null;
  return withUser(userId, async (tx) => {
    const r = await tx.execute<{ id: string | null }>(sql`SELECT agency_connect(${aid}, ${sha256Hex(canonical)}) AS id`);
    return r.rows[0]?.id ?? null;
  });
}

/** The agency's owner stops managing a location. */
export async function endLocation(userId: string, agencyId: string, orgId: string): Promise<boolean> {
  const aid = z.uuid().parse(agencyId);
  const oid = z.uuid().parse(orgId);
  return withUser(userId, async (tx) => {
    const r = await tx.execute<{ ok: boolean }>(sql`SELECT agency_end_location(${aid}, ${oid}) AS ok`);
    return Boolean(r.rows[0]?.ok);
  });
}

// --- The location's side -----------------------------------------------------

export type ManagingAgency = { name: string; planStatus: PlanStatus; trialEndsAt: Date; since: Date; createdByAgency: boolean };

/** The agency managing this location, if any. Must run inside withOrg() for `orgId`. */
export async function managingAgency(tx: Tx, orgId: string): Promise<ManagingAgency | null> {
  const [row] = await tx
    .select({
      name: agencies.name,
      planStatus: agencies.planStatus,
      trialEndsAt: agencies.trialEndsAt,
      since: agencyLocations.startedAt,
      createdByAgency: agencyLocations.createdByAgency,
    })
    .from(agencyLocations)
    .innerJoin(agencies, eq(agencies.id, agencyLocations.agencyId))
    .where(and(eq(agencyLocations.orgId, orgId), isNull(agencyLocations.endedAt)));
  return row ?? null;
}

/** Codes the owner created that are still usable (for "a code is waiting" on the Team page). */
export async function pendingConnectCode(tx: Tx, orgId: string): Promise<{ expiresAt: Date } | null> {
  const [row] = await tx
    .select({ expiresAt: agencyConnectCodes.expiresAt })
    .from(agencyConnectCodes)
    .where(and(eq(agencyConnectCodes.orgId, orgId), isNull(agencyConnectCodes.usedAt), sql`${agencyConnectCodes.expiresAt} > now()`))
    .orderBy(desc(agencyConnectCodes.expiresAt))
    .limit(1);
  return row ?? null;
}

/** The owner removes the agency's access. The database checks the caller is an owner. */
export async function endAgencyForOrg(tx: Tx, ctx: OrgContext): Promise<boolean> {
  if (ctx.role !== "owner") throw new AgencyForbiddenError();
  const r = await tx.execute<{ ok: boolean }>(sql`SELECT org_end_agency() AS ok`);
  return Boolean(r.rows[0]?.ok);
}

// --- The roll-up -------------------------------------------------------------

export type LocationRow = {
  orgId: string;
  name: string;
  domain: string | null;
  serviceArea: string | null;
  createdByAgency: boolean;
  hasOwner: boolean;
  since: Date;
  visibility: number | null;
  visibilityChange: number | null;
  mainSearch: string | null;
  mapRank: number | null;
  organicTrend: { from: number | null; to: number | null } | null;
  /** Places gained (+) or lost (−) on Google for the main search in the last 7 days. */
  weekChange: number | null;
  topics: { aligned: number; total: number } | null;
  openActions: number;
  lastChecked: string | null;
};

type LocationListRow = {
  org_id: string;
  name: string;
  website_domain: string | null;
  service_area: string | null;
  created_by_agency: boolean;
  started_at: Date | string;
  owners: number;
};

/** Every location the agency manages, with the headline numbers from each one's own dashboard. */
export async function agencyRollup(userId: string, agencyId: string): Promise<LocationRow[]> {
  const aid = z.uuid().parse(agencyId);
  const list = await withUser(userId, async (tx) => {
    const r = await tx.execute<LocationListRow>(sql`SELECT * FROM agency_locations_for(${aid})`);
    return r.rows;
  });
  const rows: LocationRow[] = [];
  // A few at a time: each one reads only its own org, through row-level security.
  for (let i = 0; i < list.length; i += 4) {
    const batch = await Promise.all(list.slice(i, i + 4).map((l) => locationRow(userId, l)));
    rows.push(...batch.filter((r): r is LocationRow => r !== null));
  }
  return rows;
}

const daysBefore = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Positions gained (+) or lost (−). Getting onto Google's first 100 from nowhere counts as a gain to the new spot. */
export function placesGained(before: number | null, now: number | null): number | null {
  if (now === null) return before === null ? null : -(101 - before);
  if (before === null) return 101 - now;
  return before - now;
}

async function locationRow(userId: string, l: LocationListRow): Promise<LocationRow | null> {
  return withOrg(userId, l.org_id, async (tx) => {
    const d = await loadDashboard(tx, l.org_id);
    const plan = (await loadPlan(tx, l.org_id))?.plan;
    const { searches } = await loadProgress(tx, l.org_id);
    const main = searches[0];
    const first = main?.history.find((c) => c.organicRank != null) ?? main?.history[0];
    const last = main?.now;
    return {
      orgId: l.org_id,
      name: l.name.replace(/\s*\(Demo\)$/, ""),
      domain: l.website_domain,
      serviceArea: l.service_area,
      createdByAgency: l.created_by_agency,
      hasOwner: l.owners > 0,
      since: new Date(l.started_at),
      visibility: d.visibilityNow,
      visibilityChange: d.visibilityChange,
      mainSearch: main?.keyword ?? null,
      mapRank: last?.mapRank ?? null,
      organicTrend: main && first && last ? { from: first.organicRank, to: last.organicRank } : null,
      weekChange: last ? placesGained(main.history.find((c) => c.day >= daysBefore(last.day, 7))?.organicRank ?? null, last.organicRank) : null,
      topics: plan ? { aligned: plan.topics.filter((t) => t.status === "aligned").length, total: plan.topics.length } : null,
      openActions: d.actions.length,
      lastChecked: last?.day ?? null,
    };
  }).catch((err) => {
    // Access ended between listing and reading (e.g. the owner just removed the agency).
    if (err instanceof NotMemberError) return null;
    throw err;
  });
}
