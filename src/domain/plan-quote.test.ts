import { describe, expect, it } from "vitest";
import { planQuoteSchema } from "@/domain/plan-quote";

const numericPlanQuote = {
  provider: "ZEN",
  plan: "Free",
  isDefaultPlan: true,
  isPaidPlan: false,
  monthlyFee: { currency: "EUR", amount: "0" },
  baseMarkup: "0.005",
  excessMarkup: "0",
  offMarketMarkup: "0",
  totalMarkup: "0.005",
  pricingWindow: "WEEKDAY" as const,
  calculationNote: "Policy-derived quote without a separate monetary fee.",
  source: {
    sourceType: "OFFICIAL_POLICY" as const,
    sourceId: "zen-public-pricing-policy",
    sourceUrl: "https://www.zen.com/pricing/",
  },
  fetchedAt: "2026-07-17T10:00:00.000Z",
  rankingEligibility: "DEFAULT_PLAN_ELIGIBLE" as const,
  quoteKind: "derived" as const,
  calculationRate: "0.002735323383084577114427860696517412935323",
  liveBaseRate: "0.002749",
  effectiveRate: "0.002735323383084577114427860696517412935323",
  inverseRate: "365.5874863586758821389596216806111313205",
  totalSourceCost: { currency: "HUF", amount: "100000" },
  recipientGets: { currency: "EUR", amount: "273.5323383084577114427860696517412935323" },
};

describe("planQuoteSchema", () => {
  it("accepts rate-markup plans without a fabricated separate monetary fee", () => {
    const parsed = planQuoteSchema.parse(numericPlanQuote);

    expect(parsed).not.toHaveProperty("feeAmount");
    expect(parsed).not.toHaveProperty("feeCurrency");
  });

  it("requires fee amount and currency together and with matching currencies", () => {
    expect(
      planQuoteSchema.safeParse({
        ...numericPlanQuote,
        feeAmount: { currency: "HUF", amount: "1" },
      }).success,
    ).toBe(false);
    expect(
      planQuoteSchema.safeParse({
        ...numericPlanQuote,
        feeAmount: { currency: "HUF", amount: "1" },
        feeCurrency: "EUR",
      }).success,
    ).toBe(false);
  });

  it("requires an explicit reason when a numeric plan is excluded from ranking", () => {
    expect(
      planQuoteSchema.safeParse({
        ...numericPlanQuote,
        rankingEligibility: "EXCLUDED",
      }).success,
    ).toBe(false);
    expect(
      planQuoteSchema.safeParse({
        ...numericPlanQuote,
        rankingEligibility: "EXCLUDED",
        rankingExclusionReason: "The source observation is stale.",
      }).success,
    ).toBe(true);
  });
});
