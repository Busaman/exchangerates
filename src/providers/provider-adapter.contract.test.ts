import { MockProviderAdapter } from "@/providers/mock-provider";
import { runProviderAdapterContract } from "@/providers/provider-adapter.contract";
import { UnavailableProviderAdapter } from "@/providers/unavailable-provider";
import { ZenProviderAdapter } from "@/providers/zen/zen-provider";
import type { ZenQuoteClient } from "@/providers/zen/zen-quote-client";

const requestedAt = "2026-01-01T12:00:00.000Z";

runProviderAdapterContract({
  adapter: new MockProviderAdapter(),
  request: {
    providerId: "MOCK_PROVIDER",
    sourceCurrency: "EUR",
    targetCurrency: "HUF",
    sourceAmount: "1000.005",
    requestedAt,
  },
  expectedKind: "quote",
});

runProviderAdapterContract({
  adapter: new UnavailableProviderAdapter(),
  request: {
    providerId: "UNAVAILABLE_PROVIDER",
    sourceCurrency: "EUR",
    targetCurrency: "HUF",
    sourceAmount: "1000.005",
    requestedAt,
  },
  expectedKind: "unavailable",
});

const zenQuoteClient: ZenQuoteClient = {
  getQuote: async () => ({
    sourceAmount: "1000",
    targetAmount: "2.74",
    exchangeRate: "0.002749",
    retrievedAt: requestedAt,
    sourceUrl: "https://www.zen.com/landing_currencies.php",
    freshness: "FRESH",
  }),
};

runProviderAdapterContract({
  adapter: new ZenProviderAdapter({ quoteClient: zenQuoteClient }),
  request: {
    providerId: "ZEN",
    sourceCurrency: "HUF",
    targetCurrency: "EUR",
    sourceAmount: "1000",
    requestedAt,
  },
  expectedKind: "quote",
});
