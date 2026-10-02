import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { t } from "@/lib/i18n/en";
import { withCurrentOrg } from "@/server/org/current";
import { managingAgency, pendingConnectCode } from "@/server/agency/agency";
import { canInvite, listMembers, listPendingInvites } from "@/server/org/team";
import { changeRoleAction, endAgencyAction, removeMemberAction, revokeInviteAction } from "../actions";
import { AgencyCodeButton } from "./agency-code";
import { InviteForm } from "./invite-form";

const fmt = (d: Date) => d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

const ERRORS: Record<string, string> = {
  owners_only: t.team.ownersOnly,
  last_owner: t.team.errors.lastOwner,
};

export default async function TeamPage({ searchParams }: PageProps<"/app/team">) {
  const { error } = await searchParams;
  const { members, invites, agency, code, ctx } = await withCurrentOrg(async (tx, ctx) => ({
    members: await listMembers(tx, ctx),
    invites: canInvite(ctx) ? await listPendingInvites(tx, ctx) : [],
    agency: await managingAgency(tx, ctx.orgId),
    code: ctx.role === "owner" ? await pendingConnectCode(tx, ctx.orgId) : null,
    ctx,
  }));
  const isOwner = ctx.role === "owner";
  const mayInvite = canInvite(ctx);
  const errorMessage = typeof error === "string" ? ERRORS[error] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t.team.title}</h1>
      {errorMessage ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {errorMessage}
        </p>
      ) : null}

      <Card className="flex flex-col gap-3">
        <CardTitle>{t.team.members}</CardTitle>
        <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 py-2">
              <span className="min-w-0 flex-1 break-words">
                {m.name ? `${m.name} · ` : ""}
                {m.email} {m.userId === ctx.userId ? t.team.you : ""}
              </span>
              <span className="text-sm opacity-70">
                {m.role === "owner" ? t.common.owner : t.common.member}
              </span>
              {isOwner && m.userId !== ctx.userId ? (
                <>
                  <form action={changeRoleAction}>
                    <input type="hidden" name="userId" value={m.userId} />
                    <input type="hidden" name="role" value={m.role === "owner" ? "member" : "owner"} />
                    <Button type="submit" size="sm" variant="outline">
                      {m.role === "owner" ? t.team.makeMember : t.team.makeOwner}
                    </Button>
                  </form>
                  <form action={removeMemberAction}>
                    <input type="hidden" name="userId" value={m.userId} />
                    <Button type="submit" size="sm" variant="destructive">
                      {t.team.remove}
                    </Button>
                  </form>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Agency access</CardTitle>
        {agency ? (
          <>
            <p className="text-sm">
              <strong>{agency.name}</strong> has managed this account since {fmt(agency.since)}
              {agency.createdByAgency ? " (they set it up)" : ""}. They can see and work on everything here, except billing and your
              team&apos;s roles. Your data stays yours.
            </p>
            {isOwner ? (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Remove agency access</summary>
                <form action={endAgencyAction} className="mt-3 flex flex-col gap-2">
                  <p className="opacity-80">
                    {agency.name} will lose access right away. If they were paying for this account, you&apos;ll need your own plan to keep
                    using it.
                  </p>
                  <Button type="submit" variant="destructive" size="sm" className="self-start">
                    Remove {agency.name}
                  </Button>
                </form>
              </details>
            ) : null}
          </>
        ) : isOwner ? (
          <>
            <p className="text-sm opacity-80">
              Working with a marketing agency? Create a one-time code and give it to them. They&apos;ll be able to see and work on this
              account (not billing or your team). You can remove them here at any time.
            </p>
            {code ? <p className="text-sm opacity-70">An unused code is waiting until {fmt(code.expiresAt)}. A new code works too.</p> : null}
            <AgencyCodeButton />
          </>
        ) : (
          <p className="text-sm opacity-70">No agency manages this account.</p>
        )}
      </Card>

      {mayInvite ? (
        <>
          <Card className="flex flex-col gap-3">
            <CardTitle>{t.team.inviteTitle}</CardTitle>
            {ctx.role === "agency" ? (
              <p className="text-sm opacity-80">Invite the business owner as an Owner so they can sign in and see their own results.</p>
            ) : null}
            <p className="text-sm opacity-80">{t.team.inviteBody}</p>
            <InviteForm />
          </Card>

          <Card className="flex flex-col gap-3">
            <CardTitle>{t.team.invitesTitle}</CardTitle>
            {invites.length === 0 ? (
              <p className="text-sm opacity-70">{t.team.noInvites}</p>
            ) : (
              <ul className="divide-y divide-neutral-200 dark:divide-neutral-800">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 break-words">{i.email}</span>
                    <span className="text-sm opacity-70">
                      {i.role === "owner" ? t.common.owner : t.common.member} · {t.team.expires}{" "}
                      {i.expiresAt.toISOString().slice(0, 10)}
                    </span>
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="inviteId" value={i.id} />
                      <Button type="submit" size="sm" variant="outline">
                        {t.team.revoke}
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <p className="text-sm opacity-70">{t.team.ownersOnly}</p>
      )}
    </div>
  );
}
