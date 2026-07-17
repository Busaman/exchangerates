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
      targetAmount: { amount: "2.73", currency: "EUR" },
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
    expect(result.effectiveRate).toBe(decimalToPlainString(decimal("0.002749").dividedBy("1.005")));
    expect(result.providerDetails.liveProRate).not.toBe(result.effectiveRate);
    expect(result.planQuotes?.map((plan) => plan.plan)).toEqual([
      "Free",
      "Gold",
      "Platinum",
      "Pro",
    ]);
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
});
