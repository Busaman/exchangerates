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
import {
  isWisePair,
  wiseComparisonEndpoint,
  wiseComparisonSourceId,
} from "@/providers/wise/wise-config";
import { WisePublicQuoteClient, type WiseQuoteClient } from "@/providers/wise/wise-quote-client";

export const wiseProvider: Provider = { id: "WISE", name: "Wise" };
export const wisePersonalPlan = "Personal / Alapárazás" as const;
export const wiseIndicativeWarning =
  "Indicative public Wise comparison quote for Hungary. It assumes the comparison endpoint's bank-transfer funding context and is not an account-specific or executable transfer quote. Confirm the final amount and funding method in Wise before transferring.";

export type WiseProviderAdapterDependencies = Readonly<{
  quoteClient?: WiseQuoteClient;
}>;

export class WiseProviderAdapter implements ProviderAdapter {
  readonly provider = wiseProvider;
  readonly #quoteClient: WiseQuoteClient;

  constructor(dependencies: WiseProviderAdapterDependencies = {}) {
    this.#quoteClient = dependencies.quoteClient ?? new WisePublicQuoteClient();
  }

  async getQuote(requestInput: QuoteRequest, context?: ProviderAdapterContext) {
    const request = quoteRequestSchema.parse(requestInput);
    if (!isWisePair(request.sourceCurrency, request.targetCurrency)) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: "Wise Personal currently supports only EUR/HUF and HUF/EUR in NeoRate.",
        sourceId: wiseComparisonSourceId,
        sourceUrl: wiseComparisonEndpoint,
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
    } catch {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason:
          "The public Wise comparison endpoint did not return one valid Wise quote for this exact amount. No fallback rate was substituted.",
        sourceId: wiseComparisonSourceId,
        sourceUrl: wiseComparisonEndpoint,
      });
    }

    const totalSourceCost = {
      currency: request.sourceCurrency,
      amount: request.sourceAmount,
    } as const;
    const targetAmount = {
      currency: request.targetCurrency,
      amount: observation.targetAmount,
    } as const;
    const rankingEffectiveRate = calculateRankingEffectiveRate({
      sourceAmount: totalSourceCost,
      targetAmount,
      totalSourceCost,
    });
    const inverseRate = decimalToPlainString(decimal(1).dividedBy(observation.rate));
    const rankingEligibility =
      observation.freshness === "FRESH" ? "DEFAULT_PLAN_ELIGIBLE" : "EXCLUDED";

    return availableQuoteSchema.parse({
      kind: "quote",
      provider: this.provider,
      pair: {
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
      },
      direction: "SELL_SOURCE_BUY_TARGET",
      sourceAmount: totalSourceCost,
      targetAmount,
      effectiveRate: observation.effectiveRate,
      rankingEffectiveRate,
      rankingStatus: "ELIGIBLE",
      explicitFee: { currency: request.sourceCurrency, amount: observation.fee },
      totalCost: { currency: request.sourceCurrency, amount: observation.fee },
      rateTimestamp: observation.rateTimestamp,
      retrievedAt: observation.retrievedAt,
      sourceType: "LIVE_UNOFFICIAL",
      status: observation.freshness === "STALE" ? "STALE" : "AVAILABLE",
      freshness: observation.freshness,
      reliability: "MEDIUM",
      sourceId: wiseComparisonSourceId,
      sourceUrl: observation.sourceUrl,
      customerPlan: wisePersonalPlan,
      disclaimer: wiseIndicativeWarning,
      planQuotes: [
        {
          quoteKind: "live",
          provider: "WISE",
          plan: wisePersonalPlan,
          isDefaultPlan: true,
          isPaidPlan: false,
          monthlyFee: { currency: "EUR", amount: "0" },
          baseMarkup: observation.markup,
          excessMarkup: "0",
          offMarketMarkup: "0",
          totalMarkup: observation.markup,
          pricingWindow: "NOT_APPLICABLE",
          calculationNote:
            "The public comparison result includes the endpoint-returned Wise fee once. It assumes bank-transfer funding and is not account-specific.",
          source: {
            sourceType: "LIVE_UNOFFICIAL",
            sourceId: wiseComparisonSourceId,
            sourceUrl: observation.sourceUrl,
          },
          fetchedAt: observation.retrievedAt,
          rankingEligibility,
          ...(rankingEligibility === "EXCLUDED"
            ? { rankingExclusionReason: "Stale Wise comparison observations cannot rank." }
            : {}),
          liveBaseRate: observation.rate,
          effectiveRate: observation.effectiveRate,
          inverseRate,
          feeAmount: { currency: request.sourceCurrency, amount: observation.fee },
          feeCurrency: request.sourceCurrency,
          totalSourceCost,
          recipientGets: targetAmount,
        },
      ],
      providerDetails: {
        type: "WISE_PERSONAL",
        plan: wisePersonalPlan,
        displayedBaseRate: observation.rate,
        endpointFee: { currency: request.sourceCurrency, amount: observation.fee },
        totalSourceCost,
        markup: observation.markup,
        isConsideredMidMarketRate: observation.isConsideredMidMarketRate,
        fundingContext: "BANK_TRANSFER_COMPARISON",
        quoteScope: "PUBLIC_COMPARISON_NOT_ACCOUNT_SPECIFIC",
        indicativeWarning: wiseIndicativeWarning,
      },
    });
  }
}
