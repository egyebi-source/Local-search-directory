import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { emailMatchesDomain, isClaimToken, lookupClaim, markClaimed, type ProspectReport } from "@/server/campaigns/campaigns";
import { CLAIM_COOKIE } from "@/server/campaigns/claim-cookie";
import { createOrganization, withOrg } from "@/server/db/tenant";
import { setCurrentOrgCookie } from "@/server/org/current";
import { seedBaseline } from "@/server/tracking/checks";
import { refreshPlan } from "@/server/actions/plan";

export const dynamic = "force-dynamic";

/**
 * Where the emailed sign-in link lands after a claim. Creates the business's
 * account (7-day trial) with the campaign report as its tracking "before".
 * Requires: signed in, the claim cookie from this browser, and a verified
 * email at the business's own domain.
 */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) redirect("/login");

  const jar = await cookies();
  const token = jar.get(CLAIM_COOKIE)?.value;
  const claim = isClaimToken(token) ? await lookupClaim(token) : null;
  if (!token || !claim || claim.status === "claimed" || !emailMatchesDomain(email, claim.domain)) {
    jar.delete(CLAIM_COOKIE);
    redirect("/app");
  }

  const r = claim.report as ProspectReport;
  const orgId = await createOrganization(userId, {
    name: claim.businessName,
    websiteDomain: claim.domain,
    serviceArea: claim.city,
    category: claim.category,
    country: claim.country,
    countries: [claim.country],
  });
  await withOrg(userId, orgId, (tx) =>
    seedBaseline(tx, orgId, {
      keyword: claim.keyword,
      country: claim.country,
      day: r.checkedOn,
      dataSource: r.dataSource,
      values: {
        mapRank: r.mapRank,
        organicRank: r.organicRank,
        rating: r.rating,
        reviews: r.reviews,
        leaderAvgRating: r.leaderAvgRating,
        leaderAvgReviews: r.leaderAvgReviews,
      },
    }),
  );
  // A first action plan from templates (no AI cost); "Get fresh suggestions" uses AI.
  await refreshPlan(orgId, (fn) => withOrg(userId, orgId, fn));
  await markClaimed(token, orgId);
  jar.delete(CLAIM_COOKIE);
  await setCurrentOrgCookie(orgId);
  redirect("/app/progress");
}
