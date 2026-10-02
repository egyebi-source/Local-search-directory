"use server";

import { revalidatePath } from "next/cache";
import { adminExtendTrial, extendTrialSchema } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";
import { consumeRateLimit } from "@/server/security/rate-limit";

export type AdminState = { error?: string; ok?: string };

export async function extendTrialAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const admin = await requireAdmin();
  const parsed = extendTrialSchema.safeParse({ orgId: form.get("orgId"), days: form.get("days"), reason: form.get("reason") });
  if (!parsed.success) return { error: "Pick 1–30 days and give a reason (at least 5 characters)." };
  if (!(await consumeRateLimit({ name: "admin-action", limit: 50, windowSeconds: 60 * 60 }, admin.id))) {
    return { error: "Too many admin actions this hour." };
  }
  try {
    const until = await adminExtendTrial(admin.id, parsed.data);
    revalidatePath("/admin");
    return { ok: `Trial now ends ${until.toLocaleDateString("en-CA")}.` };
  } catch (err) {
    // The database function explains rule violations (paid plan, bad input).
    const message = (err as { cause?: { message?: string } }).cause?.message;
    if (message && /paid plan|days must|reason required|no such organization/.test(message)) return { error: message };
    throw err;
  }
}
