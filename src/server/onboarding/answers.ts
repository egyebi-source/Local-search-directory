import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { adSpendRange, country, primaryGoal, websiteManager } from "@/server/db/schema";

export const NATIONWIDE = "Nationwide";

const fields = {
  website: z
    .string()
    .trim()
    .max(253)
    .transform((v, ctx) => {
      const domain = normalizeDomain(v);
      if (!domain) {
        ctx.addIssue({ code: "custom", message: "website" });
        return z.NEVER;
      }
      return domain;
    }),
  name: z.string().trim().min(2).max(100),
  category: z.string().trim().min(2).max(100),
  // "local": customers come from a city/region; "national": from anywhere in the country.
  reach: z.enum(["local", "national"]).default("local"),
  serviceArea: z.string().trim().max(100).default(""),
  // Several allowed; order kept (first = main market / main goal).
  countries: z
    .array(z.enum(country.enumValues))
    .min(1)
    .max(2)
    .transform((c) => [...new Set(c)]),
  goals: z
    .array(z.enum(primaryGoal.enumValues))
    .min(1)
    .max(4)
    .transform((g) => [...new Set(g)]),
  adSpendRange: z.enum(adSpendRange.enumValues),
  websiteManager: z.enum(websiteManager.enumValues),
  // Optional: what a customer would type into Google (one per line, up to 3).
  phrases: z
    .preprocess(
      (v) => (typeof v === "string" ? v.split(/[\n,;]/) : Array.isArray(v) ? v : []),
      z.array(z.string()).transform((list) =>
        [...new Set(list.map((p) => p.trim().toLowerCase().replace(/\s+/g, " ")).filter((p) => p.length >= 3 && p.length <= 80 && /^[\p{L}\p{N} &'.-]+$/u.test(p)))].slice(0, 3),
      ),
    )
    .default([]),
};

type Base = { reach: "local" | "national"; serviceArea: string; countries: string[] };

// Local businesses must name their area; nationwide ones get a fixed label.
function withReach<T extends z.ZodType<Base>>(schema: T) {
  return schema
    .superRefine((a, ctx) => {
      if (a.reach === "local" && a.serviceArea.length < 2) {
        ctx.addIssue({ code: "custom", path: ["serviceArea"], message: "serviceArea" });
      }
      // A city is in one country; several countries only make sense nationwide.
      if (a.reach === "local" && a.countries.length > 1) {
        ctx.addIssue({ code: "custom", path: ["countries"], message: "countries" });
      }
    })
    .transform((a) => (a.reach === "national" ? { ...a, serviceArea: NATIONWIDE } : a));
}

// The six pre-sign-up questions plus the website from the home page.
export const answersSchema = withReach(z.object(fields));
export type Answers = z.infer<typeof answersSchema>;

/** What's stored between the questions and sign-up: the answers plus the assessment shown. */
export const draftSchema = withReach(
  z.object({ ...fields, snapshotId: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional() }),
);
export type Draft = z.infer<typeof draftSchema>;

/** FormData -> plain object, keeping every value of the multi-select fields. */
export function answersFromForm(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = Object.fromEntries(form);
  out.countries = form.getAll("countries");
  out.goals = form.getAll("goals");
  return out;
}
