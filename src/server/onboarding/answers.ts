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
  country: z.enum(country.enumValues),
  primaryGoal: z.enum(primaryGoal.enumValues),
  adSpendRange: z.enum(adSpendRange.enumValues),
  websiteManager: z.enum(websiteManager.enumValues),
};

type Base = { reach: "local" | "national"; serviceArea: string };

// Local businesses must name their area; nationwide ones get a fixed label.
function withReach<T extends z.ZodType<Base>>(schema: T) {
  return schema
    .superRefine((a, ctx) => {
      if (a.reach === "local" && a.serviceArea.length < 2) {
        ctx.addIssue({ code: "custom", path: ["serviceArea"], message: "serviceArea" });
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
