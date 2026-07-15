import type { SupportedCurrencyCode } from "@/domain/quote";

export type RevolutPairKey = "EUR-HUF" | "HUF-EUR";

export const revolutQuoteEndpoint = "https://www.revolut.com/api/exchange/quote";

export const revolutFeePolicySourceUrl =
  "https://help.revolut.com/hu-HU/help/wealth/exchanging-money/how-much-does-it-cost-to-make-an-exchange/will-i-be-charged-for-exchanging-foreign-currencies/";
export const revolutPersonalFeesSourceUrl = "https://www.revolut.com/hu-HU/legal/standard-fees/";

export const revolutQuoteClientConfig = {
  country: "HU",
  userAgent: "NeoRate/0.1 (+https://github.com/Busaman/exchangerates; public-quote-client)",
  timeoutMs: 2_500,
  retryBackoffMs: [150, 400] as const,
  freshCacheMs: 60_000,
  negativeCacheMs: 30_000,
  staleCacheMs: 15 * 60_000,
  maximumSourceObservationAgeMs: 15 * 60_000,
  maximumFutureClockSkewMs: 2 * 60_000,
  maximumJsonBytes: 250_000,
  consistencyTolerance: "0.005",
  plausibleRates: {
    "EUR-HUF": { minimum: "100", maximum: "1000" },
    "HUF-EUR": { minimum: "0.0005", maximum: "0.01" },
  },
} as const;

export function buildRevolutQuoteUrl(pair: RevolutPairKey, amount: string): string {
  const { sourceCurrency, targetCurrency } = currenciesForRevolutPair(pair);
  const url = new URL(revolutQuoteEndpoint);
  url.searchParams.set("amount", amount);
  url.searchParams.set("country", revolutQuoteClientConfig.country);
  url.searchParams.set("fromCurrency", sourceCurrency);
  url.searchParams.set("isRecipientAmount", "false");
  url.searchParams.set("toCurrency", targetCurrency);
  return url.toString();
}

export function revolutPairKey(
  sourceCurrency: SupportedCurrencyCode,
  targetCurrency: SupportedCurrencyCode,
): RevolutPairKey | undefined {
  const key = `${sourceCurrency}-${targetCurrency}`;
  return key === "EUR-HUF" || key === "HUF-EUR" ? key : undefined;
}

export function currenciesForRevolutPair(pair: RevolutPairKey): Readonly<{
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
}> {
  return pair === "EUR-HUF"
    ? { sourceCurrency: "EUR", targetCurrency: "HUF" }
    : { sourceCurrency: "HUF", targetCurrency: "EUR" };
}
