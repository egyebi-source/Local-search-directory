import { t } from "@/lib/i18n/en";
import { withCurrentOrg } from "@/server/org/current";
import { organizations } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export default async function OverviewPage() {
  const org = await withCurrentOrg(async (tx, ctx) => {
    const [row] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    return row;
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{org.name}</h1>
      {org.websiteDomain ? <p className="text-sm opacity-80">{org.websiteDomain}</p> : null}
      <p>{t.app.overviewBody}</p>
    </div>
  );
}
