import { beforeAll, describe, expect, it } from "vitest";
import {
  addLocation,
  agencyRollup,
  connectLocation,
  createAgency,
  createConnectCode,
  endAgencyForOrg,
  endLocation,
  listMyAgencies,
  mainSearchFor,
  placesGained,
  managingAgency,
  newConnectCode,
  normalizeConnectCode,
  AgencyForbiddenError,
} from "@/server/agency/agency";
import { agencies, agencyLocations, agencyMembers, organizations, trackedSearches } from "@/server/db/schema";
import { createOrganization, NotMemberError, withOrg, withUser } from "@/server/db/tenant";
import { createInvite, ForbiddenError, removeMember } from "@/server/org/team";
import { asAppUserRaw, asOwner, createUser, expectDbError, hasDb } from "./helpers";

const shop = { name: "Kanata Auto Body", website: "https://www.kanataautobody.test/home", serviceArea: "Kanata, ON", category: "Collision repair", country: "CA" as const };

describe("connect codes", () => {
  it("are 12 readable characters and forgive dashes, spaces, case and look-alikes", () => {
    const code = newConnectCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normalizeConnectCode(code.toLowerCase().replaceAll("-", " "))).toBe(code.replaceAll("-", ""));
    expect(normalizeConnectCode("ABCD-EFGH-JK0O")).toBe("ABCDEFGHJK00");
    expect(normalizeConnectCode("abcd-efgh-jkil")).toBe("ABCDEFGHJK11");
    expect(normalizeConnectCode("too-short")).toBeNull();
    expect(normalizeConnectCode("'; DROP TABLE x; --")).toBeNull();
  });
  it("weekly movement counts places gained or lost on Google", () => {
    expect(placesGained(11, 13)).toBe(-2);
    expect(placesGained(22, 7)).toBe(15);
    expect(placesGained(null, 40)).toBe(61);
    expect(placesGained(95, null)).toBe(-6);
    expect(placesGained(null, null)).toBeNull();
  });
  it("the first search to track comes from the service and city", () => {
    expect(mainSearchFor({ category: "Collision repair", serviceArea: "Kanata, ON" })).toBe("collision repair kanata");
  });
});

