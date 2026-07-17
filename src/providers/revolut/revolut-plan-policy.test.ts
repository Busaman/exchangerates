import { describe, expect, it } from "vitest";
import { decimal, decimalToPlainString } from "@/domain/decimal";
import { calculateRevolutPlanQuotes } from "@/providers/revolut/revolut-plan-policy";
import type { RevolutQuoteObservation } from "@/providers/revolut/revolut-quote-client";

const weekday = "2026-07-15T12:00:00.000Z";
const base: RevolutQuoteObservation = {
  pair: "HUF-EUR",
  sourceAmount: "1100000",
  targetAmount: "3051.74",
  endpointRecipientAmount: "3051.74",
  targetAmountCalculation: "ENDPOINT_HUNDREDTH_UNIT_DECODED",
  rate: "0.0027743132467174",
  rateTimestamp: weekday,
  retrievedAt: weekday,
  sourceUrl: "https://www.revolut.com/api/exchange/quote?sanitized=true",
  freshness: "FRESH",
  plan: "STANDARD",
  fxFee: { amount: "7500", currency: "HUF" },
  totalFee: { amount: "7500", currency: "HUF" },
  totalSourceCost: { amount: "1107500", currency: "HUF" },
};

describe("Revolut plan policy", () => {
  it("preserves fee-on-top Standard and fails paid plans closed without a common base rate", () => {
    const result = calculateRevolutPlanQuotes({
      observation: base,
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      requestedAt: weekday,
    });
    expect(result[0]).toMatchObject({
      plan: "STANDARD",
      quoteKind: "live",
      feeAmount: { amount: "7500" },
      totalSourceCost: { amount: "1107500" },
      recipientGets: { amount: "3051.74" },
      rankingEligibility: "DEFAULT_PLAN_ELIGIBLE",
    });
    expect(result.slice(1).every((plan) => plan.quoteKind === "unavailable")).toBe(true);
    expect(result[1]).not.toHaveProperty("feeAmount");
  });

  it.each([
    ["100000", "0"],
    ["350000", "0"],
    ["400000", "500"],
    ["1100000", "7500"],
  ])("reproduces live Standard fee for %s HUF", (sourceAmount, fee) => {
    const observation = {
      ...base,
      sourceAmount,
      targetAmount: decimalToPlainString(decimal(sourceAmount).times(base.rate)),
      totalFee: { amount: fee, currency: "HUF" as const },
      totalSourceCost: {
        amount: decimalToPlainString(decimal(sourceAmount).plus(fee)),
        currency: "HUF" as const,
      },
    };
    const plans = calculateRevolutPlanQuotes({
      observation,
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      requestedAt: weekday,
    });
    expect(plans[0]).toMatchObject({ quoteKind: "live", feeAmount: { amount: fee } });
    expect(plans.slice(1).every((plan) => plan.quoteKind === "unavailable")).toBe(true);
  });

  it("fails every paid EUR-source plan closed while preserving live Standard", () => {
    const eur: RevolutQuoteObservation = {
      ...base,
      pair: "EUR-HUF",
      sourceAmount: "965",
      targetAmount: "347375.05",
      endpointRecipientAmount: "347375.05",
      rate: "359.9741547286672872",
      fxFee: { amount: "0.02", currency: "EUR" },
      totalFee: { amount: "0.02", currency: "EUR" },
      totalSourceCost: { amount: "965.02", currency: "EUR" },
    };
    const result = calculateRevolutPlanQuotes({
      observation: eur,
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      requestedAt: weekday,
    });
    expect(result[0]).toMatchObject({ quoteKind: "live", recipientGets: { amount: "347375.05" } });
    expect(result[1]).toMatchObject({ quoteKind: "unavailable", rankingEligibility: "EXCLUDED" });
    expect(result.slice(1).every((plan) => plan.quoteKind === "unavailable")).toBe(true);
  });

  it("keeps weekend Standard live but excludes every paid plan numerically", () => {
    const result = calculateRevolutPlanQuotes({
      observation: base,
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      requestedAt: "2026-07-11T12:00:00.000Z",
    });
    expect(result[0]).toMatchObject({
      quoteKind: "live",
      rankingEligibility: "EXCLUDED",
      pricingWindow: "WEEKEND_UNVERIFIED",
    });
    expect(result.slice(1).every((plan) => plan.quoteKind === "unavailable")).toBe(true);
    expect(result.slice(1).every((plan) => !("recipientGets" in plan))).toBe(true);
  });
});
