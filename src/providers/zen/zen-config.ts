import type { SupportedCurrencyCode } from "@/domain/quote";

export const zenQuoteEndpoint = "https://www.zen.com/landing_currencies.php";
export const zenQuoteSourceId = "zen-public-landing-currency-converter";
export const zenQuoteTimeoutMs = 2_500;
export const zenQuoteMaximumResponseBytes = 64 * 1024;
export const zenFreshCacheMs = 60_000;
export const zenNegativeCacheMs = 30_000;
export const zenStaleCacheMs = 15 * 60_000;

export type ZenPair = Readonly<{
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
}>;

export function isZenPair(
  sourceCurrency: SupportedCurrencyCode,
  targetCurrency: SupportedCurrencyCode,
): boolean {
  return (
    (sourceCurrency === "HUF" && targetCurrency === "EUR") ||
    (sourceCurrency === "EUR" && targetCurrency === "HUF")
  );
}
