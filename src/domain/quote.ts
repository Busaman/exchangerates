import { z } from "zod";
import { decimal, decimalPattern } from "@/domain/decimal";
import { calculateRankingEffectiveRate } from "@/domain/quote-ranking";
import { planQuoteSchema } from "@/domain/plan-quote";

export const providerIdentifierSchema = z.enum([
  "MOCK_PROVIDER",
  "UNAVAILABLE_PROVIDER",
  "REVOLUT",
  "ZEN",
]);
export const supportedCurrencyCodeSchema = z.enum(["EUR", "HUF"]);
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const decimalStringSchema = z
  .string()
  .regex(decimalPattern, "Expected a non-negative plain decimal string");
export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => value !== "0" && !/^0\.0*$/.test(value),
  "Amount must be greater than zero",
);

export const quoteSourceTypeSchema = z.enum([
  "LIVE_OFFICIAL",
  "LIVE_UNOFFICIAL",
  "ESTIMATED",
  "MOCK",
]);
export const quoteDataStatusSchema = z.enum(["AVAILABLE", "UNAVAILABLE", "STALE", "FAILED"]);
export const freshnessSchema = z.enum(["FRESH", "AGING", "STALE", "UNKNOWN"]);
export const reliabilitySchema = z.enum(["VERIFIED", "HIGH", "MEDIUM", "LOW", "NOT_APPLICABLE"]);
export const providerErrorCodeSchema = z.enum([
  "PROVIDER_TIMEOUT",
  "PROVIDER_EXCEPTION",
  "PROVIDER_INVALID_RESPONSE",
]);

