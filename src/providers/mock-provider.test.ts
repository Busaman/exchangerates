import { describe, expect, it } from "vitest";
import { createMockQuote, MockProviderAdapter } from "@/providers/mock-provider";

describe("createMockQuote", () => {
  it("returns a deterministic, explicitly mocked EUR/HUF quote", () => {
    const quote = createMockQuote({
      providerId: "mock-fintech",
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000.00",
      requestedAt: "2026-01-01T12:00:00.000Z",
    });

    expect(quote.sourceType).toBe("MOCK");
    expect(quote.targetAmount).toEqual({ currency: "HUF", amount: "391323" });
    expect(quote.explicitFee).toEqual({ currency: "EUR", amount: "3" });
    expect(quote.effectiveRate).toBe("391.3225");
  });

  it("does not treat the reverse direction as an exact inverse", () => {
    const quote = createMockQuote({
      providerId: "mock-fintech",
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "400000",
      requestedAt: "2026-01-01T12:00:00.000Z",
    });

    expect(quote.effectiveRate).toBe("0.00248253");
    expect(quote.targetAmount.currency).toBe("EUR");
  });

  it("preserves significant zeroes in integer target amounts", () => {
    const quote = createMockQuote({
      providerId: "mock-fintech",
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000.02",
      requestedAt: "2026-01-01T12:00:00.000Z",
    });

    expect(quote.targetAmount.amount).toBe("391330");
  });

  it("returns unavailable instead of throwing for an unsupported pair", async () => {
    const result = await new MockProviderAdapter().getQuote({
      providerId: "mock-fintech",
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      sourceAmount: "1000",
      requestedAt: "2026-01-01T12:00:00.000Z",
    });

    expect(result.kind).toBe("unavailable");
    expect(result).not.toHaveProperty("targetAmount");
  });
});
