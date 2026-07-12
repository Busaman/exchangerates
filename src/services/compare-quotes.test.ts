import { describe, expect, it, vi } from "vitest";
import {
  availableQuoteSchema,
  type Provider,
  type QuoteRequest,
  type QuoteResult,
} from "@/domain/quote";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { compareQuotes } from "@/services/compare-quotes";

const requestedAt = "2026-01-01T12:00:00.000Z";

function createQuote(provider: Provider, targetAmount: string): QuoteResult {
  return availableQuoteSchema.parse({
    kind: "quote",
    provider,
    pair: { sourceCurrency: "EUR", targetCurrency: "HUF" },
    direction: "SELL_SOURCE_BUY_TARGET",
    sourceAmount: { currency: "EUR", amount: "1" },
    targetAmount: { currency: "HUF", amount: targetAmount },
    effectiveRate: targetAmount,
    explicitFee: { currency: "EUR", amount: "0" },
    totalCost: { currency: "EUR", amount: "0" },
    rateTimestamp: requestedAt,
    retrievedAt: requestedAt,
    sourceType: "MOCK",
    status: "AVAILABLE",
    freshness: "FRESH",
    reliability: "LOW",
  });
}

function fixedAdapter(provider: Provider, result: QuoteResult): ProviderAdapter {
  return { provider, getQuote: async () => Promise.resolve(result) };
}

function createUnavailable(provider: Provider): QuoteResult {
  return {
    kind: "unavailable",
    provider,
    pair: { sourceCurrency: "EUR", targetCurrency: "HUF" },
    status: "UNAVAILABLE",
    freshness: "UNKNOWN",
    reliability: "NOT_APPLICABLE",
    retrievedAt: requestedAt,
    reason: "Unavailable for test",
  };
}

const request: Omit<QuoteRequest, "providerId"> = {
  sourceCurrency: "EUR",
  targetCurrency: "HUF",
  sourceAmount: "1",
  requestedAt,
};

describe("compareQuotes", () => {
  it("orders large decimal amounts exactly and keeps unavailable results last", async () => {
    const lowProvider = { id: "low", name: "Low" };
    const highProvider = { id: "high", name: "High" };
    const unavailableProvider = { id: "down", name: "Down" };

    const results = await compareQuotes(request, [
      fixedAdapter(lowProvider, createQuote(lowProvider, "9007199254740992")),
      fixedAdapter(unavailableProvider, createUnavailable(unavailableProvider)),
      fixedAdapter(highProvider, createQuote(highProvider, "9007199254740993")),
    ]);

    expect(results.map((result) => result.provider.id)).toEqual(["high", "low", "down"]);
  });

  it("isolates a throwing adapter as an unavailable result", async () => {
    const provider = { id: "throwing", name: "Throwing" };
    const adapter: ProviderAdapter = {
      provider,
      getQuote: async () => Promise.reject(new Error("provider timeout")),
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const [result] = await compareQuotes(request, [adapter]);

    expect(result.kind).toBe("unavailable");
    expect(result).not.toHaveProperty("targetAmount");
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it("preserves adapter order when both results are unavailable", async () => {
    const firstProvider = { id: "first-down", name: "First down" };
    const secondProvider = { id: "second-down", name: "Second down" };

    const results = await compareQuotes(request, [
      fixedAdapter(firstProvider, createUnavailable(firstProvider)),
      fixedAdapter(secondProvider, createUnavailable(secondProvider)),
    ]);

    expect(results.map((result) => result.provider.id)).toEqual(["first-down", "second-down"]);
  });
});