describe.runIf(hasDb)("agencies (PRD Module 11)", () => {
  let sam: { id: string }; // agency owner
  let kim: { id: string }; // agency staff
  let eve: { id: string }; // owner of a different agency
  let dana: { id: string }; // owner of an existing shop
  let mo: { id: string }; // member (not owner) of Dana's shop
  let agency: string;
  let otherAgency: string;
  let created: string; // location the agency set up
  let danaShop: string;

  beforeAll(async () => {
    [sam, kim, eve, dana, mo] = await Promise.all(["sam", "kim", "eve", "dana", "mo"].map(createUser));
    agency = await createAgency(sam.id, "Northside Marketing");
    otherAgency = await createAgency(eve.id, "Rival Agency");
    await asOwner((c) => c.query("INSERT INTO agency_members (agency_id, user_id, role) VALUES ($1, $2, 'staff')", [agency, kim.id]));
    created = await addLocation(sam.id, agency, shop);
    danaShop = await createOrganization(dana.id, { name: "Dana's Collision" });
    await asOwner((c) => c.query("INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'member')", [danaShop, mo.id]));
  });

  it("creating an agency makes you its owner; your list shows only your agencies", async () => {
    const mine = await listMyAgencies(sam.id);
    expect(mine.map((a) => [a.name, a.role])).toEqual([["Northside Marketing", "owner"]]);
    expect(mine[0].access.kind).toBe("trialing");
    expect((await listMyAgencies(kim.id)).map((a) => a.role)).toEqual(["staff"]);
    expect((await listMyAgencies(dana.id))).toEqual([]);
  });

  it("a location the agency adds is its own organization, set up and tracked, with no owner yet", async () => {
    await withOrg(sam.id, created, async (tx, ctx) => {
      expect(ctx.role).toBe("agency");
      const [org] = await tx.select().from(organizations);
      expect(org).toMatchObject({ id: created, name: "Kanata Auto Body", websiteDomain: "kanataautobody.test", serviceArea: "Kanata, ON" });
      expect((await tx.select().from(trackedSearches)).map((t) => t.keyword)).toEqual(["collision repair kanata"]);
      expect(await managingAgency(tx, created)).toMatchObject({ name: "Northside Marketing", createdByAgency: true });
    });
  });

  it("for a location it set up, with no owner yet, the agency can invite the business owner", async () => {
    await withOrg(sam.id, created, async (tx, ctx) => {
      await expect(createInvite(tx, ctx, { email: "boss@kanataautobody.test", role: "owner" })).resolves.toMatchObject({ token: expect.any(String) });
    });
  });

  it("agency staff can open the agency's locations too; nobody else can", async () => {
    expect(await withOrg(kim.id, created, async (_tx, ctx) => ctx.role)).toBe("agency");
    await expect(withOrg(eve.id, created, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
    await expect(withOrg(dana.id, created, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
    // And the agency can't open a shop that never gave it access.
    await expect(withOrg(sam.id, danaShop, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
  });

  it("an agency can't add locations to someone else's agency", async () => {
    await expectDbError(addLocation(eve.id, agency, { ...shop, name: "Sneaky" }), /not on this agency/);
  });

  it("only the shop's owner can create a connect code; a code works once, for one agency", async () => {
    await expect(withOrg(mo.id, danaShop, (tx, ctx) => createConnectCode(tx, ctx))).rejects.toBeInstanceOf(AgencyForbiddenError);
    const code = await withOrg(dana.id, danaShop, (tx, ctx) => createConnectCode(tx, ctx));

    expect(await connectLocation(sam.id, agency, "ZZZZ-ZZZZ-ZZZZ")).toBeNull();
    expect(await connectLocation(sam.id, agency, code.toLowerCase())).toBe(danaShop);
    expect(await connectLocation(eve.id, otherAgency, code)).toBeNull();
    expect(await withOrg(sam.id, danaShop, async (_tx, ctx) => ctx.role)).toBe("agency");
    // Members keep their own role; the agency doesn't replace anyone.
    expect(await withOrg(dana.id, danaShop, async (_tx, ctx) => ctx.role)).toBe("owner");
  });

  it("a shop already managed can't be taken by a second agency, even with a fresh code", async () => {
    const code = await withOrg(dana.id, danaShop, (tx, ctx) => createConnectCode(tx, ctx));
    expect(await connectLocation(eve.id, otherAgency, code)).toBeNull();
  });

  it("an agency can invite members to a business that has an owner, but not owners, and can't change the team", async () => {
    await withOrg(sam.id, danaShop, async (tx, ctx) => {
      // Dana's shop already has an owner: the agency may invite members, never another owner.
      await expect(createInvite(tx, ctx, { email: "sam@agency.test", role: "owner" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createInvite(tx, ctx, { email: "helper@agency.test", role: "member" })).resolves.toMatchObject({ token: expect.any(String) });
      await expect(removeMember(tx, ctx, dana.id)).rejects.toBeInstanceOf(ForbiddenError);
    });
  });

  it("the roll-up shows each location's own numbers, read through its own row-level security", async () => {
    const rows = await agencyRollup(sam.id, agency);
    expect(rows.map((r) => r.name).sort()).toEqual(["Dana's Collision", "Kanata Auto Body"]);
    expect(rows.find((r) => r.orgId === created)).toMatchObject({ hasOwner: false, createdByAgency: true, mainSearch: "collision repair kanata" });
    await expectDbError(agencyRollup(eve.id, agency), /not on this agency/);
  });

  it("row-level security: each side sees only its own agency rows", async () => {
    await withUser(eve.id, async (tx) => {
      expect((await tx.select().from(agencies)).map((a) => a.id)).toEqual([otherAgency]);
      expect(await tx.select().from(agencyLocations)).toEqual([]);
      expect((await tx.select().from(agencyMembers)).map((m) => m.userId)).toEqual([eve.id]);
    });
    await withOrg(dana.id, danaShop, async (tx) => {
      expect((await tx.select().from(agencies)).map((a) => a.name)).toEqual(["Northside Marketing"]);
      expect((await tx.select().from(agencyLocations)).map((l) => l.orgId)).toEqual([danaShop]);
      // A location doesn't see the agency's team or other clients.
      expect(await tx.select().from(agencyMembers)).toEqual([]);
    });
  });

  it("the app role can't write agency tables or call the internal access checks directly", async () => {
    await asAppUserRaw(async (c) => {
      await expect(c.query("INSERT INTO agency_locations (id, agency_id, org_id, created_by_agency) VALUES (gen_random_uuid(), $1, $2, false)", [otherAgency, danaShop])).rejects.toThrow(/permission denied/);
      await expect(c.query("INSERT INTO agency_members (agency_id, user_id, role) VALUES ($1, $2, 'owner')", [agency, eve.id])).rejects.toThrow(/permission denied/);
      await expect(c.query("UPDATE agencies SET plan_status = 'active'")).rejects.toThrow(/permission denied/);
      await expect(c.query("SELECT org_has_access($1)", [danaShop])).rejects.toThrow(/permission denied/);
      await expect(c.query("SELECT agency_has_access($1)", [agency])).rejects.toThrow(/permission denied/);
    });
  });

  it("a location covered by its agency keeps getting its daily checks", async () => {
    const due = await asOwner((c) => c.query("SELECT org_has_access($1) AS ok", [created]));
    expect(due.rows[0].ok).toBe(true);
  });

  it("staff can't stop managing a location; only the agency's owner can", async () => {
    await expectDbError(endLocation(kim.id, agency, created), /agency owners only/);
  });

  it("the shop's owner can remove the agency, which loses access at once", async () => {
    await expect(withOrg(mo.id, danaShop, (tx, ctx) => endAgencyForOrg(tx, ctx))).rejects.toBeInstanceOf(AgencyForbiddenError);
    expect(await withOrg(dana.id, danaShop, (tx, ctx) => endAgencyForOrg(tx, ctx))).toBe(true);
    await expect(withOrg(sam.id, danaShop, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
    // Dana keeps her account and data.
    expect(await withOrg(dana.id, danaShop, async (_tx, ctx) => ctx.role)).toBe("owner");
  });

  it("when an agency stops managing a location nobody else belongs to, it's locked for deletion", async () => {
    const extra = await addLocation(sam.id, agency, { ...shop, name: "Short-lived Shop" });
    expect(await endLocation(sam.id, agency, extra)).toBe(true);
    const r = await asOwner((c) => c.query("SELECT plan_status, delete_after IS NOT NULL AS scheduled FROM organizations WHERE id = $1", [extra]));
    expect(r.rows[0]).toEqual({ plan_status: "locked", scheduled: true });
    await expect(withOrg(sam.id, extra, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
  });

  it("a free trial covers up to 10 locations", async () => {
    const trial = await createAgency(eve.id, "Trial Agency");
    for (let i = 0; i < 10; i++) await addLocation(eve.id, trial, { ...shop, name: `Shop ${i}` });
    await expectDbError(addLocation(eve.id, trial, { ...shop, name: "Shop 11" }), /location limit/);
  });

  it("when the agency's trial ends unpaid, it can't open or add locations, and its locations stop being covered", async () => {
    await asOwner((c) => c.query("UPDATE agencies SET trial_ends_at = now() - interval '1 day' WHERE id = $1", [agency]));
    await expect(withOrg(sam.id, created, async () => "leak")).rejects.toBeInstanceOf(NotMemberError);
    await expectDbError(addLocation(sam.id, agency, { ...shop, name: "Another" }), /agency locked/);
    const r = await asOwner((c) => c.query("SELECT org_has_access($1) AS ok", [created]));
    expect(r.rows[0].ok).toBe(false);
    await asOwner((c) => c.query("UPDATE agencies SET trial_ends_at = now() + interval '14 days' WHERE id = $1", [agency]));
  });
});
