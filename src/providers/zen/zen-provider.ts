import { decimal, decimalToPlainString } from "@/domain/decimal";
import {
  availableQuoteSchema,
  quoteRequestSchema,
  type Provider,
  type QuoteRequest,
} from "@/domain/quote";
import { calculateRankingEffectiveRate } from "@/domain/quote-ranking";
import type { ProviderAdapter, ProviderAdapterContext } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";
import { isZenPair, zenQuoteEndpoint, zenQuoteSourceId } from "@/providers/zen/zen-config";
import {
  ZenPublicQuoteClient,
  ZenQuoteClientError,
  type ZenQuoteClient,
} from "@/providers/zen/zen-quote-client";
import {
  calculateZenPlanQuotes,
  zenPricingPolicyRetrievedAt,
} from "@/providers/zen/zen-plan-policy";
import type { NumericPlanQuote } from "@/domain/plan-quote";

export const zenProvider: Provider = { id: "ZEN", name: "ZEN.COM" };
export const zenIndicativeWarning =
  "Indicative ZEN Pro quote from an undocumented public ZEN.COM webpage endpoint. The endpoint does not provide a provider-side rate timestamp, so NeoRate uses retrieval time as the observation timestamp. Confirm the executable amount in the ZEN.COM app before exchanging.";

export type ZenProviderAdapterDependencies = Readonly<{
  quoteClient?: ZenQuoteClient;
}>;

function publicUnavailableReason(error: unknown): string {
  if (error instanceof ZenQuoteClientError && error.code === "HTTP_403") {
    return "The public ZEN.COM endpoint blocked the server-side request with HTTP 403. No fallback rate was substituted.";
  }
  if (error instanceof ZenQuoteClientError && error.code === "TIMEOUT") {
    return "The public ZEN.COM endpoint did not respond before the strict timeout. No fallback rate was substituted.";
  }
  if (error instanceof ZenQuoteClientError && error.code === "UNREPRESENTABLE_SOURCE_AMOUNT") {
    return "ZEN Pro quotes require a source amount exactly representable with at most two decimal places.";
  }
  return "The public ZEN.COM response could not be fetched or validated. No fallback rate was substituted.";
}

export class ZenProviderAdapter implements ProviderAdapter {
  readonly provider = zenProvider;
  readonly #quoteClient: ZenQuoteClient;

  constructor(dependencies: ZenProviderAdapterDependencies = {}) {
    this.#quoteClient = dependencies.quoteClient ?? new ZenPublicQuoteClient();
  }

  async getQuote(requestInput: QuoteRequest, context?: ProviderAdapterContext) {
    const request = quoteRequestSchema.parse(requestInput);
    if (!isZenPair(request.sourceCurrency, request.targetCurrency)) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: "ZEN Pro currently supports only EUR/HUF and HUF/EUR in NeoRate.",
        sourceId: zenQuoteSourceId,
        sourceUrl: zenQuoteEndpoint,
      });
    }

    let observation;
    try {
      observation = await this.#quoteClient.getQuote(
        {
          sourceCurrency: request.sourceCurrency,
          targetCurrency: request.targetCurrency,
          sourceAmount: request.sourceAmount,
        },
        context?.signal,
      );
    } catch (error) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: publicUnavailableReason(error),
        sourceId: zenQuoteSourceId,
        sourceUrl: zenQuoteEndpoint,
      });
    }

    let planQuotes;
    try {
      planQuotes = calculateZenPlanQuotes({
        liveProRate: observation.exchangeRate,
        sourceAmount: request.sourceAmount,
        endpointTargetAmount: observation.targetAmount,
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
        fetchedAt: observation.retrievedAt,
        pricingAt: request.requestedAt,
        freshness: observation.freshness,
      });
    } catch {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: "ZEN plan quotes could not be normalized safely from the validated public quote.",
        sourceId: zenQuoteSourceId,
        sourceUrl: observation.sourceUrl,
      });
    }
    const defaultPlan = planQuotes.find(
      (planQuote): planQuote is NumericPlanQuote =>
        planQuote.isDefaultPlan && planQuote.quoteKind !== "unavailable",
    );
    if (defaultPlan === undefined) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: "ZEN Free could not be derived safely from the validated live ZEN Pro quote.",
        sourceId: zenQuoteSourceId,
        sourceUrl: zenQuoteEndpoint,
      });
    }
    const effectiveRate = defaultPlan.effectiveRate;
    const rankingEffectiveRate = calculateRankingEffectiveRate({
      sourceAmount: { currency: request.sourceCurrency, amount: request.sourceAmount },
      targetAmount: defaultPlan.recipientGets,
    });
    const sourceCurrencyPerTargetUnit = decimalToPlainString(
      decimal(1).dividedBy(observation.exchangeRate),
    );

    return availableQuoteSchema.parse({
      kind: "quote",
      provider: this.provider,
      pair: {
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
      },
      direction: "SELL_SOURCE_BUY_TARGET",
      sourceAmount: { currency: request.sourceCurrency, amount: request.sourceAmount },
      targetAmount: defaultPlan.recipientGets,
      effectiveRate,
      rankingEffectiveRate,
      rankingStatus: "ELIGIBLE",
      explicitFee: { currency: request.sourceCurrency, amount: "0" },
      totalCost: { currency: request.sourceCurrency, amount: "0" },
      rateTimestamp: observation.retrievedAt,
      retrievedAt: observation.retrievedAt,
      sourceType: "ESTIMATED",
      status: observation.freshness === "STALE" ? "STALE" : "AVAILABLE",
      freshness: observation.freshness,
      reliability: "MEDIUM",
      sourceId: zenQuoteSourceId,
      sourceUrl: observation.sourceUrl,
      customerPlan: "Free",
      disclaimer: zenIndicativeWarning,
      planQuotes,
      providerDetails: {
        type: "ZEN_PLANS",
        defaultPlan: "Free",
        liveProRate: observation.exchangeRate,
        sourceCurrencyPerTargetUnit,
        endpointProTargetAmount: {
          currency: request.targetCurrency,
          amount: observation.targetAmount,
        },
        targetAmountCalculation: "POLICY_DERIVED_TARGET_CURRENCY_ROUND_DOWN",
        feeDisclosure: "ZERO_ADDITIONAL_ZEN_FEE_PUBLIC_PAGE",
        rateTimestampBasis: "RETRIEVAL_TIME_SOURCE_HAS_NO_TIMESTAMP",
        pricingPolicyRetrievedAt: zenPricingPolicyRetrievedAt,
        indicativeWarning: zenIndicativeWarning,
      },
    });
  }
}
