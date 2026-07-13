import type { Provider, QuoteRequest, QuoteResult } from "@/domain/quote";

/**
 * Boundary for all provider-specific integrations. An adapter owns data retrieval,
 * validation and normalization; callers only receive the common QuoteResult union.
 */
export interface ProviderAdapter {
  readonly provider: Provider;
  getQuote(request: QuoteRequest, context?: ProviderAdapterContext): Promise<QuoteResult>;
}

export type ProviderAdapterContext = Readonly<{ signal: AbortSignal }>;
