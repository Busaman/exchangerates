import { describe, expect, it } from "vitest";
import {
  evaluateRevolutFeeCoverage,
  isRevolutWeekend,
} from "@/providers/revolut/revolut-fee-coverage";

describe("Revolut fee coverage policy", () => {
  it("keeps correctly decoded endpoint fees rankable on weekdays", () => {
    expect(evaluateRevolutFeeCoverage({ at: new Date("2026-07-15T12:00:00.000Z") })).toEqual({
      sessionClassification: "WEEKDAY",
      feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
      rankingStatus: "ELIGIBLE",
    });
  });

  it("keeps the weekend fee guard until simultaneous weekend evidence exists", () => {
    expect(evaluateRevolutFeeCoverage({ at: new Date("2026-07-11T12:00:00.000Z") })).toMatchObject({
      sessionClassification: "WEEKEND",
      feeCoverage: "UNVERIFIED_WEEKEND",
      rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
      rankingExclusionReason: "WEEKEND_FEE_UNVERIFIED",
    });
  });

  it("uses the exact Friday 17:00 and Sunday 18:00 America/New_York boundaries", () => {
    expect(isRevolutWeekend(new Date("2026-07-10T20:59:59.999Z"))).toBe(false);
    expect(isRevolutWeekend(new Date("2026-07-10T21:00:00.000Z"))).toBe(true);
    expect(isRevolutWeekend(new Date("2026-07-12T21:59:59.999Z"))).toBe(true);
    expect(isRevolutWeekend(new Date("2026-07-12T22:00:00.000Z"))).toBe(false);
  });

  it("handles the EDT-to-EST transition inside the weekend window", () => {
    expect(isRevolutWeekend(new Date("2026-11-01T22:59:59.999Z"))).toBe(true);
    expect(isRevolutWeekend(new Date("2026-11-01T23:00:00.000Z"))).toBe(false);
  });
});
