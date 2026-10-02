import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/server/env";

/** True only for requests carrying our cron secret. Constant-time compare. */
export function isAuthorizedCron(authorization: string | null): boolean {
  const secret = serverEnv().CRON_SECRET;
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authorization);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
