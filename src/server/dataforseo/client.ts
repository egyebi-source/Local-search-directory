import "server-only";
import { z } from "zod";
import { serverEnv } from "@/server/env";
import { assertUnderCap, recordSpend } from "@/server/security/spend";

// Minimal DataForSEO v3 client: one "live" task per call. Responses are
// validated loosely (only the fields we use) so harmless additions on their
// side don't break us, while unexpected shapes are rejected cleanly.

/** Messages are written by us and never contain credentials, so they are safe to log. */
export class DataForSeoError extends Error {
  override name = "DataForSeoError";
  /** DataForSEO's task-level status code, when the failure came from one task. */
  constructor(message: string, readonly taskCode?: number) {
    super(message);
  }
}

const envelope = z.object({
  status_code: z.number(),
  status_message: z.string().optional(),
  cost: z.number().nullable().optional(),
  tasks: z
    .array(
      z.object({
        status_code: z.number(),
        status_message: z.string().optional(),
        cost: z.number().nullable().optional(),
        result: z.array(z.unknown()).nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
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
  if (!res.ok) {
    throw new DataForSeoError(
      res.status === 401 ? "DataForSEO HTTP 401 (check API login/password)" : `DataForSEO HTTP ${res.status}`,
    );
  }
  return res.json();
};

/**
 * 40101 "Internal SE Server Error": Google itself errored on this search.
 * DataForSEO has already retried; it's usually temporary, so we try again.
 */
export const TRANSIENT_TASK_CODES = new Set([40101]);
export const TASK_RETRIES = 2;

/** Run one live task and return its first result object. */
export async function liveTask(
  transport: DataForSeoTransport,
  path: string,
  task: Record<string, unknown>,
  retryDelayMs = 1500,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await liveTaskOnce(transport, path, task);
    } catch (err) {
      const transient = err instanceof DataForSeoError && err.taskCode !== undefined && TRANSIENT_TASK_CODES.has(err.taskCode);
      if (!transient || attempt >= TASK_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }
}

async function liveTaskOnce(transport: DataForSeoTransport, path: string, task: Record<string, unknown>): Promise<unknown> {
  await assertUnderCap("dataforseo");
  const parsed = envelope.safeParse(await transport(path, [task]));
  if (!parsed.success) {
    throw new DataForSeoError(`Unexpected DataForSEO response shape at ${parsed.error.issues[0]?.path.join(".") || "root"}`);
  }
  // Account-level problems (e.g. 40100 not authorized, 40200 payment
  // required) are reported at the top with no tasks.
  if (parsed.data.status_code !== 20000) {
    throw new DataForSeoError(`DataForSEO request failed (${parsed.data.status_code} on ${path})`);
  }
  const tasks = parsed.data.tasks ?? [];
  await recordSpend("dataforseo", tasks.reduce((sum, t) => sum + (t.cost ?? 0), 0));
  const first = tasks[0];
  if (!first) throw new DataForSeoError(`DataForSEO returned no task (${path})`);
  if (first.status_code !== 20000) {
    // e.g. 40501 invalid field, 40200 payment required, 40210 insufficient funds.
    throw new DataForSeoError(`DataForSEO task failed (${first.status_code} on ${path})`, first.status_code);
  }
  return first.result?.[0] ?? null;
}
