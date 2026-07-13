import { describe, expect, it } from "vitest";
import { bestResultBadgeLabel } from "@/components/comparison-labels";
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
        fxFee: { currency: "EUR", amount: "10" },
        totalFee: { currency: "EUR", amount: "10" },
        feeCurrency: "EUR",
        totalSourceCost,
        allowanceAssumption: "FULL_ALLOWANCE_ASSUMED",
        indicativeWarning: "Confirm the executable quote in the Revolut app.",
      },
    });

    expect(bestResultBadgeLabel(quote, "REVOLUT")).toBe(
      "Legjobb indikatív best-case eredmény · teljes keret feltételezve",
    );
    expect(bestResultBadgeLabel(quote, "MOCK_PROVIDER")).toBeNull();
  });
});
