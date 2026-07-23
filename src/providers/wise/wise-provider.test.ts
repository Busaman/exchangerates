import { describe, expect, it } from "vitest";
import { runProviderAdapterContract } from "@/providers/provider-adapter.contract";
import { WiseProviderAdapter, wiseIndicativeWarning } from "@/providers/wise/wise-provider";
import type { WiseQuoteClient, WiseQuoteObservation } from "@/providers/wise/wise-quote-client";
import type { QuoteRequest } from "@/domain/quote";

const request = {
  providerId: "WISE",
  sourceCurrency: "HUF",
  targetCurrency: "EUR",
  sourceAmount: "998877",
  requestedAt: "2026-07-16T18:44:00.000Z",
} as const satisfies QuoteRequest;

const observation = {
  sourceAmount: "998877",
  targetAmount: "2721.46",
  fee: "14537",
  rate: "0.00276476",
  effectiveRate: "0.002724519635550723462448329473999301215265",
  markup: "0",
  isConsideredMidMarketRate: true,
  rateTimestamp: "2026-07-16T18:43:36.000Z",
  retrievedAt: "2026-07-16T18:44:00.000Z",
  sourceUrl:
    "https://wise.com/gateway/v4/comparisons?sourceCurrency=HUF&targetCurrency=EUR&sendAmount=998877&sourceCountry=HU&filter=POPULAR&includeWise=true&numberOfProviders=3",
  freshness: "FRESH",
} as const satisfies WiseQuoteObservation;

class FixtureClient implements WiseQuoteClient {
  constructor(private readonly value: WiseQuoteObservation | Error = observation) {}

  async getQuote(): Promise<WiseQuoteObservation> {
    if (this.value instanceof Error) throw this.value;
    return this.value;
  }
}

const adapter = new WiseProviderAdapter({ quoteClient: new FixtureClient() });

runProviderAdapterContract({ adapter, request, expectedKind: "quote" });

describe("WiseProviderAdapter", () => {
  it("normalizes one Personal quote and uses the included fee exactly once", async () => {
    const result = await adapter.getQuote(request);
    expect(result).toMatchObject({
      kind: "quote",
      provider: { id: "WISE", name: "Wise" },
      sourceAmount: { currency: "HUF", amount: "998877" },
      targetAmount: { currency: "EUR", amount: "2721.46" },
      explicitFee: { currency: "HUF", amount: "14537" },
      totalCost: { currency: "HUF", amount: "14537" },
      rankingEffectiveRate: observation.effectiveRate,
      sourceType: "LIVE_UNOFFICIAL",
      customerPlan: "Personal / Alapárazás",
      disclaimer: wiseIndicativeWarning,
      providerDetails: {
        type: "WISE_PERSONAL",
        totalSourceCost: { currency: "HUF", amount: "998877" },
        fundingContext: "BANK_TRANSFER_COMPARISON",
        quoteScope: "PUBLIC_COMPARISON_NOT_ACCOUNT_SPECIFIC",
      },
    });
    if (result.kind !== "quote") throw new Error("Expected quote");
    expect(result.planQuotes).toHaveLength(1);
    expect(result.planQuotes?.[0]).toMatchObject({
      quoteKind: "live",
      plan: "Personal / Alapárazás",
      isDefaultPlan: true,
      monthlyFee: { currency: "EUR", amount: "0" },
      feeAmount: { currency: "HUF", amount: "14537" },
      totalSourceCost: { currency: "HUF", amount: "998877" },
    });
  });

  it("returns numeric-field-free unavailable when the endpoint has no Wise quote", async () => {
    const result = await new WiseProviderAdapter({
      quoteClient: new FixtureClient(new Error("WISE_PROVIDER_MISSING")),
    }).getQuote(request);
    expect(result).toMatchObject({ kind: "unavailable", provider: { id: "WISE" } });
    expect(result).not.toHaveProperty("targetAmount");
    expect(result).not.toHaveProperty("explicitFee");
  });
});
