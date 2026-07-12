import {
  quoteRequestSchema,
  unavailableQuoteSchema,
  type Provider,
  type QuoteRequest,
  type UnavailableQuote,
} from "@/domain/quote";
import type { ProviderAdapter } from "@/providers/provider-adapter";

export const unavailableProvider: Provider = { id: "wise", name: "Wise" };

export function createUnavailableQuote(requestInput: QuoteRequest): UnavailableQuote {
  const request = quoteRequestSchema.parse(requestInput);

  return unavailableQuoteSchema.parse({
    kind: "unavailable",
    provider: unavailableProvider,
    pair: {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
    },
    status: "UNAVAILABLE",
    freshness: "UNKNOWN",
    reliability: "NOT_APPLICABLE",
    retrievedAt: request.requestedAt,
    reason: "No verified provider integration is configured in the foundation phase.",
    sourceId: "foundation-unavailable-example",
  });
}

export class UnavailableProviderAdapter implements ProviderAdapter {
  readonly provider = unavailableProvider;

  async getQuote(request: QuoteRequest): Promise<UnavailableQuote> {
    return Promise.resolve(createUnavailableQuote(request));
  }
}
