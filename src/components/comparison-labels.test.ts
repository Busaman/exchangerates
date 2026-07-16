import { describe, expect, it } from "vitest";
import { bestResultBadgeLabel, isFeeCoverageIncompleteQuote } from "@/components/comparison-labels";
import { calculateRankingEffectiveRate } from "@/domain/quote-ranking";
import { availableQuoteSchema } from "@/domain/quote";
import { createMockQuote } from "@/providers/mock-provider";

describe("bestResultBadgeLabel", () => {
  it("qualifies a FULL_ALLOWANCE_ASSUMED Revolut best result", () => {
    const base = createMockQuote({
      providerId: "MOCK_PROVIDER",
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
      requestedAt: "2026-07-13T12:00:00.000Z",
    });
    const totalSourceCost = { currency: "EUR", amount: "1010" } as const;
    const quote = availableQuoteSchema.parse({
      ...base,
      provider: { id: "REVOLUT", name: "Revolut Personal (HU)" },
      sourceType: "LIVE_UNOFFICIAL",
      customerPlan: "STANDARD",
      rankingEffectiveRate: calculateRankingEffectiveRate({
        sourceAmount: base.sourceAmount,
        targetAmount: base.targetAmount,
        totalSourceCost,
      }),
      providerDetails: {
        type: "REVOLUT_PERSONAL",
        plan: "STANDARD",
        displayedBaseRate: "392.5",
        endpointRecipientAmount: base.targetAmount,
        targetAmountCalculation: "ENDPOINT_HUNDREDTH_UNIT_DECODED",
        fxFee: { currency: "EUR", amount: "10" },
        totalFee: { currency: "EUR", amount: "10" },
        feePercentage: "1",
        feePercentageBasis: "TOTAL_FEE_DIVIDED_BY_SENDER_AMOUNT",
        feeCurrency: "EUR",
        totalSourceCost,
        allowanceAssumption: "FULL_ALLOWANCE_ASSUMED",
        sessionClassification: "WEEKDAY",
        feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
        indicativeWarning: "Confirm the executable quote in the Revolut app.",
      },
    });

    expect(bestResultBadgeLabel(quote, "REVOLUT")).toBe(
      "Legjobb indikatív best-case eredmény · teljes keret feltételezve",
    );
    expect(bestResultBadgeLabel(quote, "MOCK_PROVIDER")).toBeNull();
  });

  it("suppresses the best badge for a weekend-unverified quote", () => {
    const base = createMockQuote({
      providerId: "MOCK_PROVIDER",
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
      requestedAt: "2026-07-15T12:00:00.000Z",
    });
    const quote = availableQuoteSchema.parse({
      ...base,
      provider: { id: "REVOLUT", name: "Revolut Personal (HU)" },
      sourceType: "LIVE_UNOFFICIAL",
      rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
      rankingExclusionReason: "WEEKEND_FEE_UNVERIFIED",
      customerPlan: "STANDARD",
      providerDetails: {
        type: "REVOLUT_PERSONAL",
        plan: "STANDARD",
        displayedBaseRate: "392.5",
        endpointRecipientAmount: base.targetAmount,
        targetAmountCalculation: "ENDPOINT_HUNDREDTH_UNIT_DECODED",
        fxFee: { currency: "EUR", amount: "0" },
        totalFee: { currency: "EUR", amount: "0" },
        feePercentage: "0",
        feePercentageBasis: "TOTAL_FEE_DIVIDED_BY_SENDER_AMOUNT",
        feeCurrency: "EUR",
        totalSourceCost: { currency: "EUR", amount: "1000" },
        allowanceAssumption: "FULL_ALLOWANCE_ASSUMED",
        sessionClassification: "WEEKEND",
        feeCoverage: "UNVERIFIED_WEEKEND",
        feeCoverageWarning: "Weekend fee coverage is not verified.",
        indicativeWarning: "Confirm in app.",
      },
    });

    expect(isFeeCoverageIncompleteQuote(quote)).toBe(true);
    expect(bestResultBadgeLabel(quote, "REVOLUT")).toBeNull();
  });
});
