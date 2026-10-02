import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { mainSearchFor } from "@/server/agency/agency";
import { organizations, type Country } from "@/server/db/schema";
import type { OrgContext, Tx } from "@/server/db/tenant";
import { audit } from "@/server/org/audit";
import { addTrackedSearch, TrackingLimitError } from "@/server/tracking/checks";
import { ForbiddenError } from "@/server/org/team";

// Business details (name, website, main service, city). Owners and the
// managing agency can correct them, e.g. when the website on file turns out
// to be a directory. The database only lets the app change these
// descriptive columns, never billing state.

export const detailsSchema = z.object({
  name: z.string().trim().min(2).max(120),
  website: z
    .string()
    .trim()
    .max(253)
    .transform((v, ctx) => {
      const d = normalizeDomain(v);
      if (!d) {
        ctx.addIssue({ code: "custom", message: "website" });
        return z.NEVER;
      }
      return d;
    }),
  category: z.string().trim().min(2).max(80),
  serviceArea: z.string().trim().min(2).max(120),
});
export type BusinessDetails = z.infer<typeof detailsSchema>;

export const canEditDetails = (ctx: Pick<OrgContext, "role">) => ctx.role === "owner" || ctx.role === "agency";

export async function loadDetails(tx: Tx, orgId: string) {
  const [o] = await tx
    .select({ name: organizations.name, website: organizations.websiteDomain, category: organizations.category, serviceArea: organizations.serviceArea, country: organizations.country })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return o ?? null;
}

/** Save the details; a new service or city also starts tracking its main search. Returns what changed. */
export async function updateDetails(tx: Tx, ctx: OrgContext, input: BusinessDetails): Promise<string[]> {
  if (!canEditDetails(ctx)) throw new ForbiddenError();
  const before = await loadDetails(tx, ctx.orgId);
  if (!before) throw new ForbiddenError();
  const changed = (["name", "website", "category", "serviceArea"] as const).filter((k) => (before[k] ?? "") !== input[k]);
  if (!changed.length) return [];
  await tx
    .update(organizations)
    .set({ name: input.name, websiteDomain: input.website, category: input.category, serviceArea: input.serviceArea })
    .where(eq(organizations.id, ctx.orgId));
  if (changed.includes("category") || changed.includes("serviceArea")) {
    const keyword = before.serviceArea === "Nationwide" ? null : mainSearchFor({ category: input.category, serviceArea: input.serviceArea });
    if (keyword) {
      try {
        await addTrackedSearch(tx, ctx.orgId, keyword, (before.country ?? "CA") as Country);
      } catch (err) {
        if (!(err instanceof TrackingLimitError)) throw err;
      }
    }
  }
  // Field names only: the values themselves stay out of the log.
  await audit(tx, ctx, "business.details_changed", { fields: changed });
  return changed;
}
