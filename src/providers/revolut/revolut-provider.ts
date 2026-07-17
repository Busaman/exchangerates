import {
  availableQuoteSchema,
  quoteRequestSchema,
  type Provider,
  type QuoteRequest,
} from "@/domain/quote";
import { decimal, decimalToPlainString, roundDecimal } from "@/domain/decimal";
import {
  calculateSourceSideFeePercentage,
  sourceSideFeePercentageBasis,
} from "@/domain/fee-percentage";
import { calculateRankingEffectiveRate } from "@/domain/quote-ranking";
import type { ProviderAdapter, ProviderAdapterContext } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";
import { buildRevolutQuoteUrl, revolutPairKey } from "@/providers/revolut/revolut-config";
import { toRevolutApiAmount } from "@/providers/revolut/revolut-money";
import {
  RevolutQuoteClientError,
  RevolutPublicQuoteClient,
  type RevolutQuoteClient,
} from "@/providers/revolut/revolut-quote-client";
import { evaluateRevolutFeeCoverage } from "@/providers/revolut/revolut-fee-coverage";
import { calculateRevolutPlanQuotes } from "@/providers/revolut/revolut-plan-policy";

export const revolutProvider: Provider = { id: "REVOLUT", name: "Revolut Personal (HU)" };
export const revolutIndicativeWarning =
  "Indicative public-converter quote. Revolut monetary integers are decoded from fixed hundredths into normal major units at the adapter boundary. The endpoint cannot know prior rolling 30-day account usage and NeoRate assumes the full plan allowance remains. Confirm the executable rate and every fee in the Revolut app before exchanging.";

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
    let sourceUrl: string | undefined;
    if (pair !== undefined) {
      try {
        sourceUrl = buildRevolutQuoteUrl(pair, toRevolutApiAmount(request.sourceAmount));
      } catch {
        sourceUrl = undefined;
      }
    }

    if (pair === undefined) {
      return createProviderUnavailableResult({
        provider: this.provider,
        request,
        reason: "Revolut Personal currently supports only EUR/HUF and HUF/EUR.",
        sourceId: "revolut-personal-unsupported-pair",
      });
    }
    let observation;
    try {
      observation = await this.#quoteClient.getQuote(
        { pair, sourceAmount: request.sourceAmount, plan: "STANDARD" },
        context?.signal,
      );
    } catch (error) {
      if (error instanceof RevolutQuoteClientError && error.code === "SELECTED_PLAN_MISSING") {
        return createProviderUnavailableResult({
          provider: this.provider,
          request,
          reason: "The public Revolut endpoint did not return the required STANDARD plan.",
          sourceId: "revolut-public-json-quote",
          sourceUrl,
        });
      }
      if (
        error instanceof RevolutQuoteClientError &&
        error.code === "UNREPRESENTABLE_SOURCE_AMOUNT"
      ) {
        return createProviderUnavailableResult({
          provider: this.provider,
          request,
          reason:
            "The Revolut public endpoint accepts source amounts representable in exact hundredths only.",
          sourceId: "revolut-public-json-quote",
          sourceUrl,
        });
      }
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
    const rankingEffectiveRate = calculateRankingEffectiveRate({
      sourceAmount: { currency: request.sourceCurrency, amount: request.sourceAmount },
      targetAmount: { currency: request.targetCurrency, amount: observation.targetAmount },
      totalSourceCost: observation.totalSourceCost,
    });
    const feePercentage = calculateSourceSideFeePercentage({
      totalFee: observation.totalFee.amount,
      senderAmount: request.sourceAmount,
    });
    const feeCoverage = evaluateRevolutFeeCoverage({ at: new Date(request.requestedAt) });
    const planQuotes = calculateRevolutPlanQuotes({
      observation,
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
      requestedAt: request.requestedAt,
    });

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
      rankingEffectiveRate,
      rankingStatus: feeCoverage.rankingStatus,
      rankingExclusionReason: feeCoverage.rankingExclusionReason,
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
      customerPlan: "STANDARD",
      disclaimer: revolutIndicativeWarning,
      planQuotes,
      providerDetails: {
        type: "REVOLUT_PERSONAL",
        plan: observation.plan,
        displayedBaseRate: observation.rate,
        ...(request.sourceCurrency === "HUF" && request.targetCurrency === "EUR"
          ? {
              sourceCurrencyPerTargetUnit: roundDecimal(decimal(1).dividedBy(observation.rate), 2),
            }
          : {}),
        endpointRecipientAmount: {
          currency: request.targetCurrency,
          amount: observation.endpointRecipientAmount,
        },
        targetAmountCalculation: observation.targetAmountCalculation,
        fxFee: observation.fxFee,
        totalFee: observation.totalFee,
        feePercentage,
        feePercentageBasis: sourceSideFeePercentageBasis,
        feeCurrency: observation.totalFee.currency,
        totalSourceCost: observation.totalSourceCost,
        fxTooltip: observation.fxTooltip,
        planTooltipLong: observation.planTooltipLong,
        planTooltipShort: observation.planTooltipShort,
        allowanceAssumption: "FULL_ALLOWANCE_ASSUMED",
        sessionClassification: feeCoverage.sessionClassification,
        feeCoverage: feeCoverage.feeCoverage,
        feeCoverageWarning: feeCoverage.feeCoverageWarning,
        indicativeWarning: revolutIndicativeWarning,
      },
    });
  }
}