export const revolutPersonalPlanSchema = z.enum(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"]);
export const rankingStatusSchema = z.enum(["ELIGIBLE", "EXCLUDED_INCOMPLETE_FEES"]);
export const rankingExclusionReasonSchema = z.literal("WEEKEND_FEE_UNVERIFIED");

export const revolutPersonalContextSchema = z
  .object({
    plan: revolutPersonalPlanSchema,
  })
  .strict();

export const providerContextsSchema = z
  .object({
    REVOLUT: revolutPersonalContextSchema.optional(),
  })
  .strict();

export const providerSchema = z.object({
  id: providerIdentifierSchema,
  name: z.string().min(1),
});

export const currencyPairSchema = z
  .object({
    sourceCurrency: currencyCodeSchema,
    targetCurrency: currencyCodeSchema,
  })
  .refine((pair) => pair.sourceCurrency !== pair.targetCurrency, {
    message: "Source and target currency must differ",
  });

export const monetaryAmountSchema = z.object({
  currency: currencyCodeSchema,
  amount: decimalStringSchema,
});

export const positiveMonetaryAmountSchema = z.object({
  currency: currencyCodeSchema,
  amount: positiveDecimalStringSchema,
});

const revolutProviderDetailsSchema = z
  .object({
    type: z.literal("REVOLUT_PERSONAL"),
    plan: revolutPersonalPlanSchema,
    displayedBaseRate: positiveDecimalStringSchema,
    sourceCurrencyPerTargetUnit: positiveDecimalStringSchema.optional(),
    endpointRecipientAmount: monetaryAmountSchema,
    targetAmountCalculation: z.literal("ENDPOINT_HUNDREDTH_UNIT_DECODED"),
    fxFee: monetaryAmountSchema,
    totalFee: monetaryAmountSchema,
    feePercentage: decimalStringSchema,
    feePercentageBasis: z.literal("TOTAL_FEE_DIVIDED_BY_SENDER_AMOUNT"),
    feeCurrency: currencyCodeSchema,
    totalSourceCost: monetaryAmountSchema,
    fxTooltip: z.string().min(1).optional(),
    planTooltipLong: z.string().min(1).optional(),
    planTooltipShort: z.string().min(1).optional(),
    allowanceAssumption: z.literal("FULL_ALLOWANCE_ASSUMED"),
    sessionClassification: z.enum(["WEEKDAY", "WEEKEND"]),
    feeCoverage: z.enum(["ENDPOINT_REPORTED_BEST_CASE", "UNVERIFIED_WEEKEND"]),
    feeCoverageWarning: z.string().min(1).optional(),
    indicativeWarning: z.string().min(1),
  })
  .strict();

const zenProviderDetailsSchema = z
  .object({
    type: z.literal("ZEN_PLANS"),
    defaultPlan: z.literal("Free"),
    liveProRate: positiveDecimalStringSchema,
    sourceCurrencyPerTargetUnit: positiveDecimalStringSchema,
    endpointProTargetAmount: positiveMonetaryAmountSchema,
    targetAmountCalculation: z.literal("ENDPOINT_REPORTED"),
    feeDisclosure: z.literal("ZERO_ADDITIONAL_ZEN_FEE_PUBLIC_PAGE"),
    rateTimestampBasis: z.literal("RETRIEVAL_TIME_SOURCE_HAS_NO_TIMESTAMP"),
    pricingPolicyRetrievedAt: z.iso.date(),
    indicativeWarning: z.string().min(1),
  })
  .strict();

export const quoteRequestSchema = z
  .object({
    sourceCurrency: supportedCurrencyCodeSchema,
    targetCurrency: supportedCurrencyCodeSchema,
    providerId: providerIdentifierSchema,
    sourceAmount: positiveDecimalStringSchema,
    customerPlan: z.string().min(1).optional(),
    providerContexts: providerContextsSchema.optional(),
    requestedAt: z.iso.datetime(),
  })
  .refine((request) => request.sourceCurrency !== request.targetCurrency, {
    message: "Source and target currency must differ",
  });

export const availableQuoteSchema = z
  .object({
    kind: z.literal("quote"),
    provider: providerSchema,
    pair: currencyPairSchema,
    direction: z.literal("SELL_SOURCE_BUY_TARGET"),
    sourceAmount: positiveMonetaryAmountSchema,
    targetAmount: positiveMonetaryAmountSchema,
    effectiveRate: positiveDecimalStringSchema,
    rankingEffectiveRate: positiveDecimalStringSchema,
    rankingStatus: rankingStatusSchema,
    rankingExclusionReason: rankingExclusionReasonSchema.optional(),
    explicitFee: monetaryAmountSchema,
    totalCost: monetaryAmountSchema,
    rateTimestamp: z.iso.datetime(),
    retrievedAt: z.iso.datetime(),
    sourceType: quoteSourceTypeSchema,
    status: z.enum(["AVAILABLE", "STALE"]),
    freshness: freshnessSchema,
    reliability: reliabilitySchema,
    sourceId: z.string().min(1).optional(),
    sourceUrl: z.url().optional(),
    customerPlan: z.string().min(1).optional(),
    disclaimer: z.string().min(1).optional(),
    planQuotes: z.array(planQuoteSchema).min(1).optional(),
    providerDetails: z
      .discriminatedUnion("type", [revolutProviderDetailsSchema, zenProviderDetailsSchema])
      .optional(),
  })
  .superRefine((quote, context) => {
    if (
      quote.rankingStatus === "EXCLUDED_INCOMPLETE_FEES" &&
      quote.rankingExclusionReason === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Excluded quotes require a ranking exclusion reason",
        path: ["rankingExclusionReason"],
      });
    }
    if (quote.rankingStatus === "ELIGIBLE" && quote.rankingExclusionReason !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Eligible quotes cannot have a ranking exclusion reason",
        path: ["rankingExclusionReason"],
      });
    }
    if (quote.sourceAmount.currency !== quote.pair.sourceCurrency) {
      context.addIssue({
        code: "custom",
        message: "Source amount currency must match the quote pair",
        path: ["sourceAmount", "currency"],
      });
    }
    if (quote.targetAmount.currency !== quote.pair.targetCurrency) {
      context.addIssue({
        code: "custom",
        message: "Target amount currency must match the quote pair",
        path: ["targetAmount", "currency"],
      });
    }

    if (quote.planQuotes !== undefined) {
      const defaults = quote.planQuotes.filter((planQuote) => planQuote.isDefaultPlan);
      if (defaults.length !== 1) {
        context.addIssue({
          code: "custom",
          message: "Provider plan quotes require exactly one default plan",
          path: ["planQuotes"],
        });
      }
      for (const [index, planQuote] of quote.planQuotes.entries()) {
        if (planQuote.provider !== quote.provider.id) {
          context.addIssue({
            code: "custom",
            message: "Plan quote provider must match the top-level provider",
            path: ["planQuotes", index, "provider"],
          });
        }
        if (planQuote.rankingEligibility === "DEFAULT_PLAN_ELIGIBLE" && !planQuote.isDefaultPlan) {
          context.addIssue({
            code: "custom",
            message: "Only the default plan may participate in provider ranking",
            path: ["planQuotes", index, "rankingEligibility"],
          });
        }
        if (planQuote.isDefaultPlan && planQuote.quoteKind === "unavailable") {
          context.addIssue({
            code: "custom",
            message: "An available top-level quote requires an available default plan",
            path: ["planQuotes", index],
          });
        }
      }
    }

    const endpointTargetAmount =
      quote.providerDetails?.type === "REVOLUT_PERSONAL"
        ? quote.providerDetails.endpointRecipientAmount
        : quote.providerDetails?.type === "ZEN_PLANS"
          ? quote.providerDetails.endpointProTargetAmount
          : undefined;
    if (
      endpointTargetAmount !== undefined &&
      endpointTargetAmount.currency !== quote.pair.targetCurrency
    ) {
      context.addIssue({
        code: "custom",
        message: "Endpoint target currency must match the quote target currency",
        path: ["providerDetails", "endpointTargetAmount", "currency"],
      });
    }

    const revolutDetails =
      quote.providerDetails?.type === "REVOLUT_PERSONAL" ? quote.providerDetails : undefined;
    const totalSourceCost = revolutDetails?.totalSourceCost;
    if (totalSourceCost !== undefined) {
      const sourceCurrency = quote.sourceAmount.currency;
      for (const [path, currency] of [
        [["providerDetails", "fxFee", "currency"], revolutDetails?.fxFee.currency],
        [["providerDetails", "totalFee", "currency"], revolutDetails?.totalFee.currency],
        [["providerDetails", "feeCurrency"], revolutDetails?.feeCurrency],
        [["providerDetails", "totalSourceCost", "currency"], totalSourceCost.currency],
      ] as const) {
        if (currency !== sourceCurrency) {
          context.addIssue({
            code: "custom",
            message: "Provider cost currency must match the source currency",
            path: [...path],
          });
        }
      }
      if (
        !decimalPattern.test(totalSourceCost.amount) ||
        !decimal(totalSourceCost.amount).greaterThan(0)
      ) {
        context.addIssue({
          code: "custom",
          message: "Total source cost must be positive",
          path: ["providerDetails", "totalSourceCost", "amount"],
        });
      }
    }

    try {
      const expected = calculateRankingEffectiveRate({
        sourceAmount: quote.sourceAmount,
        targetAmount: quote.targetAmount,
        ...(totalSourceCost === undefined ? {} : { totalSourceCost }),
      });
      if (!decimal(quote.rankingEffectiveRate).equals(expected)) {
        context.addIssue({
          code: "custom",
          message: "Ranking effective rate is inconsistent with normalized quote costs",
          path: ["rankingEffectiveRate"],
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Ranking effective rate could not be calculated safely",
        path: ["rankingEffectiveRate"],
      });
    }
  });

