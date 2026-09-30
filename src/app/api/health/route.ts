import { NextResponse } from "next/server";
import { checkDatabase } from "@/server/db/client";

export const dynamic = "force-dynamic";

// Public liveness check. Reports status words only — never error details,
// hostnames or connection strings.
export async function GET() {
  const database = await checkDatabase();
  return NextResponse.json(
    { status: database === "unreachable" ? "degraded" : "ok", database },
    { headers: { "Cache-Control": "no-store" } },
  );
}
