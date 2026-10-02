import { NextResponse } from "next/server";
import { httpTransport } from "@/server/dataforseo/client";
import { serverEnv } from "@/server/env";
import { isAuthorizedCron } from "@/server/security/cron";
import { runWeeklySnapshots } from "@/server/dashboard/snapshot";
import { runDailyChecks } from "@/server/tracking/checks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily progress checks and weekly dashboard snapshots, called by Vercel Cron (see vercel.json). Anyone
// else gets a bare 401; the response never includes org data.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const deps = { dataforseo: httpTransport, dataSource: serverEnv().DATAFORSEO_MODE };
  // Daily checks first (30s), then refresh week-old dashboards (20s).
  const checks = await runDailyChecks(deps, 30_000);
  const snapshots = await runWeeklySnapshots(deps, 20_000);
  const summary = { checks, snapshots };
  console.info("[cron] rank-checks", summary);
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
