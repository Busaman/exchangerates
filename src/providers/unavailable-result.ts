import {
  providerErrorResultSchema,
  unavailableQuoteSchema,
  type ProviderErrorResult,
  type ProviderErrorCode,
  type Provider,
  type QuoteRequest,
  type UnavailableQuote,
} from "@/domain/quote";

export function createProviderUnavailableResult({
  provider,
  request,
  reason,
  sourceId,
  sourceUrl,
}: {
  provider: Provider;
  request: QuoteRequest;
  reason: string;
  sourceId: string;
  sourceUrl?: string;
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
    sourceUrl,
  });
}

export function createProviderErrorResult({
  provider,
  request,
  errorCode,
  reason,
}: {
  provider: Provider;
  request: QuoteRequest;
  errorCode: ProviderErrorCode;
  reason: string;
}): ProviderErrorResult {
  return providerErrorResultSchema.parse({
    kind: "error",
    provider,
    pair: {
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
    },
    status: "FAILED",
    freshness: "UNKNOWN",
    reliability: "NOT_APPLICABLE",
    retrievedAt: request.requestedAt,
    errorCode,
    reason,
  });
}
