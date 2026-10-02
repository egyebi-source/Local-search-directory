import { desc, eq } from "drizzle-orm";
import { FullDetails, InsightCards, LocalTiles, MetricTiles, SampleDataBanner } from "@/components/assessment/parts";
import { t } from "@/lib/i18n/en";
import { toLocalSummary, type AssessmentResult } from "@/server/assessment/result";
import { orgAssessments, organizations } from "@/server/db/schema";
import { withCurrentOrg } from "@/server/org/current";

export default async function OverviewPage() {
  const { org, assessment } = await withCurrentOrg(async (tx, ctx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, ctx.orgId));
    const [latest] = await tx
      .select({ result: orgAssessments.resultJson })
      .from(orgAssessments)
      .where(eq(orgAssessments.orgId, ctx.orgId))
      .orderBy(desc(orgAssessments.createdAt))
      .limit(1);
    return { org, assessment: (latest?.result as AssessmentResult | undefined) ?? null };
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">{org.name}</h1>
        {org.websiteDomain ? <p className="text-sm opacity-80">{org.websiteDomain}</p> : null}
      </div>
      {assessment ? (
        <>
          <p className="text-slate-600 dark:text-slate-400">{t.assessment.subtitle(assessment.primaryKeyword)}</p>
          <SampleDataBanner source={assessment.dataSource} />
          {assessment.local ? (
            <LocalTiles l={toLocalSummary(assessment.local)} m={assessment.metrics} />
          ) : (
            <MetricTiles m={assessment.metrics} />
          )}
          <section className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">{t.assessment.insightsTitle}</h2>
            <InsightCards insights={assessment.insights} />
          </section>
          <FullDetails r={assessment} />
        </>
      ) : (
        <p>{t.app.overviewBody}</p>
      )}
    </div>
  );
}
