import { z } from "zod";
import type Decimal from "decimal.js";
import { decimal as createDecimal } from "@/domain/decimal";

const currencySchema = z.enum(["EUR", "HUF"]);
const countrySchema = z.string().min(2).max(2).nullable();
const finiteNumberSchema = z.number().finite();

const wiseQuoteSchema = z
  .object({
    dateCollected: z.iso.datetime(),
    fee: finiteNumberSchema,
    isConsideredMidMarketRate: z.boolean(),
    markup: finiteNumberSchema,
    rate: finiteNumberSchema,
    receivedAmount: finiteNumberSchema,
    sendAmount: finiteNumberSchema.nullable().optional(),
    sourceCountry: countrySchema,
    targetCountry: countrySchema,
  })
  .passthrough();

const comparisonProviderSchema = z
  .object({
    alias: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    quotes: z.array(z.unknown()),
  })
  .passthrough();

const comparisonResponseSchema = z
  .object({
    amount: finiteNumberSchema,
    amountType: z.string().min(1),
    providers: z.array(comparisonProviderSchema),
    sourceCountry: countrySchema,
    sourceCurrency: currencySchema,
    targetCountry: countrySchema.optional(),
    targetCurrency: currencySchema,
  })
  .passthrough();

export const wiseComparisonInvestigationPolicy = {
  futureToleranceMs: 2 * 60_000,
  maximumQuoteAgeMs: 15 * 60_000,
  recipientTolerance: {
    EUR: "0.01",
    HUF: "1",
  },
} as const;

export type WiseComparisonRequestEvidence = Readonly<{
  sendAmount: string;
  sourceCountry?: string;
  sourceCurrency: z.infer<typeof currencySchema>;
  targetCurrency: z.infer<typeof currencySchema>;
}>;

export type WiseComparisonEvidence = Readonly<{
  amount: string;
  amountType: "SEND";
  convertedSourceAmount: string;
  dateCollected: string;
  effectiveRate: string;
  expectedReceivedAmount: string;
  fee: string;
  isConsideredMidMarketRate: boolean;
  markup: string;
  mathematicalDifference: string;
  providerAlias: "wise";
  providerName: string;
  providerType: string;
  quoteSendAmount: string | null;
  quoteSourceCountry: string | null;
  quoteTargetCountry: string | null;
  rate: string;
  receivedAmount: string;
  responseSourceCountry: string | null;
  responseTargetCountry: string | null;
  sourceCurrency: z.infer<typeof currencySchema>;
  targetCurrency: z.infer<typeof currencySchema>;
  validationResult: "PASS";
  wiseQuoteCount: 1;
}>;

export class WiseComparisonParseError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WiseComparisonParseError";
  }
}

function fail(code: string): never {
  throw new WiseComparisonParseError(code);
}

function parseDecimal(value: number | string): Decimal {
  try {
    return createDecimal(String(value));
  } catch {
    return fail("INVALID_DECIMAL_VALUE");
  }
}

