import { z } from "zod";
import { normalizeDomain } from "@/lib/domain";
import { adSpendRange, primaryGoal, websiteManager } from "@/server/db/schema";

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
  primaryGoal: z.enum(primaryGoal.enumValues),
  adSpendRange: z.enum(adSpendRange.enumValues),
  websiteManager: z.enum(websiteManager.enumValues),
});

export type Answers = z.infer<typeof answersSchema>;
