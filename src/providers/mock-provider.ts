import {
  availableQuoteSchema,
  quoteRequestSchema,
  type AvailableQuote,
  type Provider,
  type QuoteRequest,
} from "@/domain/quote";
import { formatMockDecimal } from "@/domain/decimal";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";

export const mockProvider: Provider = { id: "mock-fintech", name: "Demo Fintech" };

const rates: Readonly<Record<string, number>> = {
  "EUR-HUF": 392.5,
  "HUF-EUR": 0.00249,
};

export function createMockQuote(requestInput: QuoteRequest): AvailableQuote {
  const request = quoteRequestSchema.parse(requestInput);
  const pairKey = `${request.sourceCurrency}-${request.targetCurrency}`;
  const rate = rates[pairKey];

  if (rate === undefined) {
    throw new Error(`Mock provider does not support ${pairKey}`);
  }

  const sourceAmount = Number(request.sourceAmount);
  const fee = sourceAmount * 0.003;
  const targetAmount = (sourceAmount - fee) * rate;

  return availableQuoteSchema.parse({
    kind: "quote",
    provider: mockProvider,
    pair: {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
    },
    direction: "SELL_SOURCE_BUY_TARGET",
    sourceAmount: {
      currency: request.sourceCurrency,
      amount: formatMockDecimal(sourceAmount, 2),
    },
    targetAmount: {
      currency: request.targetCurrency,
      amount: formatMockDecimal(targetAmount, request.targetCurrency === "HUF" ? 0 : 2),
    },
    effectiveRate: formatMockDecimal(targetAmount / sourceAmount, 8),
    explicitFee: {
      currency: request.sourceCurrency,
      amount: formatMockDecimal(fee, 2),
    },
    totalCost: { currency: request.sourceCurrency, amount: formatMockDecimal(fee, 2) },
    rateTimestamp: request.requestedAt,
    retrievedAt: request.requestedAt,
    sourceType: "MOCK",
    status: "AVAILABLE",
    freshness: "FRESH",
    reliability: "LOW",
    sourceId: "deterministic-foundation-v1",
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
        sourceId: "deterministic-foundation-v1-unavailable",
      });
    }
  }
}
