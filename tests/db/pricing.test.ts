import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminAuditRecent } from "@/server/admin/admin";
import { getPricing, monthsFree, pricingFormSchema, setPricing, usd } from "@/server/billing/pricing";
import { pricing } from "@/server/db/schema";
import { withUser } from "@/server/db/tenant";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

describe("price formatting", () => {
  it("shows cents only when needed", () => {
    expect(usd(3999)).toBe("$39.99");
    expect(usd(39900)).toBe("$399");
    expect(monthsFree({ monthlyCents: 3999, annualCents: 39900, agencyCents: 2999, agencyMinLocations: 5 })).toBe(2);
  });
  it("the admin form takes dollars and stores cents", () => {
    expect(pricingFormSchema.parse({ monthly: "39.99", annual: "399", agency: "29.99", agencyMin: "5", reason: "Launch pricing" })).toMatchObject({
      monthly: 3999, annual: 39900, agency: 2999, agencyMin: 5,
    });
    expect(pricingFormSchema.safeParse({ monthly: "-1", annual: "399", agency: "29.99", agencyMin: "5", reason: "x" }).success).toBe(false);
  });
});

describe.runIf(hasDb)("pricing in the admin console", () => {
  let admin: { id: string };
  let customer: { id: string };
  const valid = { monthly: 4499, annual: 44900, agency: 3299, agencyMin: 3, reason: "Price test" };

  beforeAll(async () => {
    admin = await createUser("price-admin");
    customer = await createUser("price-customer");
    await asOwner((c) => c.query("INSERT INTO platform_admins (user_id) VALUES ($1)", [admin.id]));
  });
  afterAll(() =>
    asOwner((c) => c.query("UPDATE pricing SET monthly_cents = 3999, annual_cents = 39900, agency_cents = 2999, agency_min_locations = 5")),
  );

  it("starts at $39.99/month and $399/year", async () => {
    expect(await getPricing()).toEqual({ monthlyCents: 3999, annualCents: 39900, agencyCents: 2999, agencyMinLocations: 5 });
  });

  it("an admin can change prices, with the change logged", async () => {
    await setPricing(admin.id, valid);
    expect(await getPricing()).toEqual({ monthlyCents: 4499, annualCents: 44900, agencyCents: 3299, agencyMinLocations: 3 });
    const [entry] = await adminAuditRecent(admin.id, 1);
    expect(entry).toMatchObject({ action: "pricing.changed", reason: "Price test" });
    expect(entry.details).toMatchObject({ to: { monthly: 4499, annual: 44900 } });
  });

  it("customers can't change prices, directly or through the function", async () => {
    await expectDbError(setPricing(customer.id, valid), /not a platform admin/);
    await expectDbError(withUser(customer.id, (tx) => tx.update(pricing).set({ monthlyCents: 1 })), /permission denied/);
  });

  it("rejects prices that don't make sense", async () => {
    await expectDbError(setPricing(admin.id, { ...valid, annual: 60000 }), /annual price/); // more than 12 months
    await expectDbError(setPricing(admin.id, { ...valid, agency: 5000 }), /agency price/); // above monthly
    await expectDbError(setPricing(admin.id, { ...valid, monthly: 50 }), /monthly price/);
    await expectDbError(setPricing(admin.id, { ...valid, reason: " " }), /reason required/);
    await expectDbError(withUser(admin.id, (tx) => tx.execute(sql`INSERT INTO pricing (id, monthly_cents, annual_cents, agency_cents, agency_min_locations) VALUES (2, 1, 1, 1, 1)`)), /permission denied/);
  });
});
