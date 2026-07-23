import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { compareDecimalStrings } from "@/domain/decimal";
import {
  quoteApiRequestSchema,
  quoteApiResponseSchema,
  type QuoteApiRequest,
  type QuoteApiResponse,
} from "@/domain/quote-api";
import {
  quoteResultSchema,
  type AvailableQuote,
  type ProviderErrorCode,
  type QuoteRequest,
  type QuoteResult,
} from "@/domain/quote";
import { logger } from "@/lib/logger";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { ProviderAdapterRegistry, providerRegistry } from "@/providers/provider-registry";
import {
  createProviderErrorResult,
  createProviderUnavailableResult,
} from "@/providers/unavailable-result";

export const defaultProviderTimeoutMs = 2_000;

class ProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Provider timed out after ${timeoutMs}ms`);
    this.name = "ProviderTimeoutError";
  }
}

export type QuoteServiceDependencies = Readonly<{
  registry?: ProviderAdapterRegistry;
  providerTimeoutMs?: number;
  now?: () => Date;
  createRequestId?: () => string;
}>;

async function callWithTimeout(
  adapter: ProviderAdapter,
  request: QuoteRequest,
  timeoutMs: number,
): Promise<QuoteResult> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new ProviderTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      adapter.getQuote(request, { signal: controller.signal }),
      timeout,
    ]);
    return quoteResultSchema.parse(result);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

function errorCodeFor(error: unknown): ProviderErrorCode {
  if (error instanceof ProviderTimeoutError) return "PROVIDER_TIMEOUT";
  if (error instanceof ZodError) return "PROVIDER_INVALID_RESPONSE";
  return "PROVIDER_EXCEPTION";
}

function publicReasonFor(errorCode: ProviderErrorCode): string {
  if (errorCode === "PROVIDER_TIMEOUT") return "The provider did not respond in time.";
  if (errorCode === "PROVIDER_INVALID_RESPONSE")
    return "The provider returned an invalid response.";
  return "The provider quote could not be retrieved.";
}

function isRankableQuote(result: QuoteResult): boolean {
  return (
    result.kind === "quote" &&
    result.status === "AVAILABLE" &&
    result.freshness !== "STALE" &&
    result.rankingStatus === "ELIGIBLE"
  );
}

function compareRankableQuotes(left: AvailableQuote, right: AvailableQuote): number {
  const rateComparison = compareDecimalStrings(
    right.rankingEffectiveRate,
    left.rankingEffectiveRate,
  );
  if (rateComparison !== 0) return rateComparison;
  if (left.provider.id === right.provider.id) return 0;
  return left.provider.id < right.provider.id ? -1 : 1;
}

export async function getQuotes(
  requestInput: QuoteApiRequest,
  dependencies: QuoteServiceDependencies = {},
): Promise<QuoteApiResponse> {
  const request = quoteApiRequestSchema.parse(requestInput);
  const registry = dependencies.registry ?? providerRegistry;
  const now = dependencies.now ?? (() => new Date());
  const requestId = (dependencies.createRequestId ?? randomUUID)();
  const generatedAt = now().toISOString();
  const providerIds = request.providers ?? registry.list().map((provider) => provider.id);

  const results = await Promise.all(
    providerIds.map(async (providerId) => {
      const registration = registry.get(providerId);
      const providerRequest: QuoteRequest = {
        providerId,
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
        sourceAmount: request.sourceAmount,
        customerPlan: request.customerPlan ?? undefined,
        providerContexts: request.providerContexts,
        requestedAt: generatedAt,
      };

      if (registration.status === "UNAVAILABLE") {
        return createProviderUnavailableResult({
          provider: registration.adapter.provider,
          request: providerRequest,
          reason: registration.reason,
          sourceId: registration.sourceId,
        });
      }

      const timeoutMs =
        dependencies.providerTimeoutMs ?? registration.timeoutMs ?? defaultProviderTimeoutMs;

      try {
        return await callWithTimeout(registration.adapter, providerRequest, timeoutMs);
      } catch (error) {
        const errorCode = errorCodeFor(error);
        logger.error("Provider quote failed", error, { providerId, requestId });
        return createProviderErrorResult({
          provider: registration.adapter.provider,
          request: providerRequest,
          errorCode,
          reason: publicReasonFor(errorCode),
        });
      }
    }),
  );

  const quotes = results
    .filter((result): result is AvailableQuote => result.kind === "quote")
    .toSorted((left, right) => {
      const leftRankable = isRankableQuote(left);
      const rightRankable = isRankableQuote(right);
      if (leftRankable && rightRankable) return compareRankableQuotes(left, right);
      if (leftRankable) return -1;
      if (rightRankable) return 1;
      if (left.provider.id === right.provider.id) return 0;
      return left.provider.id < right.provider.id ? -1 : 1;
    });
  const issues = results.filter((result) => result.kind !== "quote");
  const rankableQuotes = quotes.filter(isRankableQuote);
  const bestProviderId = rankableQuotes[0]?.provider.id ?? null;
  const sourceStatus =
    rankableQuotes.length === 0
      ? quotes.length === 0
        ? "NO_AVAILABLE_QUOTES"
        : "NO_RANKABLE_QUOTES"
      : rankableQuotes.length < results.length
        ? "PARTIAL_SUCCESS"
        : "SUCCESS";
  const warnings = [
    ...(quotes.some((quote) => quote.sourceType === "MOCK") ? (["MOCK_DATA"] as const) : []),
    ...(quotes.some(
      (quote) => quote.provider.id === "REVOLUT" && quote.sourceType === "LIVE_UNOFFICIAL",
    )
      ? (["REVOLUT_INDICATIVE"] as const)
      : []),
    ...(quotes.some(
      (quote) =>
        quote.provider.id === "REVOLUT" && quote.rankingStatus === "EXCLUDED_INCOMPLETE_FEES",
    )
      ? (["REVOLUT_FEE_INCOMPLETE"] as const)
      : []),
    ...(quotes.some((quote) => quote.provider.id === "ZEN" && quote.planQuotes !== undefined)
      ? (["ZEN_INDICATIVE"] as const)
      : []),
    ...(quotes.some(
      (quote) => quote.provider.id === "WISE" && quote.sourceType === "LIVE_UNOFFICIAL",
    )
      ? (["WISE_INDICATIVE"] as const)
      : []),
  ];

  return quoteApiResponseSchema.parse({
    request: {
      id: requestId,
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
      sourceAmount: request.sourceAmount,
      providers: providerIds,
      customerPlan: request.customerPlan ?? null,
      providerContexts: request.providerContexts,
    },
    quotes,
    issues,
    bestProviderId,
    generatedAt,
    sourceStatus,
    warnings,
  });
}
