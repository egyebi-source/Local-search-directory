import { NextResponse } from "next/server";
import { runWeeklyDigest } from "@/server/digest/digest";
import { isAuthorizedCron } from "@/server/security/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Weekly progress emails, called by Vercel Cron on Mondays (see vercel.json).
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await runWeeklyDigest();
  console.info("[cron] weekly-digest", summary);
  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
