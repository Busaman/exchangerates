import { z } from "zod";

const decimalStringSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d+)?$/, "Expected a non-negative decimal string");

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
export const supportedCurrencyCodeSchema = z.enum(["EUR", "HUF"]);
export const quoteSourceTypeSchema = z.enum([
  "LIVE_OFFICIAL",
  "LIVE_UNOFFICIAL",
  "ESTIMATED",
  "MOCK",
]);
export const quoteDataStatusSchema = z.enum(["AVAILABLE", "UNAVAILABLE", "STALE"]);
export const freshnessSchema = z.enum(["FRESH", "AGING", "STALE", "UNKNOWN"]);
export const reliabilitySchema = z.enum(["VERIFIED", "HIGH", "MEDIUM", "LOW", "NOT_APPLICABLE"]);

export const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
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

export const quoteRequestSchema = currencyPairSchema.extend({
  providerId: providerSchema.shape.id,
  sourceAmount: decimalStringSchema.refine((value) => Number(value) > 0, {
    message: "Source amount must be greater than zero",
  }),
  customerPlan: z.string().min(1).optional(),
  requestedAt: z.iso.datetime(),
});

export const availableQuoteSchema = z.object({
  kind: z.literal("quote"),
  provider: providerSchema,
  pair: currencyPairSchema,
  direction: z.literal("SELL_SOURCE_BUY_TARGET"),
  sourceAmount: monetaryAmountSchema,
  targetAmount: monetaryAmountSchema,
  effectiveRate: decimalStringSchema,
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
});

export const quoteResultSchema = z.discriminatedUnion("kind", [
  availableQuoteSchema,
  unavailableQuoteSchema,
]);

export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
export type SupportedCurrencyCode = z.infer<typeof supportedCurrencyCodeSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type AvailableQuote = z.infer<typeof availableQuoteSchema>;
export type UnavailableQuote = z.infer<typeof unavailableQuoteSchema>;
export type QuoteResult = z.infer<typeof quoteResultSchema>;
