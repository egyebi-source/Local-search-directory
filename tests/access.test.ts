import { describe, expect, it } from "vitest";
import { accessState, hasAccess } from "@/server/billing/access";

const now = new Date("2026-10-01T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3600_000);

describe("accessState", () => {
  it("counts trial days left, rounding up", () => {
    expect(accessState({ planStatus: "trialing", trialEndsAt: hours(7 * 24) }, now)).toEqual({
      kind: "trialing",
      daysLeft: 7,
    });
    expect(accessState({ planStatus: "trialing", trialEndsAt: hours(1) }, now)).toEqual({
      kind: "trialing",
      daysLeft: 1,
    });
  });

  it("locks the moment the trial ends, even before the daily job runs", () => {
    const state = accessState({ planStatus: "trialing", trialEndsAt: now }, now);
    expect(state).toEqual({ kind: "locked" });
    expect(hasAccess(state)).toBe(false);
  });

  it("keeps paying and in-retry customers unlocked regardless of trial date", () => {
    expect(hasAccess(accessState({ planStatus: "active", trialEndsAt: hours(-1000) }, now))).toBe(true);
    expect(hasAccess(accessState({ planStatus: "past_due", trialEndsAt: hours(-1000) }, now))).toBe(true);
  });

  it("respects an explicit lock", () => {
    expect(accessState({ planStatus: "locked", trialEndsAt: hours(100) }, now)).toEqual({ kind: "locked" });
  });
});
