import { NextResponse } from "next/server";
import { httpTransport } from "@/server/dataforseo/client";
import { serverEnv } from "@/server/env";
import { isAuthorizedCron } from "@/server/security/cron";
import { runDailyChecks } from "@/server/tracking/checks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily progress checks, called by Vercel Cron (see vercel.json). Anyone
// else gets a bare 401; the response never includes org data.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runDailyChecks({ dataforseo: httpTransport, dataSource: serverEnv().DATAFORSEO_MODE });
  console.info("[cron] rank-checks", summary);
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
