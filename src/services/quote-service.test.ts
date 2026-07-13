import { describe, expect, it, vi } from "vitest";
import { availableQuoteSchema, type Provider, type QuoteResult } from "@/domain/quote";
import { MockProviderAdapter, createMockQuote } from "@/providers/mock-provider";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import {
  createProviderRegistry,
  ProviderAdapterRegistry,
  providerRegistry,
} from "@/providers/provider-registry";
import { RevolutProviderAdapter } from "@/providers/revolut/revolut-provider";
import type { RevolutRateSource } from "@/providers/revolut/revolut-rate-source";
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
      { id: "REVOLUT", name: "Revolut Personal (HU)", status: "UNAVAILABLE" },
    ]);
    expect(providerRegistry.get("MOCK_PROVIDER").adapter).toBeInstanceOf(MockProviderAdapter);
  });

  it("rejects duplicate provider registrations", () => {
    const adapter = new MockProviderAdapter();

    expect(
      () =>
        new ProviderAdapterRegistry([
          { status: "SUPPORTED", adapter },
          {
            status: "UNAVAILABLE",
            adapter,
            reason: "Duplicate test registration",
            sourceId: "duplicate-test",
          },
        ]),
    ).toThrow("Provider registry contains duplicate provider identifiers");
  });

  it("enables Revolut only through the explicit experimental gate", () => {
    const disabled = createProviderRegistry({ revolutEnabled: false }).get("REVOLUT");
    const enabled = createProviderRegistry({ revolutEnabled: true }).get("REVOLUT");

    expect(disabled).toMatchObject({ status: "UNAVAILABLE" });
    expect(enabled).toMatchObject({ status: "SUPPORTED", timeoutMs: 10_000 });
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

  it("uses every registered provider when provider selection is omitted", async () => {
    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        customerPlan: null,
      },
      deterministicDependencies,
    );

    expect(response.request.providers).toEqual([
      "MOCK_PROVIDER",
      "UNAVAILABLE_PROVIDER",
      "REVOLUT",
    ]);
    expect(response.quotes).toHaveLength(1);
    expect(response.issues).toHaveLength(2);
    expect(response.sourceStatus).toBe("PARTIAL_SUCCESS");
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

  it("does not call an adapter registered as unavailable", async () => {
    const getQuote = vi.fn<ProviderAdapter["getQuote"]>();
    const provider: Provider = { id: "REVOLUT", name: "Disabled Revolut" };
    const registry = new ProviderAdapterRegistry([
      {
        status: "UNAVAILABLE",
        adapter: customAdapter(provider, getQuote),
        reason: "Awaiting staging verification.",
        sourceId: "disabled-revolut-test",
      },
    ]);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["REVOLUT"],
      },
      { ...deterministicDependencies, registry },
    );

    expect(getQuote).not.toHaveBeenCalled();
    expect(response.issues[0]).toMatchObject({
      kind: "unavailable",
      reason: "Awaiting staging verification.",
    });
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

  it("does not emit a Revolut warning for another LIVE_UNOFFICIAL provider", async () => {
    const provider: Provider = { id: "MOCK_PROVIDER", name: "Unofficial example" };
    const quote = availableQuoteSchema.parse({
      ...createMockQuote({
        providerId: "MOCK_PROVIDER",
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        requestedAt: generatedAt,
      }),
      provider,
      sourceType: "LIVE_UNOFFICIAL",
      disclaimer: "Indicative non-Revolut test quote.",
    });
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(provider, async () => quote),
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

    expect(response.warnings).not.toContain("REVOLUT_INDICATIVE");
  });

  it("classifies a schema-invalid adapter response without exposing it", async () => {
    const provider: Provider = { id: "MOCK_PROVIDER", name: "Invalid provider" };
    const malformedResult = {
      kind: "quote",
      privatePayload: "must not leak",
    } as unknown as QuoteResult;
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(provider, async () => Promise.resolve(malformedResult)),
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
    expect(JSON.stringify(response)).not.toContain("must not leak");
    consoleError.mockRestore();
  });

  it("rejects a zero-payout adapter response instead of ranking it", async () => {
    const provider: Provider = { id: "MOCK_PROVIDER", name: "Zero payout provider" };
    const zeroPayoutResult = {
      ...createMockQuote({
        providerId: "MOCK_PROVIDER",
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        requestedAt: generatedAt,
      }),
      provider,
      targetAmount: { currency: "HUF", amount: "0" },
      effectiveRate: "0.00000000",
    } as unknown as QuoteResult;
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: customAdapter(provider, async () => Promise.resolve(zeroPayoutResult)),
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

    expect(response.quotes).toEqual([]);
    expect(response.bestProviderId).toBeNull();
    expect(response.sourceStatus).toBe("NO_AVAILABLE_QUOTES");
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

  it("uses each provider registration's timeout without extending other providers", async () => {
    vi.useFakeTimers();
    const mockAborted = vi.fn();
    const revolutAborted = vi.fn();
    const neverResolving =
      (aborted: () => void): ProviderAdapter["getQuote"] =>
      async (_request, context) =>
        new Promise<QuoteResult>((_resolve, reject) => {
          context?.signal?.addEventListener(
            "abort",
            () => {
              aborted();
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        timeoutMs: 5,
        adapter: customAdapter(
          { id: "MOCK_PROVIDER", name: "Short deadline" },
          neverResolving(mockAborted),
        ),
      },
      {
        status: "SUPPORTED",
        timeoutMs: 50,
        adapter: customAdapter(
          { id: "REVOLUT", name: "Long deadline" },
          neverResolving(revolutAborted),
        ),
      },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const responsePromise = getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providers: ["MOCK_PROVIDER", "REVOLUT"],
      },
      { ...deterministicDependencies, registry },
    );

    await vi.advanceTimersByTimeAsync(6);
    expect(mockAborted).toHaveBeenCalledOnce();
    expect(revolutAborted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(44);
    const response = await responsePromise;

    expect(revolutAborted).toHaveBeenCalledOnce();
    expect(response.issues).toHaveLength(2);
    expect(response.issues.every((issue) => issue.kind === "error")).toBe(true);
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  it("classifies a Revolut calculation failure as FAILED rather than source-unavailable", async () => {
    const source: RevolutRateSource = {
      getRate: vi.fn(async () => ({
        pair: "EUR-HUF" as const,
        rate: "1",
        rateTimestamp: generatedAt,
        retrievedAt: generatedAt,
        sourceSenderAmount: "1",
        sourceRecipientAmount: "1",
        sourceUrl:
          "https://www.revolut.com/hu-HU/currency-converter/convert-eur-to-huf-exchange-rate/",
        freshness: "FRESH" as const,
      })),
    };
    const registry = new ProviderAdapterRegistry([
      {
        status: "SUPPORTED",
        adapter: new RevolutProviderAdapter({
          rateSource: source,
          now: () => new Date(generatedAt),
        }),
      },
    ]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await getQuotes(
      {
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "0.01",
        providers: ["REVOLUT"],
        providerContexts: {
          REVOLUT: { plan: "ULTRA", rollingThirtyDayExchangeUsedHuf: "0" },
        },
      },
      { ...deterministicDependencies, registry },
    );

    expect(response.issues[0]).toMatchObject({
      kind: "error",
      status: "FAILED",
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