export function parseWiseComparisonResponse({
  observedAt = new Date(),
  payload,
  request,
}: {
  observedAt?: Date;
  payload: unknown;
  request: WiseComparisonRequestEvidence;
}): WiseComparisonEvidence {
  const responseResult = comparisonResponseSchema.safeParse(payload);
  if (!responseResult.success) fail("MALFORMED_RESPONSE");
  const response = responseResult.data;

  if (request.sourceCurrency === request.targetCurrency) fail("IDENTICAL_CURRENCIES");
  if (
    response.sourceCurrency !== request.sourceCurrency ||
    response.targetCurrency !== request.targetCurrency
  ) {
    fail("CURRENCY_MISMATCH");
  }
  if (response.amountType !== "SEND") fail("UNSUPPORTED_AMOUNT_TYPE");
  if (request.sourceCountry !== undefined && response.sourceCountry !== request.sourceCountry) {
    fail("SOURCE_COUNTRY_MISMATCH");
  }

  const requestAmount = parseDecimal(request.sendAmount);
  const responseAmount = parseDecimal(response.amount);
  if (!requestAmount.isPositive() || !responseAmount.equals(requestAmount)) {
    fail("AMOUNT_MISMATCH");
  }

  const wiseProviders = response.providers.filter((provider) => provider.alias === "wise");
  if (wiseProviders.length !== 1) fail("WISE_PROVIDER_NOT_UNIQUE");
  const provider = wiseProviders[0];
  if (provider === undefined) fail("WISE_PROVIDER_MISSING");
  if (provider.quotes.length !== 1) fail("WISE_QUOTE_COUNT_UNSUPPORTED");

  const quoteResult = wiseQuoteSchema.safeParse(provider.quotes[0]);
  if (!quoteResult.success) fail("MALFORMED_WISE_QUOTE");
  const quote = quoteResult.data;
  if (request.sourceCountry !== undefined && quote.sourceCountry !== request.sourceCountry) {
    fail("QUOTE_SOURCE_COUNTRY_MISMATCH");
  }
  const fee = parseDecimal(quote.fee);
  const rate = parseDecimal(quote.rate);
  const receivedAmount = parseDecimal(quote.receivedAmount);
  const markup = parseDecimal(quote.markup);
  if (fee.isNegative()) fail("NEGATIVE_FEE");
  if (!rate.isPositive()) fail("NON_POSITIVE_RATE");
  if (!receivedAmount.isPositive()) fail("NON_POSITIVE_RECEIVED_AMOUNT");
  if (markup.isNegative()) fail("NEGATIVE_MARKUP");

  const convertedSourceAmount = responseAmount.minus(fee);
  if (!convertedSourceAmount.isPositive()) fail("NON_POSITIVE_CONVERTED_AMOUNT");
  const expectedReceivedAmount = convertedSourceAmount.times(rate);
  const mathematicalDifference = expectedReceivedAmount.minus(receivedAmount).abs();
  const tolerance = parseDecimal(
    wiseComparisonInvestigationPolicy.recipientTolerance[request.targetCurrency],
  );
  if (mathematicalDifference.greaterThan(tolerance)) fail("MATHEMATICAL_MISMATCH");

  const collectedAtMs = Date.parse(quote.dateCollected);
  if (!Number.isFinite(collectedAtMs)) fail("INVALID_QUOTE_TIMESTAMP");
  const ageMs = observedAt.getTime() - collectedAtMs;
  if (ageMs < -wiseComparisonInvestigationPolicy.futureToleranceMs) {
    fail("FUTURE_QUOTE_TIMESTAMP");
  }
  if (ageMs > wiseComparisonInvestigationPolicy.maximumQuoteAgeMs) {
    fail("STALE_QUOTE_TIMESTAMP");
  }

  return {
    amount: responseAmount.toString(),
    amountType: "SEND",
    convertedSourceAmount: convertedSourceAmount.toString(),
    dateCollected: quote.dateCollected,
    effectiveRate: receivedAmount.dividedBy(responseAmount).toString(),
    expectedReceivedAmount: expectedReceivedAmount.toString(),
    fee: fee.toString(),
    isConsideredMidMarketRate: quote.isConsideredMidMarketRate,
    markup: markup.toString(),
    mathematicalDifference: mathematicalDifference.toString(),
    providerAlias: "wise",
    providerName: provider.name,
    providerType: provider.type,
    quoteSendAmount:
      quote.sendAmount === undefined || quote.sendAmount === null
        ? null
        : parseDecimal(quote.sendAmount).toString(),
    quoteSourceCountry: quote.sourceCountry,
    quoteTargetCountry: quote.targetCountry,
    rate: rate.toString(),
    receivedAmount: receivedAmount.toString(),
    responseSourceCountry: response.sourceCountry,
    responseTargetCountry: response.targetCountry ?? null,
    sourceCurrency: response.sourceCurrency,
    targetCurrency: response.targetCurrency,
    validationResult: "PASS",
    wiseQuoteCount: 1,
  };
}
