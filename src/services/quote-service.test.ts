import { describe, expect, it, vi } from "vitest";
import {
  availableQuoteSchema,
  quoteResultSchema,
  type Provider,
  type QuoteResult,
} from "@/domain/quote";
import { MockProviderAdapter, createMockQuote } from "@/providers/mock-provider";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { ProviderAdapterRegistry, providerRegistry } from "@/providers/provider-registry";
import { getQuotes } from "@/services/quote-service";

const generatedAt = "2026-01-01T12:00:00.000Z";
const requestId = "00000000-0000-4000-8000-000000000000";
const deterministicDependencies = {
  now: () => new Date(generatedAt),
  createRequestId: () => requestId,
};

function customAdapter(provider: Provider, getQuote: ProviderAdapter["getQuote"]): ProviderAdapter {
  return { provider, getQuote };
}

describe("provider registry", () => {
  it("exposes supported and unavailable registrations with lookup", () => {
    expect(providerRegistry.list()).toEqual([
      { id: "MOCK_PROVIDER", name: "Demo Fintech", status: "SUPPORTED" },
      { id: "UNAVAILABLE_PROVIDER", name: "Unavailable example", status: "UNAVAILABLE" },
    ]);
    expect(providerRegistry.get("MOCK_PROVIDER").adapter).toBeInstanceOf(MockProviderAdapter);
  });
});

describe("getQuotes", () => {
  it("returns deterministic EUR/HUF results and selects the best provider", async () => {
    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER", "UNAVAILABLE_PROVIDER"],
        customerPlan: null,
      },
      deterministicDependencies,
    );

    expect(response.request.id).toBe(requestId);
    expect(response.quotes[0]?.targetAmount.amount).toBe("391323");
    expect(response.bestProviderId).toBe("MOCK_PROVIDER");
    expect(response.sourceStatus).toBe("PARTIAL_SUCCESS");
    expect(response.warnings).toEqual(["MOCK_DATA"]);
    expect(response.issues[0]?.kind).toBe("unavailable");
  });

  it("returns a deterministic HUF/EUR quote", async () => {
    const response = await getQuotes(
      {
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "400000",
        providers: ["MOCK_PROVIDER"],
      },
      deterministicDependencies,
    );

    expect(response.quotes[0]?.targetAmount.amount).toBe("993.01");
    expect(response.quotes[0]?.effectiveRate).toBe("0.00248253");
    expect(response.sourceStatus).toBe("SUCCESS");
  });

  it("preserves an optional customer plan in request metadata and provider output", async () => {
    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER"],
        customerPlan: "PREMIUM",
      },
      deterministicDependencies,
    );

    expect(response.request.customerPlan).toBe("PREMIUM");
    expect(response.quotes[0]?.customerPlan).toBe("PREMIUM");
  });

  it("preserves decimal precision and applies ROUND_HALF_UP at currency boundaries", async () => {
    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000.005",
        providers: ["MOCK_PROVIDER"],
      },
      deterministicDependencies,
    );
    const quote = response.quotes[0];

    expect(quote?.sourceAmount.amount).toBe("1000.005");
    expect(quote?.explicitFee.amount).toBe("3.00");
    expect(quote?.targetAmount.amount).toBe("391324");
  });

  it("returns no best provider when every selected provider is unavailable", async () => {
    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["UNAVAILABLE_PROVIDER"],
      },
      deterministicDependencies,
    );

    expect(response.quotes).toEqual([]);
    expect(response.bestProviderId).toBeNull();
    expect(response.sourceStatus).toBe("NO_AVAILABLE_QUOTES");
  });

  it("isolates a provider exception as a failed result", async () => {
    const provider: Provider = { id: "MOCK_PROVIDER", name: "Throwing provider" };
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(provider, async () => Promise.reject(new Error("private failure"))),
      },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER"],
      },
      { ...deterministicDependencies, registry },
    );

    expect(response.issues[0]).toMatchObject({
      kind: "error",
      status: "FAILED",
      errorCode: "PROVIDER_EXCEPTION",
    });
    expect(JSON.stringify(response)).not.toContain("private failure");
    consoleError.mockRestore();
  });

  it("preserves a valid quote when another provider throws", async () => {
    const throwingProvider: Provider = {
      id: "UNAVAILABLE_PROVIDER",
      name: "Throwing provider",
    };
    const registry = new ProviderAdapterRegistry([
      { status: "SUPPORTED", adapter: new MockProviderAdapter() },
      {
        status: "SUPPORTED",
        adapter: customAdapter(throwingProvider, async () =>
          Promise.reject(new Error("private failure")),
        ),
      },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER", "UNAVAILABLE_PROVIDER"],
      },
      { ...deterministicDependencies, registry },
    );

    expect(response.quotes).toHaveLength(1);
    expect(response.issues[0]).toMatchObject({
      kind: "error",
      errorCode: "PROVIDER_EXCEPTION",
    });
    expect(response.bestProviderId).toBe("MOCK_PROVIDER");
    expect(response.sourceStatus).toBe("PARTIAL_SUCCESS");
    consoleError.mockRestore();
  });

  it("classifies a schema-invalid adapter response without exposing it", async () => {
    const provider: Provider = { id: "MOCK_PROVIDER", name: "Invalid provider" };
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(provider, async () =>
          Promise.resolve(quoteResultSchema.parse({ kind: "quote" })),
        ),
      },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER"],
      },
      { ...deterministicDependencies, registry },
    );

    expect(response.issues[0]).toMatchObject({
      kind: "error",
      errorCode: "PROVIDER_INVALID_RESPONSE",
    });
    consoleError.mockRestore();
  });

  it("times out a slow provider without exposing numeric placeholders", async () => {
    const provider: Provider = { id: "MOCK_PROVIDER", name: "Slow provider" };
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(provider, async () => new Promise<QuoteResult>(() => undefined)),
      },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER"],
      },
      { ...deterministicDependencies, registry, providerTimeoutMs: 5 },
    );

    expect(response.issues[0]).toMatchObject({
      kind: "error",
      errorCode: "PROVIDER_TIMEOUT",
    });
    expect(response.issues[0]).not.toHaveProperty("targetAmount");
    consoleError.mockRestore();
  });

  it("never ranks a stale quote as best", async () => {
    const staleProvider: Provider = { id: "MOCK_PROVIDER", name: "Stale provider" };
    const staleQuote = availableQuoteSchema.parse({
      ...createMockQuote({
        providerId: "MOCK_PROVIDER",
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        requestedAt: generatedAt,
      }),
      provider: staleProvider,
      status: "STALE",
      freshness: "STALE",
    });
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(staleProvider, async () => Promise.resolve(staleQuote)),
      },
    ]);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER"],
      },
      { ...deterministicDependencies, registry },
    );

    expect(response.bestProviderId).toBeNull();
    expect(response.sourceStatus).toBe("NO_AVAILABLE_QUOTES");
  });
});
