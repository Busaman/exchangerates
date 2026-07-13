import { describe, expect, it, vi } from "vitest";
import { quoteApiRequestSchema } from "@/domain/quote-api";
import type { QuoteRequest } from "@/domain/quote";
import { runProviderAdapterContract } from "@/providers/provider-adapter.contract";
import { RevolutProviderAdapter } from "@/providers/revolut/revolut-provider";
import type {
  RevolutRateObservation,
  RevolutRateSource,
} from "@/providers/revolut/revolut-rate-source";

const requestedAt = "2026-01-05T15:00:00.000Z";
const observation: RevolutRateObservation = {
  pair: "EUR-HUF",
  rate: "400",
  rateTimestamp: "2026-01-05T14:59:30.000Z",
  retrievedAt: "2026-01-05T15:00:00.000Z",
  sourceSenderAmount: "100000",
  sourceRecipientAmount: "40000000",
  sourceUrl: "https://www.revolut.com/hu-HU/currency-converter/convert-eur-to-huf-exchange-rate/",
  freshness: "FRESH",
};

function rateSource(result: RevolutRateObservation = observation): RevolutRateSource {
  return { getRate: vi.fn(async () => Promise.resolve(result)) };
}

const contractRequest: QuoteRequest = {
  providerId: "REVOLUT",
  sourceCurrency: "EUR",
  targetCurrency: "HUF",
  sourceAmount: "1000",
  requestedAt,
  providerContexts: {
    REVOLUT: { plan: "STANDARD", monthlyExchangeUsedHuf: "0" },
  },
};

runProviderAdapterContract({
  adapter: new RevolutProviderAdapter({
    rateSource: rateSource(),
    now: () => new Date(requestedAt),
  }),
  request: contractRequest,
  expectedKind: "quote",
});

describe("RevolutProviderAdapter", () => {
  it("returns a normalized LIVE_UNOFFICIAL personal quote with provenance", async () => {
    const adapter = new RevolutProviderAdapter({
      rateSource: rateSource(),
      now: () => new Date(requestedAt),
    });
    const result = await adapter.getQuote(contractRequest, {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      kind: "quote",
      sourceType: "LIVE_UNOFFICIAL",
      customerPlan: "STANDARD",
      sourceUrl: observation.sourceUrl,
      providerDetails: {
        type: "REVOLUT_PERSONAL",
        displayedBaseRate: "400",
        fairUsageFee: { amount: "1.25", currency: "EUR" },
        totalFee: { amount: "1.25", currency: "EUR" },
      },
    });
  });

  it("uses an independent HUF to EUR observation without reciprocal inference", async () => {
    const hufObservation: RevolutRateObservation = {
      ...observation,
      pair: "HUF-EUR",
      rate: "0.0025",
      sourceSenderAmount: "100000",
      sourceRecipientAmount: "250",
      sourceUrl:
        "https://www.revolut.com/hu-HU/currency-converter/convert-huf-to-eur-exchange-rate/",
    };
    const adapter = new RevolutProviderAdapter({
      rateSource: rateSource(hufObservation),
      now: () => new Date(requestedAt),
    });
    const result = await adapter.getQuote({
      ...contractRequest,
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "100000",
    });

    expect(result).toMatchObject({
      kind: "quote",
      targetAmount: { currency: "EUR", amount: "250.00" },
      providerDetails: { displayedBaseRate: "0.0025" },
      sourceUrl: hufObservation.sourceUrl,
    });
  });

  it("returns no numeric quote when personal context is missing", async () => {
    const source = rateSource();
    const adapter = new RevolutProviderAdapter({ rateSource: source });
    const result = await adapter.getQuote({
      ...contractRequest,
      providerContexts: undefined,
    });

    expect(result.kind).toBe("unavailable");
    expect(result).not.toHaveProperty("targetAmount");
    expect(source.getRate).not.toHaveBeenCalled();
  });

  it("does not substitute a fallback after source failure", async () => {
    const source: RevolutRateSource = {
      getRate: vi.fn(async () => Promise.reject(new Error("blocked"))),
    };
    const result = await new RevolutProviderAdapter({ rateSource: source }).getQuote(
      contractRequest,
    );

    expect(result).toMatchObject({ kind: "unavailable", provider: { id: "REVOLUT" } });
    expect(result).not.toHaveProperty("effectiveRate");
  });

  it("preserves STALE source classification without making it live", async () => {
    const adapter = new RevolutProviderAdapter({
      rateSource: rateSource({ ...observation, freshness: "STALE" }),
      now: () => new Date(requestedAt),
    });
    const result = await adapter.getQuote(contractRequest);

    expect(result).toMatchObject({ kind: "quote", status: "STALE", freshness: "STALE" });
  });

  it.each(["BUSINESS", "PRO"])("does not accept the %s plan", (plan) => {
    const parsed = quoteApiRequestSchema.safeParse({
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
      providers: ["REVOLUT"],
      providerContexts: {
        REVOLUT: { plan, monthlyExchangeUsedHuf: "0" },
      },
    });
    expect(parsed.success).toBe(false);
  });
});
