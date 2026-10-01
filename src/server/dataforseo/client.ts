import "server-only";
import { z } from "zod";
import { serverEnv } from "@/server/env";
import { assertUnderCap, recordSpend } from "@/server/security/spend";

// Minimal DataForSEO v3 client: one "live" task per call. Responses are
// validated loosely (only the fields we use) so harmless additions on their
// side don't break us, while unexpected shapes are rejected cleanly.

export class DataForSeoError extends Error {}

const envelope = z.object({
  status_code: z.number(),
  cost: z.number().optional().default(0),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        status_message: z.string().optional(),
        cost: z.number().optional().default(0),
        result: z.array(z.unknown()).nullable().optional(),
      }),
    )
    .min(1),
});

/** Local development only: point at a fake DataForSEO. Ignored on Vercel. */
function devBaseUrl(): string | null {
  const url = process.env.DATAFORSEO_DEV_BASE_URL;
  if (!url || process.env.VERCEL || process.env.NODE_ENV === "production") return null;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url) ? url : null;
}

export type DataForSeoTransport = (path: string, body: unknown) => Promise<unknown>;

/** Real HTTP transport. Sandbox unless DATAFORSEO_MODE=live. */
export const httpTransport: DataForSeoTransport = async (path, body) => {
  const env = serverEnv();
  if (!env.DATAFORSEO_LOGIN || !env.DATAFORSEO_PASSWORD) {
    throw new DataForSeoError("DataForSEO credentials are not configured");
  }
  const base = devBaseUrl() ?? `https://${env.DATAFORSEO_MODE === "live" ? "api" : "sandbox"}.dataforseo.com`;
  const auth = Buffer.from(`${env.DATAFORSEO_LOGIN}:${env.DATAFORSEO_PASSWORD}`).toString("base64");
  const res = await fetch(`${base}/v3/${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new DataForSeoError(`DataForSEO HTTP ${res.status}`);
  return res.json();
};

/** Run one live task and return its first result object. */
export async function liveTask(
  transport: DataForSeoTransport,
  path: string,
  task: Record<string, unknown>,
): Promise<unknown> {
  await assertUnderCap("dataforseo");
  const parsed = envelope.safeParse(await transport(path, [task]));
  if (!parsed.success) throw new DataForSeoError("Unexpected DataForSEO response shape");
  const { tasks } = parsed.data;
  await recordSpend("dataforseo", tasks.reduce((sum, t) => sum + (t.cost ?? 0), 0));
  const first = tasks[0];
  if (first.status_code !== 20000) {
    throw new DataForSeoError(`DataForSEO task failed (${first.status_code})`);
  }
  return first.result?.[0] ?? null;
}
