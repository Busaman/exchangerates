import { z } from "zod";
import {
  decimal,
  decimalPattern,
  maximumSourceAmount,
  maximumSourceAmountLength,
} from "@/domain/decimal";

export const providerIdentifierSchema = z.enum([
  "MOCK_PROVIDER",
  "UNAVAILABLE_PROVIDER",
  "REVOLUT",
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

export const revolutPersonalContextSchema = z
  .object({
    plan: revolutPersonalPlanSchema,
    rollingThirtyDayExchangeUsedHuf: z
      .string()
      .max(maximumSourceAmountLength)
      .pipe(decimalStringSchema)
      .refine(
        (value) => decimal(value).lessThanOrEqualTo(maximumSourceAmount),
        `Rolling 30-day exchange usage must not exceed ${maximumSourceAmount} HUF`,
      ),
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

export const availableQuoteSchema = z.object({
  kind: z.literal("quote"),
  provider: providerSchema,
  pair: currencyPairSchema,
  direction: z.literal("SELL_SOURCE_BUY_TARGET"),
  sourceAmount: positiveMonetaryAmountSchema,
  targetAmount: positiveMonetaryAmountSchema,
  effectiveRate: positiveDecimalStringSchema,
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
  providerDetails: z
    .object({
      type: z.literal("REVOLUT_PERSONAL"),
      plan: revolutPersonalPlanSchema,
      displayedBaseRate: positiveDecimalStringSchema,
      fairUsageFee: monetaryAmountSchema,
      weekendFee: monetaryAmountSchema,
      totalFee: monetaryAmountSchema,
      feeCurrency: currencyCodeSchema,
      fairUsageAllowanceHuf: decimalStringSchema.nullable(),
      rollingThirtyDayExchangeUsedBeforeQuoteHuf: decimalStringSchema,
      allowanceConsumedByQuoteHuf: decimalStringSchema,
      remainingAllowanceAfterQuoteHuf: decimalStringSchema.nullable(),
      marketSession: z.enum(["WEEKDAY", "WEEKEND"]),
      indicativeWarning: z.string().min(1),
    })
    .strict()
    .optional(),
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
