import {
  availableQuoteSchema,
  quoteRequestSchema,
  type Provider,
  type QuoteRequest,
} from "@/domain/quote";
import type { ProviderAdapter, ProviderAdapterContext } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";
import { revolutPairKey, revolutSourceUrls } from "@/providers/revolut/revolut-config";
import { calculateRevolutPersonalQuote } from "@/providers/revolut/revolut-fees";
import {
  RevolutPublicPageRateSource,
  type RevolutRateSource,
} from "@/providers/revolut/revolut-rate-source";

export const revolutProvider: Provider = { id: "REVOLUT", name: "Revolut Personal (HU)" };
export const revolutIndicativeWarning =
  "Indicative public-page rate. Confirm the executable rate and every applicable fee in the Revolut app before exchanging.";

export type RevolutProviderAdapterDependencies = Readonly<{
  rateSource?: RevolutRateSource;
  now?: () => Date;
}>;

export class RevolutProviderAdapter implements ProviderAdapter {
  readonly provider = revolutProvider;
  readonly #rateSource: RevolutRateSource;
  readonly #now: () => Date;

  constructor(dependencies: RevolutProviderAdapterDependencies = {}) {
    this.#rateSource = dependencies.rateSource ?? new RevolutPublicPageRateSource();
    this.#now = dependencies.now ?? (() => new Date());
  }

  async getQuote(requestInput: QuoteRequest, context?: ProviderAdapterContext) {
    const request = quoteRequestSchema.parse(requestInput);
    const pair = revolutPairKey(request.sourceCurrency, request.targetCurrency);
    const personalContext = request.providerContexts?.REVOLUT;
    const sourceUrl = pair === undefined ? undefined : revolutSourceUrls[pair];

    if (pair === undefined) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: "Revolut Personal currently supports only EUR/HUF and HUF/EUR.",
        sourceId: "revolut-personal-unsupported-pair",
      });
    }
    if (personalContext === undefined) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason:
          "Revolut Personal requires an explicit plan and monthly HUF exchange usage to calculate fees.",
        sourceId: `revolut-public-page-${pair.toLowerCase()}`,
        sourceUrl,
      });
    }

    try {
      const observation = await this.#rateSource.getRate(pair, context?.signal);
      const calculation = calculateRevolutPersonalQuote({
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
        sourceAmount: request.sourceAmount,
        displayedBaseRate: observation.rate,
        personalContext,
        at: this.#now(),
      });
      const fee = (amount: string) => ({ currency: calculation.feeCurrency, amount });

      return availableQuoteSchema.parse({
        kind: "quote",
        provider: this.provider,
        pair: {
          sourceCurrency: request.sourceCurrency,
          targetCurrency: request.targetCurrency,
        },
        direction: "SELL_SOURCE_BUY_TARGET",
        sourceAmount: { currency: request.sourceCurrency, amount: request.sourceAmount },
        targetAmount: { currency: request.targetCurrency, amount: calculation.targetAmount },
        effectiveRate: calculation.effectiveRate,
        explicitFee: fee(calculation.totalFee),
        totalCost: fee(calculation.totalFee),
        rateTimestamp: observation.rateTimestamp,
        retrievedAt: observation.retrievedAt,
        sourceType: "LIVE_UNOFFICIAL",
        status: observation.freshness === "STALE" ? "STALE" : "AVAILABLE",
        freshness: observation.freshness,
        reliability: "MEDIUM",
        sourceId: `revolut-public-page-${pair.toLowerCase()}`,
        sourceUrl: observation.sourceUrl,
        customerPlan: personalContext.plan,
        disclaimer: revolutIndicativeWarning,
        providerDetails: {
          type: "REVOLUT_PERSONAL",
          plan: calculation.plan,
          displayedBaseRate: calculation.displayedBaseRate,
          fairUsageFee: fee(calculation.fairUsageFee),
          weekendFee: fee(calculation.weekendFee),
          totalFee: fee(calculation.totalFee),
          feeCurrency: calculation.feeCurrency,
          fairUsageAllowanceHuf: calculation.fairUsageAllowanceHuf,
          allowanceUsedBeforeQuoteHuf: calculation.allowanceUsedBeforeQuoteHuf,
          allowanceConsumedByQuoteHuf: calculation.allowanceConsumedByQuoteHuf,
          remainingAllowanceAfterQuoteHuf: calculation.remainingAllowanceAfterQuoteHuf,
          marketSession: calculation.marketSession,
          indicativeWarning: revolutIndicativeWarning,
        },
      });
    } catch {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason:
          "The official Revolut public page could not be fetched or validated. No fallback rate was substituted.",
        sourceId: `revolut-public-page-${pair.toLowerCase()}`,
        sourceUrl,
      });
    }
  }
}
