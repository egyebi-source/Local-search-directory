import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { adSpendRange, country, primaryGoal, websiteManager } from "@/server/db/schema";

// The six pre-sign-up questions plus the website from the home page.
export const answersSchema = z.object({
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
  serviceArea: z.string().trim().min(2).max(100),
  country: z.enum(country.enumValues),
  primaryGoal: z.enum(primaryGoal.enumValues),
  adSpendRange: z.enum(adSpendRange.enumValues),
  websiteManager: z.enum(websiteManager.enumValues),
});

export type Answers = z.infer<typeof answersSchema>;

/** What's stored between the questions and sign-up: the answers plus the assessment shown. */
export const draftSchema = answersSchema.extend({
  snapshotId: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});
export type Draft = z.infer<typeof draftSchema>;
