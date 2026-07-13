import { describe, expect, it } from "vitest";
import type { RevolutPersonalPlan } from "@/domain/quote";
import {
  calculateRevolutPersonalQuote,
  classifyRevolutMarketSession,
} from "@/providers/revolut/revolut-fees";

const weekday = new Date("2026-01-05T15:00:00.000Z");
const weekend = new Date("2026-01-03T15:00:00.000Z");

function hufQuote(
  plan: RevolutPersonalPlan,
  rollingThirtyDayExchangeUsedHuf: string,
  at = weekday,
) {
  return calculateRevolutPersonalQuote({
    sourceCurrency: "HUF",
    targetCurrency: "EUR",
    sourceAmount: "100000",
    displayedBaseRate: "0.0025",
    personalContext: { plan, rollingThirtyDayExchangeUsedHuf },
    at,
  });
}

describe("Revolut Hungary personal fee policy", () => {
  it("keeps Standard within allowance fee-free on weekdays", () => {
    expect(hufQuote("STANDARD", "100000")).toMatchObject({
      fairUsageFee: "0",
      weekendFee: "0",
      totalFee: "0",
      remainingAllowanceAfterQuoteHuf: "150000",
    });
  });

  it("charges Standard only on the portion partially exceeding allowance", () => {
    expect(hufQuote("STANDARD", "300000")).toMatchObject({
      fairUsageFee: "500",
      totalFee: "500",
      remainingAllowanceAfterQuoteHuf: "0",
    });
  });

  it("charges Standard on the full quote after allowance is exhausted", () => {
    expect(hufQuote("STANDARD", "350000").fairUsageFee).toBe("1000");
  });

  it("applies the Plus allowance and 0.5 percent overage rate", () => {
    expect(hufQuote("PLUS", "900000").fairUsageFee).toBe("0");
    expect(hufQuote("PLUS", "1050000").fairUsageFee).toBe("500");
  });

  it.each(["PREMIUM", "METAL", "ULTRA"] as const)(
    "has no weekday fair-usage fee for %s",
    (plan) => {
      expect(hufQuote(plan, "999999999")).toMatchObject({
        fairUsageFee: "0",
        fairUsageAllowanceHuf: null,
        remainingAllowanceAfterQuoteHuf: null,
      });
    },
  );

  it.each(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"] as const)(
    "applies the one-percent weekend fee to %s",
    (plan) => {
      expect(hufQuote(plan, "0", weekend).weekendFee).toBe("1000");
    },
  );

  it("stacks fair-usage and weekend fees transparently on the source amount", () => {
    expect(hufQuote("STANDARD", "350000", weekend)).toMatchObject({
      fairUsageFee: "1000",
      weekendFee: "1000",
      totalFee: "2000",
      targetAmount: "245.00",
      effectiveRate: "0.00245",
    });
  });

  it("uses the directional EUR/HUF rate only for EUR-source allowance consumption", () => {
    expect(
      calculateRevolutPersonalQuote({
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        displayedBaseRate: "400",
        personalContext: { plan: "STANDARD", rollingThirtyDayExchangeUsedHuf: "0" },
        at: weekday,
      }),
    ).toMatchObject({
      allowanceConsumedByQuoteHuf: "400000",
      fairUsageFee: "1.25",
      targetAmount: "399500",
      effectiveRate: "399.5",
    });
  });

  it("uses the exact HUF source amount for allowance consumption", () => {
    expect(hufQuote("STANDARD", "0").allowanceConsumedByQuoteHuf).toBe("100000");
  });

  it("preserves decimal precision and rounds only final payout down to target scale", () => {
    const quote = calculateRevolutPersonalQuote({
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000.123456789",
      displayedBaseRate: "392.12345678901234",
      personalContext: { plan: "ULTRA", rollingThirtyDayExchangeUsedHuf: "0" },
      at: weekday,
    });

    expect(quote.displayedBaseRate).toBe("392.12345678901234");
    expect(quote.targetAmount).toMatch(/^\d+$/);
    expect(quote.effectiveRate).not.toMatch(/[eE]/);
  });
});

describe("Revolut weekend ET boundaries", () => {
  it("starts Friday at 17:00 and ends Sunday at 18:00 New York time", () => {
    expect(classifyRevolutMarketSession(new Date("2026-01-02T21:59:00.000Z"))).toBe("WEEKDAY");
    expect(classifyRevolutMarketSession(new Date("2026-01-02T22:00:00.000Z"))).toBe("WEEKEND");
    expect(classifyRevolutMarketSession(new Date("2026-01-04T22:59:00.000Z"))).toBe("WEEKEND");
    expect(classifyRevolutMarketSession(new Date("2026-01-04T23:00:00.000Z"))).toBe("WEEKDAY");
  });

  it("follows daylight-saving changes through America/New_York", () => {
    expect(classifyRevolutMarketSession(new Date("2026-07-10T20:59:00.000Z"))).toBe("WEEKDAY");
    expect(classifyRevolutMarketSession(new Date("2026-07-10T21:00:00.000Z"))).toBe("WEEKEND");
  });

  it("handles the daylight-saving fallback inside the weekend window", () => {
    // New York repeats 01:00 during this interval; both occurrences remain inside the weekend.
    expect(classifyRevolutMarketSession(new Date("2026-11-01T05:30:00.000Z"))).toBe("WEEKEND");
    expect(classifyRevolutMarketSession(new Date("2026-11-01T06:30:00.000Z"))).toBe("WEEKEND");
    // After the fallback, 18:00 ET is 23:00 UTC.
    expect(classifyRevolutMarketSession(new Date("2026-11-01T22:59:00.000Z"))).toBe("WEEKEND");
    expect(classifyRevolutMarketSession(new Date("2026-11-01T23:00:00.000Z"))).toBe("WEEKDAY");
  });
});
