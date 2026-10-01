import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n/en";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { auth } from "@/server/auth";
import { googleLoginEnabled } from "@/server/auth/config";
import { googleSignInAction } from "./actions";
import { EmailLoginForm } from "./login-form";

const ERROR_MESSAGES: Record<string, string> = {
  OAuthAccountNotLinked: t.login.errors.accountNotLinked,
  Verification: t.login.errors.linkExpired,
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const callbackUrl = safeRedirectPath(params.callbackUrl);
  if ((await auth())?.user) redirect(callbackUrl);

  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const error = errorCode ? (ERROR_MESSAGES[errorCode] ?? t.login.errors.generic) : undefined;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold">{t.login.title}</h1>
        {error ? (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <EmailLoginForm callbackUrl={callbackUrl} />
        {googleLoginEnabled() ? (
          <>
            <p className="text-center text-sm opacity-70">{t.login.or}</p>
            <form action={googleSignInAction} className="flex flex-col gap-2">
              <input type="hidden" name="callbackUrl" value={callbackUrl} />
              <Button type="submit" variant="outline">
                {t.login.googleButton}
              </Button>
              <p className="text-xs opacity-70">{t.login.googleNote}</p>
            </form>
          </>
        ) : null}
      </Card>
    </main>
  );
}
