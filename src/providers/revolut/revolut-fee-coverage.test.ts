import { describe, expect, it } from "vitest";
import {
  evaluateRevolutFeeCoverage,
  isRevolutWeekend,
  missingFairUsageFeeWarning,
  revolutFairUsageAllowanceHuf,
} from "@/providers/revolut/revolut-fee-coverage";

const weekday = new Date("2026-07-15T12:00:00.000Z");

describe("Revolut fee coverage policy", () => {
  it("keeps the synthetic A amount rankable and excludes adjacent A+1 above Standard allowance", () => {
    const amountA = evaluateRevolutFeeCoverage({
      plan: "STANDARD",
      pair: "EUR-HUF",
      sourceAmount: "980",
      rate: "356.8",
      at: weekday,
    });
    const amountB = evaluateRevolutFeeCoverage({
      plan: "STANDARD",
      pair: "EUR-HUF",
      sourceAmount: "981",
      rate: "356.8",
      at: weekday,
    });

    expect(amountA).toMatchObject({
      allowanceConsumptionHuf: "349664",
      fairUsageAllowanceHuf: revolutFairUsageAllowanceHuf.STANDARD,
      feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
      rankingStatus: "ELIGIBLE",
    });
    expect(amountB).toMatchObject({
      allowanceConsumptionHuf: "350020.8",
      feeCoverage: "INCOMPLETE_FAIR_USAGE",
      rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
      rankingExclusionReason: "FAIR_USAGE_FEE_NOT_RETURNED",
      feeCoverageWarning: missingFairUsageFeeWarning,
    });
  });

  it("treats the exact Standard and Plus boundaries as eligible and excludes only values above", () => {
    expect(
      evaluateRevolutFeeCoverage({
        plan: "STANDARD",
        pair: "EUR-HUF",
        sourceAmount: "1000",
        rate: "350",
        at: weekday,
      }).rankingStatus,
    ).toBe("ELIGIBLE");
    expect(
      evaluateRevolutFeeCoverage({
        plan: "PLUS",
        pair: "HUF-EUR",
        sourceAmount: "1050000",
        rate: "0.0027",
        at: weekday,
      }).rankingStatus,
    ).toBe("ELIGIBLE");
    expect(
      evaluateRevolutFeeCoverage({
        plan: "PLUS",
        pair: "HUF-EUR",
        sourceAmount: "1050000.01",
        rate: "0.0027",
        at: weekday,
      }).rankingStatus,
    ).toBe("EXCLUDED_INCOMPLETE_FEES");
  });

  it.each(["PREMIUM", "METAL", "ULTRA"] as const)(
    "keeps %s rankable during a verified weekday window",
    (plan) => {
      expect(
        evaluateRevolutFeeCoverage({
          plan,
          pair: "HUF-EUR",
          sourceAmount: "2000000",
          rate: "0.0027",
          at: weekday,
        }),
      ).toMatchObject({
        sessionClassification: "WEEKDAY",
        feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
        rankingStatus: "ELIGIBLE",
      });
    },
  );

  it.each(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"] as const)(
    "excludes %s during the unverified weekend fee window",
    (plan) => {
      expect(
        evaluateRevolutFeeCoverage({
          plan,
          pair: "HUF-EUR",
          sourceAmount: "100000",
          rate: "0.0027",
          at: new Date("2026-07-11T12:00:00.000Z"),
        }),
      ).toMatchObject({
        sessionClassification: "WEEKEND",
        feeCoverage: "UNVERIFIED_WEEKEND",
        rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
        rankingExclusionReason: "WEEKEND_FEE_UNVERIFIED",
      });
    },
  );

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