export const unavailableQuoteSchema = z.object({
  kind: z.literal("unavailable"),
  provider: providerSchema,
  pair: currencyPairSchema,
  status: z.literal("UNAVAILABLE"),
  freshness: z.literal("UNKNOWN"),
  reliability: z.literal("NOT_APPLICABLE"),
  retrievedAt: z.iso.datetime(),
  reason: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  sourceUrl: z.url().optional(),
});

export const providerErrorResultSchema = z.object({
  kind: z.literal("error"),
  provider: providerSchema,
  pair: currencyPairSchema,
  status: z.literal("FAILED"),
  freshness: z.literal("UNKNOWN"),
  reliability: z.literal("NOT_APPLICABLE"),
  retrievedAt: z.iso.datetime(),
  errorCode: providerErrorCodeSchema,
  reason: z.string().min(1),
});

export const quoteResultSchema = z.discriminatedUnion("kind", [
  availableQuoteSchema,
  unavailableQuoteSchema,
  providerErrorResultSchema,
]);

export type ProviderIdentifier = z.infer<typeof providerIdentifierSchema>;
export type RevolutPersonalPlan = z.infer<typeof revolutPersonalPlanSchema>;
export type RevolutPersonalContext = z.infer<typeof revolutPersonalContextSchema>;
export type ProviderContexts = z.infer<typeof providerContextsSchema>;
export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
export type SupportedCurrencyCode = z.infer<typeof supportedCurrencyCodeSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type AvailableQuote = z.infer<typeof availableQuoteSchema>;
export type UnavailableQuote = z.infer<typeof unavailableQuoteSchema>;
export type ProviderErrorResult = z.infer<typeof providerErrorResultSchema>;
export type ProviderErrorCode = z.infer<typeof providerErrorCodeSchema>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;
