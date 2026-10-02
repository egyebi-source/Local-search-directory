import "server-only";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { pricing } from "@/server/db/schema";
import { withUser } from "@/server/db/tenant";

// Prices (US dollars, in cents). Editable by staff in /admin; every change
// is audited. When card billing is added, a change applies to new
// subscriptions; existing subscribers keep their price unless moved.

export type Pricing = { monthlyCents: number; annualCents: number; agencyCents: number; agencyMinLocations: number };

/** Used only if the database can't be read, so the site never shows a blank price. */
export const DEFAULT_PRICING: Pricing = { monthlyCents: 3999, annualCents: 39900, agencyCents: 2999, agencyMinLocations: 5 };

export async function getPricing(): Promise<Pricing> {
  try {
    const [row] = await getDb().select().from(pricing).where(eq(pricing.id, 1));
    return row
      ? { monthlyCents: row.monthlyCents, annualCents: row.annualCents, agencyCents: row.agencyCents, agencyMinLocations: row.agencyMinLocations }
      : DEFAULT_PRICING;
  } catch {
    return DEFAULT_PRICING;
  }
}

/** 3999 -> "$39.99", 39900 -> "$399". */
export function usd(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** Months the annual plan saves vs paying monthly, rounded down (e.g. 2). */
export function monthsFree(p: Pricing): number {
  return Math.max(0, Math.floor((p.monthlyCents * 12 - p.annualCents) / p.monthlyCents));
}

const dollars = z.coerce
  .number()
  .finite()
  .min(1)
  .max(10_000)
  .transform((n) => Math.round(n * 100));

export const pricingFormSchema = z.object({
  monthly: dollars,
  annual: dollars,
  agency: dollars,
  agencyMin: z.coerce.number().int().min(1).max(100),
  reason: z.string().trim().min(5).max(300),
});

export async function setPricing(adminId: string, input: z.infer<typeof pricingFormSchema>): Promise<void> {
  await withUser(adminId, (tx) =>
    tx.execute(sql`SELECT admin_set_pricing(${input.monthly}, ${input.annual}, ${input.agency}, ${input.agencyMin}, ${input.reason})`),
  );
}
