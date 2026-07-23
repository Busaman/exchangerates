import { z } from "zod";
import { decimalPattern } from "@/domain/decimal";

const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const decimalStringSchema = z.string().regex(decimalPattern);
const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => value !== "0" && !/^0\.0*$/.test(value),
);
const monetaryAmountSchema = z.object({
  currency: currencyCodeSchema,
  amount: decimalStringSchema,
});
const positiveMonetaryAmountSchema = z.object({
  currency: currencyCodeSchema,
  amount: positiveDecimalStringSchema,
});

const planQuoteSourceSchema = z
  .object({
    sourceType: z.enum(["LIVE_UNOFFICIAL", "OFFICIAL_POLICY"]),
    sourceId: z.string().min(1),
    sourceUrl: z.url(),
    policySourceUrl: z.url().optional(),
  })
  .strict();

const planQuoteCommonSchema = z.object({
  provider: z.string().min(1),
  plan: z.string().min(1),
  isDefaultPlan: z.boolean(),
  isPaidPlan: z.boolean(),
  monthlyFee: monetaryAmountSchema,
  monthlyAllowance: monetaryAmountSchema.optional(),
  assumedMonthlyUsage: monetaryAmountSchema.optional(),
  baseMarkup: decimalStringSchema,
  excessMarkup: decimalStringSchema,
  offMarketMarkup: decimalStringSchema,
  totalMarkup: decimalStringSchema,
  pricingWindow: z.enum(["WEEKDAY", "OFF_MARKET", "WEEKEND_UNVERIFIED", "NOT_APPLICABLE"]),
  calculationNote: z.string().min(1),
  source: planQuoteSourceSchema,
  fetchedAt: z.iso.datetime(),
  rankingEligibility: z.enum(["DEFAULT_PLAN_ELIGIBLE", "PLAN_DETAIL_ONLY", "EXCLUDED"]),
  rankingExclusionReason: z.string().min(1).optional(),
});

const numericPlanQuoteFields = {
  liveBaseRate: positiveDecimalStringSchema,
  effectiveRate: positiveDecimalStringSchema,
  inverseRate: positiveDecimalStringSchema,
  feeAmount: monetaryAmountSchema.optional(),
  feeCurrency: currencyCodeSchema.optional(),
  totalSourceCost: positiveMonetaryAmountSchema,
  recipientGets: positiveMonetaryAmountSchema,
} as const;

const livePlanQuoteSchema = planQuoteCommonSchema
  .extend({
    quoteKind: z.literal("live"),
    ...numericPlanQuoteFields,
  })
  .strict();

const derivedPlanQuoteSchema = planQuoteCommonSchema
  .extend({
    quoteKind: z.literal("derived"),
    calculationRate: positiveDecimalStringSchema,
    ...numericPlanQuoteFields,
  })
  .strict();

const unavailablePlanQuoteSchema = planQuoteCommonSchema
  .extend({
    quoteKind: z.literal("unavailable"),
    rankingEligibility: z.literal("EXCLUDED"),
    rankingExclusionReason: z.string().min(1),
  })
  .strict();

export const planQuoteSchema = z
  .discriminatedUnion("quoteKind", [
    livePlanQuoteSchema,
    derivedPlanQuoteSchema,
    unavailablePlanQuoteSchema,
  ])
  .superRefine((quote, context) => {
    if (quote.quoteKind === "unavailable") return;
    if ((quote.feeAmount === undefined) !== (quote.feeCurrency === undefined)) {
      context.addIssue({
        code: "custom",
        message: "Plan fee amount and currency must either both be present or both be absent",
        path: ["feeAmount"],
      });
    }
    if (quote.feeAmount !== undefined && quote.feeAmount.currency !== quote.feeCurrency) {
      context.addIssue({
        code: "custom",
        message: "Plan fee amount currency must match feeCurrency",
        path: ["feeCurrency"],
      });
    }
    if (quote.rankingEligibility === "EXCLUDED" && quote.rankingExclusionReason === undefined) {
      context.addIssue({
        code: "custom",
        message: "Excluded numeric plan quotes require a ranking exclusion reason",
        path: ["rankingExclusionReason"],
      });
    }
  });

export type PlanQuote = z.infer<typeof planQuoteSchema>;
export type NumericPlanQuote = Extract<PlanQuote, { quoteKind: "live" | "derived" }>;
