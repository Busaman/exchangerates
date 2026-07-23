import type { SupportedCurrencyCode } from "@/domain/quote";

export const wiseComparisonEndpoint = "https://wise.com/gateway/v4/comparisons";
export const wiseComparisonSourceId = "wise-public-comparison";

export const wiseQuoteClientConfig = {
  sourceCountry: "HU",
  filter: "POPULAR",
  includeWise: "true",
  numberOfProviders: "3",
  userAgent: "NeoRate/0.1 (+https://github.com/Busaman/exchangerates; public-comparison-client)",
  timeoutMs: 5_000,
  maximumJsonBytes: 256 * 1024,
  freshCacheMs: 60_000,
  negativeCacheMs: 30_000,
  staleCacheMs: 15 * 60_000,
} as const;

export type WisePair = Readonly<{
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
}>;

export function isWisePair(
  sourceCurrency: SupportedCurrencyCode,
  targetCurrency: SupportedCurrencyCode,
): boolean {
  return (
    (sourceCurrency === "HUF" && targetCurrency === "EUR") ||
    (sourceCurrency === "EUR" && targetCurrency === "HUF")
  );
}

export function buildWiseComparisonUrl({
  sourceCurrency,
  targetCurrency,
  sourceAmount,
}: WisePair & { sourceAmount: string }): string {
  const url = new URL(wiseComparisonEndpoint);
  url.searchParams.set("sourceCurrency", sourceCurrency);
  url.searchParams.set("targetCurrency", targetCurrency);
  url.searchParams.set("sendAmount", sourceAmount);
  url.searchParams.set("sourceCountry", wiseQuoteClientConfig.sourceCountry);
  url.searchParams.set("filter", wiseQuoteClientConfig.filter);
  url.searchParams.set("includeWise", wiseQuoteClientConfig.includeWise);
  url.searchParams.set("numberOfProviders", wiseQuoteClientConfig.numberOfProviders);
  return url.toString();
}
