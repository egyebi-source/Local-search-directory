"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { httpTransport } from "@/server/dataforseo/client";
import { findBusiness, type BusinessListing } from "@/server/dataforseo/market";
import { serverEnv } from "@/server/env";
import { z } from "zod";
import {
  addLocation,
  connectLocation,
  prepareLocation,
  createAgency,
  endLocation,
  listMyAgencies,
  newLocationSchema,
} from "@/server/agency/agency";
import { NotMemberError, withOrg } from "@/server/db/tenant";
import { requireUser, setCurrentOrgCookie } from "@/server/org/current";
import { consumeRateLimit, RATE_LIMITS } from "@/server/security/rate-limit";

export type AgencyState = { error?: string; ok?: string };

/** The database's own rule messages (agency_* functions), in plain English. */
function dbRule(err: unknown): string | null {
  const msg = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error)?.message ?? "";
  if (msg.includes("location limit")) return "You've reached the number of locations your plan allows. Free trials cover up to 10.";
  if (msg.includes("agency locked")) return "Your agency's trial has ended. Choose a plan to keep adding locations.";
  if (msg.includes("agency limit")) return "You already own the maximum number of agencies.";
  if (msg.includes("not on this agency") || msg.includes("agency owners only")) return "You don't have permission to do that.";
  return null;
}

/** The agency id from the form, only if the user is on its team. */
async function myAgency(userId: string, form: FormData) {
  const id = z.uuid().safeParse(form.get("agencyId"));
  if (!id.success) return null;
  return (await listMyAgencies(userId)).find((a) => a.id === id.data) ?? null;
}

export async function createAgencyAction(_prev: AgencyState, form: FormData): Promise<AgencyState> {
  const user = await requireUser();
  const name = z.string().trim().min(2).max(80).safeParse(form.get("name"));
  if (!name.success) return { error: "Enter your agency's name (2 to 80 characters)." };
  if (!(await consumeRateLimit(RATE_LIMITS.agencyCreatePerUser, user.id))) return { error: "Too many attempts today. Try again tomorrow." };
  try {
    await createAgency(user.id, name.data);
  } catch (err) {
    const rule = dbRule(err);
    if (rule) return { error: rule };
    throw err;
  }
  revalidatePath("/agency");
  redirect("/agency");
}

export type FindState = { error?: string; listings?: BusinessListing[]; searched?: boolean };

/** Step 1 of adding a location: find the business on Google Maps so the right website and category are used. */
export async function findListingAction(_prev: FindState, form: FormData): Promise<FindState> {
  const user = await requireUser();
  const agency = await myAgency(user.id, form);
  if (!agency) return { error: "You don't have permission to do that." };
  const parsed = z
    .object({ name: z.string().trim().min(2).max(120), city: z.string().trim().min(2).max(120), country: z.enum(["CA", "US"]) })
    .safeParse({ name: form.get("name"), city: form.get("serviceArea"), country: form.get("country") });
  if (!parsed.success) return { error: "Enter the business name and city first." };
  if (!(await consumeRateLimit({ name: "agency-find:user", limit: 60, windowSeconds: 24 * 60 * 60 }, user.id))) {
    return { error: "That's a lot of lookups for one day. Enter the details yourself below." };
  }
  try {
    const listings = await findBusiness(httpTransport, parsed.data.name, parsed.data.city, parsed.data.country);
    return { listings, searched: true };
  } catch {
    return { error: "We couldn't reach Google Maps just now. Enter the details yourself below, or try again.", searched: true };
  }
}

export async function addLocationAction(_prev: AgencyState, form: FormData): Promise<AgencyState> {
  const user = await requireUser();
  const agency = await myAgency(user.id, form);
  if (!agency) return { error: "You don't have permission to do that." };
  const parsed = newLocationSchema.safeParse({
    name: form.get("name"),
    website: form.get("website"),
    serviceArea: form.get("serviceArea"),
    category: form.get("category"),
    country: form.get("country"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "website" ? "Enter the website like example.com." : "Fill in every field (2 characters or more)." };
  }
  if (!(await consumeRateLimit(RATE_LIMITS.agencyAddPerAgency, agency.id))) return { error: "That's a lot of new locations for one day. Try again tomorrow." };
  let orgId: string;
  try {
    orgId = await addLocation(user.id, agency.id, parsed.data);
  } catch (err) {
    const rule = dbRule(err);
    if (rule) return { error: rule };
    throw err;
  }
  // First Google Maps check, site scan and action plan, after the response.
  after(() => prepareLocation(user.id, orgId, { dataforseo: httpTransport, dataSource: serverEnv().DATAFORSEO_MODE }));
  revalidatePath("/agency");
  return { ok: `${parsed.data.name} was added. Its first Google check and action plan will be ready in about a minute.` };
}

export async function connectLocationAction(_prev: AgencyState, form: FormData): Promise<AgencyState> {
  const user = await requireUser();
  const agency = await myAgency(user.id, form);
  if (!agency) return { error: "You don't have permission to do that." };
  const code = z.string().trim().max(40).safeParse(form.get("code"));
  if (!code.success) return { error: "Enter the code the business owner gave you." };
  if (!(await consumeRateLimit(RATE_LIMITS.agencyConnectPerUser, user.id))) return { error: "Too many attempts. Try again in an hour." };
  let orgId: string | null;
  try {
    orgId = await connectLocation(user.id, agency.id, code.data);
  } catch (err) {
    const rule = dbRule(err);
    if (rule) return { error: rule };
    throw err;
  }
  // One message for every failure, so a code can't be used to learn anything.
  if (!orgId) return { error: "That code didn't work. Codes last 7 days and work once; ask the owner for a new one." };
  revalidatePath("/agency");
  return { ok: "Connected. The location now appears in your list." };
}

/** Open a location's dashboard. withOrg() re-checks access; the cookie is only a preference. */
export async function openLocationAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const orgId = z.uuid().safeParse(form.get("orgId"));
  if (!orgId.success) return;
  try {
    await withOrg(user.id, orgId.data, async () => undefined);
  } catch (err) {
    if (err instanceof NotMemberError) redirect("/agency");
    throw err;
  }
  await setCurrentOrgCookie(orgId.data);
  redirect("/app");
}

export async function endLocationAction(form: FormData): Promise<void> {
  const user = await requireUser();
  const agency = await myAgency(user.id, form);
  const orgId = z.uuid().safeParse(form.get("orgId"));
  if (!agency || agency.role !== "owner" || !orgId.success) return;
  await endLocation(user.id, agency.id, orgId.data);
  revalidatePath("/agency");
}
