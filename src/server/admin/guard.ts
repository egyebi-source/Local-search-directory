import "server-only";
import { notFound } from "next/navigation";
import { requireUser, type SessionUser } from "@/server/org/current";
import { isPlatformAdmin } from "./admin";

/** The signed-in admin, or a 404 for everyone else (we don't reveal that /admin exists). */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!(await isPlatformAdmin(user.id))) notFound();
  return user;
}
