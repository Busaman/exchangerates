import { describe, expect, it, vi } from "vitest";
import { quoteApiRequestSchema } from "@/domain/quote-api";
import { calculateRankingEffectiveRate } from "@/domain/quote-ranking";
import type { QuoteRequest } from "@/domain/quote";
import { runProviderAdapterContract } from "@/providers/provider-adapter.contract";
import { RevolutProviderAdapter } from "@/providers/revolut/revolut-provider";
import type {
  RevolutQuoteClient,
  RevolutQuoteObservation,
} from "@/providers/revolut/revolut-quote-client";
import { RevolutQuoteClientError } from "@/providers/revolut/revolut-quote-client";

const requestedAt = "2026-07-13T16:03:00.000Z";
const observation: RevolutQuoteObservation = {
  pair: "HUF-EUR",
  sourceAmount: "100000",
  targetAmount: "277.43",
  endpointRecipientAmount: "277.43",
  targetAmountCalculation: "ENDPOINT_HUNDREDTH_UNIT_DECODED",
  rate: "0.0027743132467174",
  rateTimestamp: "2026-07-13T16:02:51.976Z",
  retrievedAt: requestedAt,
  sourceUrl:
    "https://www.revolut.com/api/exchange/quote?amount=10000000&country=HU&fromCurrency=HUF&isRecipientAmount=false&toCurrency=EUR",
  freshness: "FRESH",
  plan: "STANDARD",
  fxFee: { amount: "0", currency: "HUF" },
  totalFee: { amount: "0", currency: "HUF" },
  totalSourceCost: { amount: "100000", currency: "HUF" },
  fxTooltip: "A Revolut nem számít fel díjat",
  planTooltipLong: "A Revolut nem számít fel díjat",
  planTooltipShort: "Díjmentes",
};

function quoteClient(result: RevolutQuoteObservation = observation): RevolutQuoteClient {
  return { getQuote: vi.fn(async () => result) };
}

const contractRequest: QuoteRequest = {
  providerId: "REVOLUT",
  sourceCurrency: "HUF",
  targetCurrency: "EUR",
  sourceAmount: "100000",
  requestedAt,
  providerContexts: { REVOLUT: { plan: "STANDARD" } },
};

runProviderAdapterContract({
  adapter: new RevolutProviderAdapter({ quoteClient: quoteClient() }),
  request: contractRequest,
  expectedKind: "quote",
});

