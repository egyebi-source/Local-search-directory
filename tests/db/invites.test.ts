import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { invites } from "@/server/db/schema";
import { createOrganization, NotMemberError, withOrg } from "@/server/db/tenant";
import { acceptInvite, inviteOrgName } from "@/server/org/invite-accept";
import { changeRole, createInvite, ForbiddenError, removeMember, revokeInvite, TeamRuleError } from "@/server/org/team";
import { sha256Hex } from "@/server/security/hash";
import { asOwner, createUser, hasDb } from "./helpers";

describe.runIf(hasDb)("invites and team rules", () => {
  let owner: { id: string; email: string };
  let orgId: string;

  beforeAll(async () => {
    owner = await createUser("owner");
    orgId = await createOrganization(owner.id, { name: "Acme Fab" });
  });

  const invite = (email: string, role: "owner" | "member" = "member") =>
    withOrg(owner.id, orgId, (tx, ctx) => createInvite(tx, ctx, { email, role }));

  it("stores only a hash of the invite token", async () => {
    const guest = await createUser("guest");
    const { inviteId, token } = await invite(guest.email);
    const [row] = await withOrg(owner.id, orgId, (tx) => tx.select().from(invites).where(eq(invites.id, inviteId)));
    expect(row.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("joins the invited user exactly once", async () => {
    const guest = await createUser("guest");
    const { token } = await invite(guest.email);
    expect(await inviteOrgName(token)).toBe("Acme Fab");
    expect(await acceptInvite(token, guest.id, guest.email)).toBe(orgId);
    // Single use: a second attempt fails, and the preview no longer works.
    expect(await acceptInvite(token, guest.id, guest.email)).toBeNull();
    expect(await inviteOrgName(token)).toBeNull();
    // The new member can now open the org.
    await expect(withOrg(guest.id, orgId, async (_tx, ctx) => ctx.role)).resolves.toBe("member");
  });

  it("rejects a different signed-in email than the one invited", async () => {
    const guest = await createUser("guest");
    const intruder = await createUser("intruder");
    const { token } = await invite(guest.email);
    expect(await acceptInvite(token, intruder.id, intruder.email)).toBeNull();
    await expect(withOrg(intruder.id, orgId, async () => 1)).rejects.toBeInstanceOf(NotMemberError);
  });

  it("rejects expired, revoked and unknown tokens", async () => {
    const guest = await createUser("guest");
    const expired = await invite(guest.email);
    await asOwner((c) =>
      c.query("UPDATE invites SET expires_at = now() - interval '1 minute' WHERE id = $1", [expired.inviteId]),
    );
    expect(await acceptInvite(expired.token, guest.id, guest.email)).toBeNull();

    const revoked = await invite(guest.email);
    await withOrg(owner.id, orgId, (tx, ctx) => revokeInvite(tx, ctx, revoked.inviteId));
    expect(await acceptInvite(revoked.token, guest.id, guest.email)).toBeNull();

    expect(await acceptInvite("A".repeat(43), guest.id, guest.email)).toBeNull();
  });

  it("only owners can invite or manage members", async () => {
    const member = await createUser("member");
    const { token } = await invite(member.email);
    await acceptInvite(token, member.id, member.email);
    await expect(
      withOrg(member.id, orgId, (tx, ctx) => createInvite(tx, ctx, { email: "z@example.test", role: "owner" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      withOrg(member.id, orgId, (tx, ctx) => removeMember(tx, ctx, owner.id)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("never leaves an organization without an owner", async () => {
    const soloOwner = await createUser("solo");
    const soloOrg = await createOrganization(soloOwner.id, { name: "Solo" });
    await expect(
      withOrg(soloOwner.id, soloOrg, (tx, ctx) => changeRole(tx, ctx, soloOwner.id, "member")),
    ).rejects.toMatchObject({ code: "last_owner" } satisfies Partial<TeamRuleError>);
    await expect(
      withOrg(soloOwner.id, soloOrg, (tx, ctx) => removeMember(tx, ctx, soloOwner.id)),
    ).rejects.toMatchObject({ code: "last_owner" });
  });

  it("refuses to invite someone who is already a member", async () => {
    await expect(invite(owner.email.toUpperCase())).rejects.toMatchObject({ code: "already_member" });
  });
});
