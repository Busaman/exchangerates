import {
  unavailableQuoteSchema,
  type Provider,
  type QuoteRequest,
  type UnavailableQuote,
} from "@/domain/quote";

export function createProviderUnavailableResult({
  provider,
  request,
  reason,
  sourceId,
}: {
  provider: Provider;
  request: QuoteRequest;
  reason: string;
  sourceId: string;
}): UnavailableQuote {
  return unavailableQuoteSchema.parse({
    kind: "unavailable",
    provider,
    pair: {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
    },
    status: "UNAVAILABLE",
    freshness: "UNKNOWN",
    reliability: "NOT_APPLICABLE",
    retrievedAt: request.requestedAt,
    reason,
    sourceId,
  });
}
