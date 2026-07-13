import { z } from "zod";
import { decimal, decimalToPlainString } from "@/domain/decimal";
import { supportedCurrencyCodeSchema } from "@/domain/quote";
import {
  currenciesForRevolutPair,
  revolutRateSourceConfig,
  type RevolutPairKey,
} from "@/providers/revolut/revolut-config";

const rateValueSchema = z
  .union([z.number().finite().positive(), z.string()])
  .transform((value) => String(value));

const rateSchema = z.object({
  from: supportedCurrencyCodeSchema,
  to: supportedCurrencyCodeSchema,
  rate: rateValueSchema,
  timestamp: z.number().int().positive(),
});

const exchangeWidgetSchema = z.object({
  senderCurrency: supportedCurrencyCodeSchema,
  recipientCurrency: supportedCurrencyCodeSchema,
  senderAmount: z.number().int().positive(),
  recipientAmount: z.number().int().positive(),
  rate: rateSchema,
});

const pageConfigSchema = z.object({
  senderCurrency: supportedCurrencyCodeSchema,
  recipientCurrency: supportedCurrencyCodeSchema,
});

const nextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      page: z.object({ blocks: z.array(z.unknown()) }),
      widgetData: z.record(z.string(), z.unknown()),
    }),
  }),
});

const blockedPagePattern =
  /<title[^>]*>[^<]*(?:security check|access restricted|access denied|forbidden|captcha|challenge|consent required|error|temporarily unavailable)[^<]*<\/title>|cf-chl-|captcha|bot[- ]?blocking/iu;

export class RevolutPageParseError extends Error {
  constructor(readonly code: string) {
    super(`Revolut page validation failed: ${code}`);
    this.name = "RevolutPageParseError";
  }
}

export type ParsedRevolutRate = Readonly<{
  pair: RevolutPairKey;
  rate: string;
  rateTimestamp: string;
  sourceSenderAmount: string;
  sourceRecipientAmount: string;
}>;

function findPageConfig(blocks: readonly unknown[]) {
  for (const block of blocks) {
    const parsed = z
      .object({
        content: z.object({
          components: z.object({ exchangeRatesWidget: pageConfigSchema }),
        }),
      })
      .safeParse(block);
    if (parsed.success) return parsed.data.content.components.exchangeRatesWidget;
  }
  throw new RevolutPageParseError("MISSING_PAIR_CONFIGURATION");
}

function extractNextData(html: string): unknown {
  if (blockedPagePattern.test(html)) throw new RevolutPageParseError("BLOCKED_PAGE");
  const script = html.match(
    /<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/iu,
  )?.[1];
  if (script === undefined) throw new RevolutPageParseError("MISSING_STRUCTURED_DATA");

  try {
    return JSON.parse(script) as unknown;
  } catch {
    throw new RevolutPageParseError("MALFORMED_STRUCTURED_DATA");
  }
}

export function parseRevolutPublicPage({
  html,
  expectedPair,
  now,
}: {
  html: string;
  expectedPair: RevolutPairKey;
  now: Date;
}): ParsedRevolutRate {
  const data = nextDataSchema.safeParse(extractNextData(html));
  if (!data.success) throw new RevolutPageParseError("INVALID_STRUCTURED_DATA");

  const pageProps = data.data.props.pageProps;
  const widget = exchangeWidgetSchema.safeParse(pageProps.widgetData["exchange-rates-widget"]);
  if (!widget.success) throw new RevolutPageParseError("MISSING_RATE");

  const pageConfig = findPageConfig(pageProps.page.blocks);
  const expected = currenciesForRevolutPair(expectedPair);
  const expectedCurrencies = [expected.sourceCurrency, expected.targetCurrency] as const;
  const observedCurrencies = [widget.data.senderCurrency, widget.data.recipientCurrency] as const;
  const rateCurrencies = [widget.data.rate.from, widget.data.rate.to] as const;
  const configuredCurrencies = [pageConfig.senderCurrency, pageConfig.recipientCurrency] as const;

  if (
    observedCurrencies[0] !== expectedCurrencies[0] ||
    observedCurrencies[1] !== expectedCurrencies[1] ||
    rateCurrencies[0] !== expectedCurrencies[0] ||
    rateCurrencies[1] !== expectedCurrencies[1] ||
    configuredCurrencies[0] !== expectedCurrencies[0] ||
    configuredCurrencies[1] !== expectedCurrencies[1]
  ) {
    throw new RevolutPageParseError("WRONG_CURRENCY_PAIR");
  }

  let rate;
  try {
    rate = decimal(widget.data.rate.rate);
  } catch {
    throw new RevolutPageParseError("MALFORMED_RATE");
  }
  const bounds = revolutRateSourceConfig.plausibleRates[expectedPair];
  if (!rate.isPositive() || rate.lessThan(bounds.minimum) || rate.greaterThan(bounds.maximum)) {
    throw new RevolutPageParseError("IMPLAUSIBLE_RATE");
  }

  const calculatedRate = decimal(widget.data.recipientAmount).dividedBy(widget.data.senderAmount);
  const relativeDifference = calculatedRate.minus(rate).abs().dividedBy(rate);
  if (relativeDifference.greaterThan(revolutRateSourceConfig.consistencyTolerance)) {
    throw new RevolutPageParseError("INCONSISTENT_AMOUNTS");
  }

  const rateDate = new Date(widget.data.rate.timestamp);
  if (Number.isNaN(rateDate.getTime())) throw new RevolutPageParseError("INVALID_TIMESTAMP");
  const ageMs = now.getTime() - rateDate.getTime();
  if (ageMs > revolutRateSourceConfig.maximumSourceObservationAgeMs) {
    throw new RevolutPageParseError("STALE_SOURCE_RATE");
  }
  if (ageMs < -revolutRateSourceConfig.maximumFutureClockSkewMs) {
    throw new RevolutPageParseError("FUTURE_SOURCE_RATE");
  }

  return {
    pair: expectedPair,
    rate: decimalToPlainString(rate),
    rateTimestamp: rateDate.toISOString(),
    sourceSenderAmount: decimalToPlainString(widget.data.senderAmount),
    sourceRecipientAmount: decimalToPlainString(widget.data.recipientAmount),
  };
}
