import { MockProviderAdapter } from "@/providers/mock-provider";
import { runProviderAdapterContract } from "@/providers/provider-adapter.contract";
import { UnavailableProviderAdapter } from "@/providers/unavailable-provider";

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
