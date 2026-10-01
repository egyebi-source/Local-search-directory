import { describe, expect, it } from "vitest";
import { answersSchema } from "@/server/onboarding/answers";
import { consumeDraft, saveDraft } from "@/server/onboarding/drafts";
import { asOwner, hasDb } from "./helpers";

const answers = answersSchema.parse({
  website: "https://www.AcmeCollision.ca/contact",
  name: "Acme Collision",
  category: "Collision repair",
  serviceArea: "Ottawa, ON",
  primaryGoal: "calls",
  adSpendRange: "under_500",
  websiteManager: "self",
});

describe("answersSchema", () => {
  it("normalizes the website and accepts the six answers", () => {
    expect(answers.website).toBe("acmecollision.ca");
  });

  it("rejects unknown choices and bad websites", () => {
    expect(answersSchema.safeParse({ ...answers, primaryGoal: "world_domination" }).success).toBe(false);
    expect(answersSchema.safeParse({ ...answers, website: "localhost" }).success).toBe(false);
    expect(answersSchema.safeParse({ ...answers, name: "" }).success).toBe(false);
  });
});

describe.runIf(hasDb)("pre-sign-up drafts", () => {
  it("returns the answers exactly once", async () => {
    const token = await saveDraft(answers);
    expect(await consumeDraft(token)).toEqual(answers);
    expect(await consumeDraft(token)).toBeNull();
  });

  it("stores only a hash of the token", async () => {
    const token = await saveDraft(answers);
    const rows = await asOwner(async (c) => (await c.query("SELECT token_hash FROM assessment_drafts")).rows);
    expect(rows.some((r) => r.token_hash === token)).toBe(false);
    await consumeDraft(token);
  });

  it("refuses expired drafts", async () => {
    const token = await saveDraft(answers);
    await asOwner((c) => c.query("UPDATE assessment_drafts SET expires_at = now() - interval '1 minute'"));
    expect(await consumeDraft(token)).toBeNull();
  });

  it("re-validates stored answers instead of trusting them", async () => {
    const token = await saveDraft(answers);
    await asOwner((c) => c.query(`UPDATE assessment_drafts SET answers = answers || '{"primaryGoal":"hacked"}'`));
    expect(await consumeDraft(token)).toBeNull();
  });
});
