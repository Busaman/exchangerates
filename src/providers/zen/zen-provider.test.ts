import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decimal, decimalToPlainString } from "@/domain/decimal";
import type { QuoteRequest } from "@/domain/quote";
import { ZenProviderAdapter } from "@/providers/zen/zen-provider";
import {
  ZenPublicQuoteClient,
  ZenQuoteClientError,
  type ZenQuoteClient,
} from "@/providers/zen/zen-quote-client";

const fixture = readFileSync(new URL("./fixtures/huf-eur-1000.json", import.meta.url), "utf8");
const requestedAt = "2026-07-17T10:00:00.000Z";
const request: QuoteRequest = {
  providerId: "ZEN",
  sourceCurrency: "HUF",
  targetCurrency: "EUR",
  sourceAmount: "1000",
  requestedAt,
};

describe("ZenProviderAdapter", () => {
  it("normalizes the endpoint quote and calculates the HUF per EUR inverse from exchangeRate", async () => {
    const quoteClient = new ZenPublicQuoteClient({
      transport: async () =>
        new Response(fixture, { headers: { "content-type": "application/json" } }),
      now: () => new Date(requestedAt),
    });
    const result = await new ZenProviderAdapter({ quoteClient }).getQuote(request);

    expect(result).toMatchObject({
      kind: "quote",
      provider: { id: "ZEN", name: "ZEN.COM" },
      sourceType: "ESTIMATED",
      customerPlan: "Free",
      providerDetails: {
        type: "ZEN_PLANS",
        liveProRate: "0.002749",
        endpointProTargetAmount: { amount: "2.74", currency: "EUR" },
      },
    });
    expect(result.kind).toBe("quote");
    if (result.kind !== "quote" || result.providerDetails?.type !== "ZEN_PLANS") return;
    expect(result.providerDetails.sourceCurrencyPerTargetUnit).toBe(
      decimalToPlainString(decimal(1).dividedBy("0.002749")),
    );
    expect(result.providerDetails.liveProRate).not.toBe(result.effectiveRate);
    expect(result.targetAmount).toEqual({
      amount: "2.73",
      currency: "EUR",
    });
    expect(result.effectiveRate).toBe("0.00273");
    expect(result.providerDetails.targetAmountCalculation).toBe(
      "POLICY_DERIVED_TARGET_CURRENCY_ROUND_DOWN",
    );
    expect(result.planQuotes?.map((plan) => plan.plan)).toEqual([
      "Free",
      "Gold",
      "Platinum",
      "Pro",
    ]);
    expect(result.planQuotes?.[0]).toMatchObject({
      plan: "Free",
      calculationRate: decimalToPlainString(decimal("0.002749").dividedBy("1.005")),
      effectiveRate: "0.00273",
    });
    expect(result.planQuotes?.[2]).toMatchObject({
      plan: "Platinum",
      calculationRate: "0.002749",
      recipientGets: { amount: "2.74", currency: "EUR" },
    });
    expect(result.planQuotes?.[3]).toMatchObject({
      plan: "Pro",
      recipientGets: { amount: "2.74", currency: "EUR" },
    });
  });

  it("ignores third-party alternatives and never emits them as Revolut or Wise provider data", async () => {
    const quoteClient = new ZenPublicQuoteClient({
      transport: async () =>
        new Response(fixture, { headers: { "content-type": "application/json" } }),
      now: () => new Date(requestedAt),
    });
    const result = await new ZenProviderAdapter({ quoteClient }).getQuote(request);

    expect(result.provider.id).toBe("ZEN");
    expect(result).not.toHaveProperty("alternatives");
    expect(JSON.stringify(result)).not.toContain("Revolut");
    expect(JSON.stringify(result)).not.toContain("Wise");
  });

  it.each(["HTTP_403", "TIMEOUT"] as const)(
    "returns a numeric-field-free unavailable result for %s",
    async (code) => {
      const quoteClient: ZenQuoteClient = {
        getQuote: async () => {
          throw new ZenQuoteClientError(code, "private diagnostic");
        },
      };
      const result = await new ZenProviderAdapter({ quoteClient }).getQuote(request);

      expect(result).toMatchObject({ kind: "unavailable", provider: { id: "ZEN" } });
      expect(result).not.toHaveProperty("sourceAmount");
      expect(result).not.toHaveProperty("targetAmount");
      expect(JSON.stringify(result)).not.toContain("private diagnostic");
    },
  );

  it("fails closed without numeric placeholders when plan normalization fails", async () => {
    const quoteClient: ZenQuoteClient = {
      getQuote: async () => ({
        pair: "HUF-EUR",
        sourceAmount: "1000",
        targetAmount: "2.74",
        exchangeRate: "0",
        retrievedAt: requestedAt,
        sourceUrl: "https://www.zen.com/landing_currencies.php",
        freshness: "FRESH",
      }),
    };
    const result = await new ZenProviderAdapter({ quoteClient }).getQuote(request);

    expect(result).toMatchObject({
      kind: "unavailable",
      provider: { id: "ZEN" },
      reason: "ZEN plan quotes could not be normalized safely from the validated public quote.",
    });
    expect(result).not.toHaveProperty("sourceAmount");
    expect(result).not.toHaveProperty("targetAmount");
    expect(result).not.toHaveProperty("planQuotes");
  });
});
