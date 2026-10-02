import { NextResponse } from "next/server";
import { z } from "zod";
import { isPlatformAdmin } from "@/server/admin/admin";
import { auth } from "@/server/auth";
import { reissueLinks } from "@/server/campaigns/campaigns";

export const dynamic = "force-dynamic";

const csvCell = (v: string | number | null) => {
  const s = v === null ? "" : String(v);
  // Quote everything; neutralize spreadsheet formulas (CSV injection).
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

// POST only (it creates new links), same-origin only, admins only.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId || !(await isPlatformAdmin(userId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not found" }, { status: 404 });

  const links = await reissueLinks(userId, id.data);
  const csv = [
    ["Maps spot", "Business", "Website", "Claim link"].map(csvCell).join(","),
    ...links.map((l) => [l.mapRank, l.businessName, l.domain, l.url].map(csvCell).join(",")),
  ].join("\r\n");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="claim-links-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
