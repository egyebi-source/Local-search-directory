import "server-only";
import { httpGemini } from "@/server/ai/gemini";
import { httpTransport } from "@/server/dataforseo/client";
import { serverEnv } from "@/server/env";
import type { Answers } from "@/server/onboarding/answers";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { runAssessment, type EngineDeps } from "./engine";
import { cacheKeyFor, createSnapshot, findReusable } from "./snapshots";

export class AssessmentRateLimitedError extends Error {}
export class AssessmentCapacityError extends Error {}

const DAY = 24 * 60 * 60;

function realDeps(): EngineDeps {
  return { dataforseo: httpTransport, gemini: httpGemini, dataSource: serverEnv().DATAFORSEO_MODE };
}

/**
 * Run (or reuse) an assessment for a visitor and return the new snapshot id.
 * Order matters: the per-visitor limit applies to every request; the global
 * daily limit and spend caps only to requests that would call paid APIs.
 */
export async function assess(answers: Answers, ip: string, deps: EngineDeps = realDeps()): Promise<string> {
  const env = serverEnv();
  if (!(await consumeRateLimit({ name: "assessment:ip", limit: env.ASSESSMENTS_PER_IP_PER_DAY, windowSeconds: DAY }, ip))) {
    throw new AssessmentRateLimitedError();
  }

  const cacheKey = cacheKeyFor(answers, deps.dataSource);
  const reusable = await findReusable(cacheKey);
  if (reusable) return createSnapshot(reusable, cacheKey, ip);

  if (!(await consumeRateLimit({ name: "assessment:global", limit: env.ASSESSMENTS_GLOBAL_PER_DAY, windowSeconds: DAY }, "all"))) {
    console.warn("[assessment] global daily limit reached");
    throw new AssessmentCapacityError();
  }

  const result = await runAssessment(answers, deps);
  return createSnapshot(result, cacheKey, ip);
}
