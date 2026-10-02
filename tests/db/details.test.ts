import { beforeAll, describe, expect, it } from "vitest";
import { auditLog, organizations, trackedSearches } from "@/server/db/schema";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { detailsSchema, updateDetails } from "@/server/org/details";
import { ForbiddenError } from "@/server/org/team";
import { createUser, hasDb } from "./helpers";

describe("business details input", () => {
  it("cleans the website and requires every field", () => {
    expect(detailsSchema.parse({ name: "Kolar Auto Collision", website: "https://www.KolarAuto.ca/home", category: "Collision repair", serviceArea: "Brampton, ON" }).website).toBe("kolarauto.ca");
    expect(detailsSchema.safeParse({ name: "K", website: "x", category: "c", serviceArea: "" }).success).toBe(false);
  });
});

describe.runIf(hasDb)("business details", () => {
  let owner: { id: string };
  let orgId: string;
  beforeAll(async () => {
    owner = await createUser("details");
    orgId = await createOrganization(owner.id, { name: "Kolar Auto Collison", websiteDomain: "mechanicar.com", category: "Collision repair", serviceArea: "Brampton, ON", country: "CA" });
  });

  it("an owner corrects the website and service; the new main search is tracked and the change is logged without values", async () => {
    const changed = await withOrg(owner.id, orgId, (tx) =>
      updateDetails(tx, { orgId, userId: owner.id, role: "owner" }, { name: "Kolar Auto Collision", website: "kolarauto.ca", category: "Auto body shop", serviceArea: "Brampton, ON" }),
    );
    expect(changed).toEqual(["name", "website", "category"]);
    const [o] = await withOrg(owner.id, orgId, (tx) => tx.select().from(organizations));
    expect(o).toMatchObject({ name: "Kolar Auto Collision", websiteDomain: "kolarauto.ca", category: "Auto body shop" });
    const searches = await withOrg(owner.id, orgId, (tx) => tx.select({ k: trackedSearches.keyword }).from(trackedSearches));
    expect(searches.map((s) => s.k)).toContain("collision repair brampton");
    const log = (await withOrg(owner.id, orgId, (tx) => tx.select().from(auditLog))).find((l) => l.action === "business.details_changed")!;
    expect(log.metadataJson).toEqual({ fields: ["name", "website", "category"] });
    expect(JSON.stringify(log.metadataJson)).not.toContain("kolarauto");
  });

  it("members can't change them", async () => {
    await expect(
      withOrg(owner.id, orgId, (tx) => updateDetails(tx, { orgId, userId: owner.id, role: "member" }, { name: "X Shop", website: "x.com", category: "Collision repair", serviceArea: "Brampton" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
