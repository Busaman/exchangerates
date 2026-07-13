import {
  availableQuoteSchema,
  quoteRequestSchema,
  type Provider,
  type QuoteRequest,
} from "@/domain/quote";
import { decimal, decimalToPlainString } from "@/domain/decimal";
import type { ProviderAdapter, ProviderAdapterContext } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";
import { buildRevolutQuoteUrl, revolutPairKey } from "@/providers/revolut/revolut-config";
import {
  RevolutPublicQuoteClient,
  type RevolutQuoteClient,
} from "@/providers/revolut/revolut-quote-client";

export const revolutProvider: Provider = { id: "REVOLUT", name: "Revolut Personal (HU)" };
export const revolutIndicativeWarning =
  "Indicative public-converter quote. The endpoint cannot know prior rolling 30-day account usage and NeoRate assumes the full plan allowance remains. Confirm the executable rate and every fee in the Revolut app before exchanging.";

export type RevolutProviderAdapterDependencies = Readonly<{
  quoteClient?: RevolutQuoteClient;
}>;

export class RevolutProviderAdapter implements ProviderAdapter {
  readonly provider = revolutProvider;
  readonly #quoteClient: RevolutQuoteClient;

  constructor(dependencies: RevolutProviderAdapterDependencies = {}) {
    this.#quoteClient = dependencies.quoteClient ?? new RevolutPublicQuoteClient();
  }

  async getQuote(requestInput: QuoteRequest, context?: ProviderAdapterContext) {
    const request = quoteRequestSchema.parse(requestInput);
    const pair = revolutPairKey(request.sourceCurrency, request.targetCurrency);
    const personalContext = request.providerContexts?.REVOLUT;
    const sourceUrl =
      pair === undefined ? undefined : buildRevolutQuoteUrl(pair, request.sourceAmount);

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
          "Revolut Personal requires an explicit personal plan to select the endpoint fee quote.",
        sourceId: "revolut-public-json-quote",
        sourceUrl,
      });
    }

    let observation;
    try {
      observation = await this.#quoteClient.getQuote(
        { pair, sourceAmount: request.sourceAmount, plan: personalContext.plan },
        context?.signal,
      );
    } catch {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason:
          "The official Revolut public quote endpoint could not be fetched or validated. No fallback rate was substituted.",
        sourceId: "revolut-public-json-quote",
        sourceUrl,
      });
    }

    const effectiveRate = decimalToPlainString(
      decimal(observation.targetAmount).dividedBy(request.sourceAmount),
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
      targetAmount: { currency: request.targetCurrency, amount: observation.targetAmount },
      effectiveRate,
      explicitFee: observation.totalFee,
      totalCost: observation.totalFee,
      rateTimestamp: observation.rateTimestamp,
      retrievedAt: observation.retrievedAt,
      sourceType: "LIVE_UNOFFICIAL",
      status: observation.freshness === "STALE" ? "STALE" : "AVAILABLE",
      freshness: observation.freshness,
      reliability: "MEDIUM",
      sourceId: "revolut-public-json-quote",
      sourceUrl: observation.sourceUrl,
      customerPlan: personalContext.plan,
      disclaimer: revolutIndicativeWarning,
      providerDetails: {
        type: "REVOLUT_PERSONAL",
        plan: observation.plan,
        displayedBaseRate: observation.rate,
        fxFee: observation.fxFee,
        totalFee: observation.totalFee,
        feeCurrency: observation.totalFee.currency,
        totalSourceCost: observation.totalSourceCost,
        fxTooltip: observation.fxTooltip,
        planTooltipLong: observation.planTooltipLong,
        planTooltipShort: observation.planTooltipShort,
        allowanceAssumption: "FULL_ALLOWANCE_ASSUMED",
        indicativeWarning: revolutIndicativeWarning,
      },
    });
  }
}
