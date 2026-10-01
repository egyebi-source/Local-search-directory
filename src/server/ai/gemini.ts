import "server-only";
import { z } from "zod";
import { serverEnv } from "@/server/env";
import { assertUnderCap, recordSpend } from "@/server/security/spend";

export class GeminiError extends Error {}

export type GeminiRequest = {
  system: string;
  user: string;
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
};
export type GeminiTransport = (req: GeminiRequest) => Promise<{ text: string; tokensIn: number; tokensOut: number }>;

// Conservative per-token prices used only to enforce the daily cap. Keep
// them at or above the real price of GEMINI_MODEL.
const USD_PER_INPUT_TOKEN = 0.5 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 3 / 1_000_000;

const responseShape = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.object({ text: z.string().optional() })) }).optional() }))
    .min(1),
  usageMetadata: z
    .object({ promptTokenCount: z.number().optional(), candidatesTokenCount: z.number().optional() })
    .optional(),
});

export const httpGemini: GeminiTransport = async (req) => {
  const env = serverEnv();
  if (!env.GEMINI_API_KEY) throw new GeminiError("GEMINI_API_KEY is not configured");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
    {
      method: "POST",
      // Key in a header, never in the URL (URLs end up in logs).
      headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: req.maxOutputTokens,
          responseMimeType: "application/json",
          responseSchema: req.responseSchema,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) throw new GeminiError(`Gemini HTTP ${res.status}`);
  const parsed = responseShape.safeParse(await res.json());
  if (!parsed.success) throw new GeminiError("Unexpected Gemini response shape");
  const text = parsed.data.candidates[0].content?.parts.map((p) => p.text ?? "").join("") ?? "";
  return {
    text,
    tokensIn: parsed.data.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: parsed.data.usageMetadata?.candidatesTokenCount ?? 0,
  };
};

/** One capped, cost-tracked Gemini call. */
export async function generate(t: GeminiTransport, req: GeminiRequest): Promise<string> {
  await assertUnderCap("gemini");
  const out = await t(req);
  await recordSpend("gemini", out.tokensIn * USD_PER_INPUT_TOKEN + out.tokensOut * USD_PER_OUTPUT_TOKEN);
  return out.text;
}
