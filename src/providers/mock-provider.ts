import {
  availableQuoteSchema,
  quoteRequestSchema,
  type AvailableQuote,
  type Provider,
  type QuoteRequest,
} from "@/domain/quote";
import { currencyFractionDigits, decimal, roundDecimal } from "@/domain/decimal";
import { calculateRankingEffectiveRate } from "@/domain/quote-ranking";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";

export const mockProvider: Provider = { id: "MOCK_PROVIDER", name: "Demo Fintech" };

const rates = {
  "EUR-HUF": "392.5",
  "HUF-EUR": "0.00249",
} as const;
const feeRate = "0.003";
const effectiveRateFractionDigits = 8;

export function createMockQuote(requestInput: QuoteRequest): AvailableQuote {
  const request = quoteRequestSchema.parse(requestInput);
  const pairKey = `${request.sourceCurrency}-${request.targetCurrency}` as keyof typeof rates;
  const rate = rates[pairKey];

  if (rate === undefined) {
    throw new Error(`Mock provider does not support ${pairKey}`);
  }

  const sourceAmount = decimal(request.sourceAmount);
  const fee = roundDecimal(
    sourceAmount.times(feeRate),
    currencyFractionDigits[request.sourceCurrency],
  );
  const targetAmount = roundDecimal(
    sourceAmount.minus(fee).times(rate),
    currencyFractionDigits[request.targetCurrency],
  );
  const effectiveRate = roundDecimal(
    decimal(targetAmount).dividedBy(sourceAmount),
    effectiveRateFractionDigits,
  );
  const rankingEffectiveRate = calculateRankingEffectiveRate({
    sourceAmount: { currency: request.sourceCurrency, amount: request.sourceAmount },
    targetAmount: { currency: request.targetCurrency, amount: targetAmount },
  });

  return availableQuoteSchema.parse({
    kind: "quote",
    provider: mockProvider,
    pair: {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
    },
    direction: "SELL_SOURCE_BUY_TARGET",
    sourceAmount: { currency: request.sourceCurrency, amount: request.sourceAmount },
    targetAmount: { currency: request.targetCurrency, amount: targetAmount },
    effectiveRate,
    rankingEffectiveRate,
    rankingStatus: "ELIGIBLE",
    explicitFee: { currency: request.sourceCurrency, amount: fee },
    totalCost: { currency: request.sourceCurrency, amount: fee },
    rateTimestamp: request.requestedAt,
    retrievedAt: request.requestedAt,
    sourceType: "MOCK",
    status: "AVAILABLE",
    freshness: "FRESH",
    reliability: "LOW",
    sourceId: "deterministic-foundation-v2",
    customerPlan: request.customerPlan,
    disclaimer: "Deterministic development fixture; this is not a live or executable rate.",
  });
}

export class MockProviderAdapter implements ProviderAdapter {
  readonly provider = mockProvider;

  async getQuote(request: QuoteRequest) {
    try {
      return await Promise.resolve(createMockQuote(request));
    } catch {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: `The deterministic mock does not support ${request.sourceCurrency}/${request.targetCurrency}.`,
        sourceId: "deterministic-foundation-v2-unavailable",
      });
    }
  }
}