describe("RevolutProviderAdapter", () => {
  it("normalizes the selected plan and actual endpoint amounts as LIVE_UNOFFICIAL", async () => {
    const adapter = new RevolutProviderAdapter({ quoteClient: quoteClient() });
    const result = await adapter.getQuote(contractRequest, {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      kind: "quote",
      sourceType: "LIVE_UNOFFICIAL",
      customerPlan: "STANDARD",
      targetAmount: { amount: "277.43", currency: "EUR" },
      effectiveRate: "0.0027743",
      rankingEffectiveRate: "0.0027743",
      rankingStatus: "ELIGIBLE",
      explicitFee: { amount: "0", currency: "HUF" },
      sourceUrl: observation.sourceUrl,
      providerDetails: {
        type: "REVOLUT_PERSONAL",
        plan: "STANDARD",
        displayedBaseRate: "0.0027743132467174",
        sourceCurrencyPerTargetUnit: "360.45",
        endpointRecipientAmount: { amount: "277.43", currency: "EUR" },
        targetAmountCalculation: "ENDPOINT_HUNDREDTH_UNIT_DECODED",
        fxFee: { amount: "0", currency: "HUF" },
        totalFee: { amount: "0", currency: "HUF" },
        feePercentage: "0",
        feePercentageBasis: "TOTAL_FEE_DIVIDED_BY_SENDER_AMOUNT",
        totalSourceCost: { amount: "100000", currency: "HUF" },
        allowanceAssumption: "FULL_ALLOWANCE_ASSUMED",
        sessionClassification: "WEEKDAY",
        feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
        planTooltipShort: "Díjmentes",
      },
    });
  });

  it("returns the exact recipient decoded at the endpoint boundary for a small quote", async () => {
    const lowAmountObservation: RevolutQuoteObservation = {
      ...observation,
      sourceAmount: "100",
      targetAmount: "0.28",
      endpointRecipientAmount: "0.28",
      totalSourceCost: { amount: "100", currency: "HUF" },
      sourceUrl:
        "https://www.revolut.com/api/exchange/quote?amount=10000&country=HU&fromCurrency=HUF&isRecipientAmount=false&toCurrency=EUR",
    };
    const result = await new RevolutProviderAdapter({
      quoteClient: quoteClient(lowAmountObservation),
    }).getQuote({ ...contractRequest, sourceAmount: "100" });

    expect(result).toMatchObject({
      kind: "quote",
      targetAmount: { amount: "0.28", currency: "EUR" },
      effectiveRate: "0.0028",
      providerDetails: {
        endpointRecipientAmount: { amount: "0.28", currency: "EUR" },
        targetAmountCalculation: "ENDPOINT_HUNDREDTH_UNIT_DECODED",
        sourceCurrencyPerTargetUnit: "360.45",
      },
    });
  });

  it("uses an independent EUR to HUF endpoint observation", async () => {
    const eurObservation: RevolutQuoteObservation = {
      ...observation,
      pair: "EUR-HUF",
      sourceAmount: "1000",
      targetAmount: "354879",
      endpointRecipientAmount: "354879",
      rate: "354.87926170023974",
      plan: "STANDARD",
      fxFee: { amount: "0", currency: "EUR" },
      totalFee: { amount: "0", currency: "EUR" },
      totalSourceCost: { amount: "1000", currency: "EUR" },
      sourceUrl:
        "https://www.revolut.com/api/exchange/quote?amount=100000&country=HU&fromCurrency=EUR&isRecipientAmount=false&toCurrency=HUF",
    };
    const result = await new RevolutProviderAdapter({
      quoteClient: quoteClient(eurObservation),
    }).getQuote({
      ...contractRequest,
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
      providerContexts: { REVOLUT: { plan: "METAL" } },
    });

    expect(result).toMatchObject({
      kind: "quote",
      targetAmount: { amount: "354879", currency: "HUF" },
      customerPlan: "STANDARD",
      providerDetails: { plan: "STANDARD", displayedBaseRate: "354.87926170023974" },
    });
  });

  it("uses Standard as the default ranking quote when personal plan context is missing", async () => {
    const client = quoteClient();
    const result = await new RevolutProviderAdapter({ quoteClient: client }).getQuote({
      ...contractRequest,
      providerContexts: undefined,
    });

    expect(result).toMatchObject({ kind: "quote", customerPlan: "STANDARD" });
    expect(client.getQuote).toHaveBeenCalledWith(
      expect.objectContaining({ plan: "STANDARD" }),
      undefined,
    );
  });

  it("does not substitute any fallback after endpoint failure", async () => {
    const client: RevolutQuoteClient = {
      getQuote: vi.fn(async () => Promise.reject(new Error("endpoint unavailable"))),
    };
    const result = await new RevolutProviderAdapter({ quoteClient: client }).getQuote(
      contractRequest,
    );

    expect(result).toMatchObject({ kind: "unavailable", provider: { id: "REVOLUT" } });
    expect(result).not.toHaveProperty("effectiveRate");
  });

  it("returns a Standard-specific numeric-field-free reason when the endpoint omits it", async () => {
    const client: RevolutQuoteClient = {
      getQuote: vi.fn(async () =>
        Promise.reject(new RevolutQuoteClientError("SELECTED_PLAN_MISSING")),
      ),
    };
    const result = await new RevolutProviderAdapter({ quoteClient: client }).getQuote({
      ...contractRequest,
      providerContexts: { REVOLUT: { plan: "PLUS" } },
    });

    expect(result).toMatchObject({
      kind: "unavailable",
      reason: "The public Revolut endpoint did not return the required STANDARD plan.",
    });
    expect(result).not.toHaveProperty("targetAmount");
    expect(result).not.toHaveProperty("rankingEffectiveRate");
  });

  it("fails closed if an injected client returns a non-Standard observation", async () => {
    const result = await new RevolutProviderAdapter({
      quoteClient: quoteClient({ ...observation, plan: "PLUS" }),
    }).getQuote(contractRequest);

    expect(result).toMatchObject({
      kind: "unavailable",
      reason: "The validated Revolut observation did not contain the required STANDARD plan.",
    });
    expect(result).not.toHaveProperty("sourceAmount");
    expect(result).not.toHaveProperty("targetAmount");
    expect(result).not.toHaveProperty("planQuotes");
  });

  it("preserves STALE endpoint classification without ranking it live", async () => {
    const result = await new RevolutProviderAdapter({
      quoteClient: quoteClient({ ...observation, freshness: "STALE" }),
    }).getQuote(contractRequest);

    expect(result).toMatchObject({ kind: "quote", status: "STALE", freshness: "STALE" });
  });

  it("uses endpoint fees once without manually reducing the returned recipient amount", async () => {
    const result = await new RevolutProviderAdapter({
      quoteClient: quoteClient({
        ...observation,
        sourceAmount: "1100000",
        targetAmount: "3051.74",
        fxFee: { amount: "7500", currency: "HUF" },
        totalFee: { amount: "7500", currency: "HUF" },
        totalSourceCost: { amount: "1107500", currency: "HUF" },
      }),
    }).getQuote({ ...contractRequest, sourceAmount: "1100000" });

    expect(result).toMatchObject({
      kind: "quote",
      rankingStatus: "ELIGIBLE",
      targetAmount: { amount: "3051.74" },
      explicitFee: { amount: "7500" },
      totalCost: { amount: "7500" },
      providerDetails: {
        totalSourceCost: { amount: "1107500" },
        feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
      },
    });
    expect(result.kind === "quote" ? result.rankingEffectiveRate : null).toBe(
      calculateRankingEffectiveRate({
        sourceAmount: { currency: "HUF", amount: "1100000" },
        targetAmount: { currency: "EUR", amount: "3051.74" },
        totalSourceCost: { currency: "HUF", amount: "1107500" },
      }),
    );
  });

  it("normalizes a small endpoint fee percentage without rounding it to zero", async () => {
    const result = await new RevolutProviderAdapter({
      quoteClient: quoteClient({
        ...observation,
        pair: "EUR-HUF",
        sourceAmount: "981",
        targetAmount: "350020",
        endpointRecipientAmount: "350020.8",
        rate: "356.8",
        fxFee: { amount: "0.01", currency: "EUR" },
        totalFee: { amount: "0.01", currency: "EUR" },
        totalSourceCost: { amount: "981.01", currency: "EUR" },
      }),
    }).getQuote({
      ...contractRequest,
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "981",
    });

    expect(result).toMatchObject({
      kind: "quote",
      rankingStatus: "ELIGIBLE",
      explicitFee: { amount: "0.01", currency: "EUR" },
      providerDetails: {
        totalFee: { amount: "0.01", currency: "EUR" },
        feePercentage: "0.001019367991845056065239551478083588175331",
        feePercentageBasis: "TOTAL_FEE_DIVIDED_BY_SENDER_AMOUNT",
        feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
      },
    });
  });

  it.each(["BUSINESS", "PRO"])("does not accept the %s plan", (plan) => {
    expect(
      quoteApiRequestSchema.safeParse({
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "100000",
        providers: ["REVOLUT"],
        providerContexts: { REVOLUT: { plan } },
      }).success,
    ).toBe(false);
  });
});
