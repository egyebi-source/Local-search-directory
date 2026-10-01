import { describe, expect, it } from "vitest";
import { answersFromForm, answersSchema } from "@/server/onboarding/answers";
import { consumeDraft, saveDraft } from "@/server/onboarding/drafts";
import { asOwner, hasDb } from "./helpers";

const answers = answersSchema.parse({
  website: "https://www.AcmeCollision.ca/contact",
  name: "Acme Collision",
  category: "Collision repair",
  serviceArea: "Ottawa, ON",
  countries: ["CA"],
  goals: ["calls"],
  adSpendRange: "under_500",
  websiteManager: "self",
});

describe("answersSchema", () => {
  it("normalizes the website and accepts the six answers", () => {
    expect(answers.website).toBe("acmecollision.ca");
  });

  it("nationwide businesses don't need a city, local ones do", () => {
    const national = answersSchema.parse({ ...answers, reach: "national", serviceArea: "" });
    expect(national.serviceArea).toBe("Nationwide");
    expect(answersSchema.safeParse({ ...answers, reach: "local", serviceArea: "" }).success).toBe(false);
    // Default is local, so existing callers keep working.
    expect(answers.reach).toBe("local");
  });

  it("accepts several goals, and several countries only for nationwide businesses", () => {
    expect(answersSchema.parse({ ...answers, goals: ["calls", "form_leads", "calls"] }).goals).toEqual(["calls", "form_leads"]);
    expect(answersSchema.safeParse({ ...answers, goals: [] }).success).toBe(false);
    expect(answersSchema.safeParse({ ...answers, countries: ["CA", "US"] }).success).toBe(false);
    expect(answersSchema.parse({ ...answers, reach: "national", countries: ["CA", "US"] }).countries).toEqual(["CA", "US"]);
    expect(answersSchema.safeParse({ ...answers, countries: [] }).success).toBe(false);
  });

  it("reads every ticked checkbox from the submitted form", () => {
    const form = new FormData();
    form.append("goals", "calls");
    form.append("goals", "walk_ins");
    form.append("countries", "US");
    const out = answersFromForm(form);
    expect(out.goals).toEqual(["calls", "walk_ins"]);
    expect(out.countries).toEqual(["US"]);
  });

  it("rejects unknown choices and bad websites", () => {
    expect(answersSchema.safeParse({ ...answers, goals: ["world_domination"] }).success).toBe(false);
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
    await asOwner((c) => c.query(`UPDATE assessment_drafts SET answers = answers || '{"goals":["hacked"]}'`));
    expect(await consumeDraft(token)).toBeNull();
  });
});
