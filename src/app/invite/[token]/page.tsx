import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n/en";
import { auth } from "@/server/auth";
import { inviteOrgName } from "@/server/org/invite-accept";
import { acceptInviteAction } from "./actions";

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Showing this page never accepts the invite: that needs a deliberate click
// (a POST), so link previews and prefetching can't join anyone to an org.
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const session = await auth();
  if (!session?.user) redirect(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`);

  const orgName = TOKEN.test(token) ? await inviteOrgName(token) : null;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t.invite.title}</h1>
        {orgName ? (
          <>
            <p>{t.invite.body(orgName)}</p>
            <p className="text-sm opacity-70">{t.invite.signedInAs(session.user.email ?? "")}</p>
            <form action={acceptInviteAction}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit">{t.invite.accept}</Button>
            </form>
          </>
        ) : (
          <p role="alert">{t.invite.invalid}</p>
        )}
      </Card>
    </main>
  );
}
