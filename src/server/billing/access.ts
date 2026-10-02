import type { PlanStatus } from "@/server/db/schema";

export type AccessState =
  | { kind: "trialing"; daysLeft: number }
  | { kind: "active" }
  | { kind: "past_due" }
  | { kind: "locked" }
  // Covered by the agency that manages this location (PRD Module 11).
  | { kind: "agency"; agencyName: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the org may see right now. Computed on every request from the stored
 * status and trial end, so an expired trial locks immediately even if the
 * daily lifecycle job hasn't run yet (PRD FR-10.7).
 */
export function accessState(
  org: { planStatus: PlanStatus; trialEndsAt: Date },
  now: Date = new Date(),
): AccessState {
  switch (org.planStatus) {
    case "active":
      return { kind: "active" };
    case "past_due":
      return { kind: "past_due" };
    case "locked":
      return { kind: "locked" };
    case "trialing": {
      const msLeft = org.trialEndsAt.getTime() - now.getTime();
      if (msLeft <= 0) return { kind: "locked" };
      return { kind: "trialing", daysLeft: Math.ceil(msLeft / DAY_MS) };
    }
  }
}

export function hasAccess(state: AccessState): boolean {
  return state.kind !== "locked";
}
