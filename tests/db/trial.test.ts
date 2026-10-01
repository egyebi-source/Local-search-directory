import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { accessState } from "@/server/billing/access";
import { organizations } from "@/server/db/schema";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { asOwner, createUser, expectDbError, hasDb } from "./helpers";

describe.runIf(hasDb)("trial and billing state", () => {
  let owner: { id: string };
  let orgId: string;

  beforeAll(async () => {
    owner = await createUser("trial");
    orgId = await createOrganization(owner.id, {
      name: "Torque Collision",
      websiteDomain: "torquecollision.example.com",
      serviceArea: "Ottawa, ON",
      category: "Collision repair",
      primaryGoal: "calls",
      adSpendRange: "500_2000",
      websiteManager: "agency",
    });
  });

  const readOrg = () =>
    withOrg(owner.id, orgId, async (tx) => (await tx.select().from(organizations).where(eq(organizations.id, orgId)))[0]);

  it("stores the gate answers and starts a 7-day trial", async () => {
    const org = await readOrg();
    expect(org).toMatchObject({ primaryGoal: "calls", adSpendRange: "500_2000", websiteManager: "agency", planStatus: "trialing" });
    const days = (org.trialEndsAt.getTime() - org.createdAt.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(7, 2);
    expect(accessState(org)).toEqual({ kind: "trialing", daysLeft: 7 });
  });

  it("the app role cannot extend a trial or mark an org as paid", async () => {
    await expectDbError(
      withOrg(owner.id, orgId, (tx) =>
        tx.update(organizations).set({ trialEndsAt: new Date(Date.now() + 365 * 86_400_000) }).where(eq(organizations.id, orgId)),
      ),
      /permission denied/,
    );
    await expectDbError(
      withOrg(owner.id, orgId, (tx) => tx.update(organizations).set({ planStatus: "active" }).where(eq(organizations.id, orgId))),
      /permission denied/,
    );
    // Descriptive fields stay editable.
    await withOrg(owner.id, orgId, (tx) => tx.update(organizations).set({ name: "Torque Collision Ltd" }).where(eq(organizations.id, orgId)));
    expect((await readOrg()).name).toBe("Torque Collision Ltd");
  });

  it("the app role cannot create an org that starts out paid", async () => {
    await expectDbError(
      withOrg(owner.id, orgId, (tx) =>
        tx.insert(organizations).values({ id: orgId.replace(/.$/, "0"), name: "Free ride", planStatus: "active" }),
      ),
      /permission denied/,
    );
  });

  it("locks once the trial end passes", async () => {
    await asOwner((c) => c.query("UPDATE organizations SET trial_ends_at = now() - interval '1 second' WHERE id = $1", [orgId]));
    expect(accessState(await readOrg())).toEqual({ kind: "locked" });
  });
});
