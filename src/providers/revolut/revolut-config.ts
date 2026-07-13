import type { SupportedCurrencyCode } from "@/domain/quote";

export type RevolutPairKey = "EUR-HUF" | "HUF-EUR";

export const revolutSourceUrls: Readonly<Record<RevolutPairKey, string>> = {
  "EUR-HUF": "https://www.revolut.com/hu-HU/currency-converter/convert-eur-to-huf-exchange-rate/",
  "HUF-EUR": "https://www.revolut.com/hu-HU/currency-converter/convert-huf-to-eur-exchange-rate/",
};

export const revolutFeePolicySourceUrl =
  "https://help.revolut.com/hu-HU/help/wealth/exchanging-money/how-much-does-it-cost-to-make-an-exchange/will-i-be-charged-for-exchanging-foreign-currencies/";
export const revolutPersonalFeesSourceUrl = "https://www.revolut.com/hu-HU/legal/standard-fees/";

export const revolutRateSourceConfig = {
  userAgent: "NeoRate/0.1 (+https://github.com/Busaman/exchangerates; public-rate-monitor)",
  timeoutMs: 2_500,
  retryBackoffMs: [150, 400] as const,
  freshCacheMs: 60_000,
  staleCacheMs: 15 * 60_000,
  maximumSourceObservationAgeMs: 15 * 60_000,
  maximumFutureClockSkewMs: 2 * 60_000,
  maximumHtmlBytes: 2_000_000,
  consistencyTolerance: "0.005",
  plausibleRates: {
    "EUR-HUF": { minimum: "100", maximum: "1000" },
    "HUF-EUR": { minimum: "0.0005", maximum: "0.01" },
  },
} as const;

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
