import { describe, expect, it } from "vitest";
import { decimal } from "@/domain/decimal";
import eurHufFixture from "@/providers/wise/fixtures/eur-huf-comparison.json";
import hufEurFixture from "@/providers/wise/fixtures/huf-eur-comparison.json";
import {
  parseWiseComparisonResponse,
  type WiseComparisonRequestEvidence,
} from "@/providers/wise/wise-comparison-parser";

const hufRequest = {
  sendAmount: "998877",
  sourceCountry: "HU",
  sourceCurrency: "HUF",
  targetCurrency: "EUR",
} as const satisfies WiseComparisonRequestEvidence;

const eurRequest = {
  sendAmount: "1000",
  sourceCountry: "HU",
  sourceCurrency: "EUR",
  targetCurrency: "HUF",
} as const satisfies WiseComparisonRequestEvidence;

function parseHuf(payload: unknown = hufEurFixture) {
  return parseWiseComparisonResponse({
    observedAt: new Date("2026-07-16T18:44:00Z"),
    payload,
    request: hufRequest,
  });
}

function hufPayloadWithQuotes(quotes: ReadonlyArray<unknown>) {
  const provider = hufEurFixture.providers[0];
  if (provider === undefined) throw new Error("Invalid HUF/EUR test fixture provider");

  return {
    ...hufEurFixture,
    providers: [{ ...provider, quotes: [...quotes] }],
  };
}

function hufPayloadWithQuote(overrides: Readonly<Record<string, unknown>>) {
  const quote = hufEurFixture.providers[0]?.quotes[0];
  if (quote === undefined) throw new Error("Invalid HUF/EUR test fixture quote");
  return hufPayloadWithQuotes([{ ...quote, ...overrides }]);
}

describe("parseWiseComparisonResponse", () => {
  it("validates sanitized HUF to EUR evidence with decimal-safe reconciliation", () => {
    expect(parseHuf()).toMatchObject({
      amount: "998877",
      amountType: "SEND",
      convertedSourceAmount: "984340",
      effectiveRate: "0.002724519635550723462448329473999301215265",
      fee: "14537",
      isConsideredMidMarketRate: true,
      markup: "0",
      providerAlias: "wise",
      quoteSendAmount: null,
      rate: "0.00276476",
      receivedAmount: "2721.46",
      validationResult: "PASS",
      wiseQuoteCount: 1,
    });
  });

  it("validates sanitized EUR to HUF evidence with HUF-unit tolerance", () => {
    const result = parseWiseComparisonResponse({
      observedAt: new Date("2026-07-16T21:17:00Z"),
      payload: eurHufFixture,
      request: eurRequest,
    });

    expect(result).toMatchObject({
      amount: "1000",
      convertedSourceAmount: "983.99",
      fee: "16.01",
      rate: "362.13",
      receivedAmount: "356332",
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
    });
    expect(decimal(result.mathematicalDifference).lessThanOrEqualTo("1")).toBe(true);
  });

  it("requires exactly one Wise provider and exactly one understandable quote", () => {
    expect(() => parseHuf({ ...hufEurFixture, providers: [] })).toThrow("WISE_PROVIDER_MISSING");
    expect(() =>
      parseHuf({
        ...hufEurFixture,
        providers: [
          hufEurFixture.providers[0],
          { ...hufEurFixture.providers[0], name: "Duplicate Wise" },
        ],
      }),
    ).toThrow("WISE_PROVIDER_NOT_UNIQUE");
    expect(() => parseHuf(hufPayloadWithQuotes([]))).toThrow("WISE_QUOTE_COUNT_UNSUPPORTED");
    const quote = hufEurFixture.providers[0]?.quotes[0];
    if (quote === undefined) throw new Error("Invalid HUF/EUR test fixture quote");
    expect(() => parseHuf(hufPayloadWithQuotes([quote, quote]))).toThrow(
      "WISE_QUOTE_COUNT_UNSUPPORTED",
    );
  });

  it("fails closed for malformed, mismatched and non-positive values", () => {
    expect(() => parseHuf({ amount: 998877 })).toThrow("MALFORMED_RESPONSE");
    expect(() => parseHuf({ ...hufEurFixture, amount: 998878 })).toThrow("AMOUNT_MISMATCH");
    expect(() => parseHuf({ ...hufEurFixture, targetCurrency: "HUF" })).toThrow(
      "CURRENCY_MISMATCH",
    );
    expect(() => parseHuf({ ...hufEurFixture, sourceCountry: null })).toThrow(
      "SOURCE_COUNTRY_MISMATCH",
    );
    expect(() => parseHuf(hufPayloadWithQuote({ sourceCountry: "DE" }))).toThrow(
      "QUOTE_SOURCE_COUNTRY_MISMATCH",
    );
    expect(() => parseHuf(hufPayloadWithQuote({ fee: -1 }))).toThrow("NEGATIVE_FEE");
    expect(() => parseHuf({ ...hufEurFixture, sourceCountry: "hu" })).toThrow("MALFORMED_RESPONSE");
    expect(() => parseHuf(hufPayloadWithQuote({ sourceCountry: "hu" }))).toThrow(
      "MALFORMED_WISE_QUOTE",
    );
  });

  it("rejects non-positive quote values and negative markup with precise codes", () => {
    expect(() => parseHuf(hufPayloadWithQuote({ rate: 0 }))).toThrow("NON_POSITIVE_RATE");
    expect(() => parseHuf(hufPayloadWithQuote({ receivedAmount: 0 }))).toThrow(
      "NON_POSITIVE_RECEIVED_AMOUNT",
    );
    expect(() => parseHuf(hufPayloadWithQuote({ markup: -0.01 }))).toThrow("NEGATIVE_MARKUP");
  });

  it("rejects identical currencies and malformed request decimals", () => {
    expect(() =>
      parseWiseComparisonResponse({
        observedAt: new Date("2026-07-16T18:44:00Z"),
        payload: hufEurFixture,
        request: { ...hufRequest, targetCurrency: "HUF" },
      }),
    ).toThrow("IDENTICAL_CURRENCIES");
    expect(() =>
      parseWiseComparisonResponse({
        observedAt: new Date("2026-07-16T18:44:00Z"),
        payload: hufEurFixture,
        request: { ...hufRequest, sendAmount: "not-a-decimal" },
      }),
    ).toThrow("INVALID_DECIMAL_VALUE");
  });

  it("rejects mathematical mismatches and stale or future timestamps", () => {
    expect(() => parseHuf(hufPayloadWithQuote({ receivedAmount: 2700 }))).toThrow(
      "MATHEMATICAL_MISMATCH",
    );
    expect(() => parseHuf(hufPayloadWithQuote({ dateCollected: "not-a-timestamp" }))).toThrow(
      "INVALID_QUOTE_TIMESTAMP",
    );
    expect(() =>
      parseWiseComparisonResponse({
        observedAt: new Date("2026-07-16T19:00:00Z"),
        payload: hufEurFixture,
        request: hufRequest,
      }),
    ).toThrow("STALE_QUOTE_TIMESTAMP");
    expect(() =>
      parseWiseComparisonResponse({
        observedAt: new Date("2026-07-16T18:40:00Z"),
        payload: hufEurFixture,
        request: hufRequest,
      }),
    ).toThrow("FUTURE_QUOTE_TIMESTAMP");
  });
});
