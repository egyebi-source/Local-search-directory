import "server-only";
import { headers } from "next/headers";

/** Client IP as reported by Vercel's edge (first x-forwarded-for hop). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
