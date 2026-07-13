import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseRevolutPublicPage,
  RevolutPageParseError,
} from "@/providers/revolut/revolut-page-parser";

const eurHufHtml = readFileSync(new URL("./fixtures/eur-huf.html", import.meta.url), "utf8");
const hufEurHtml = readFileSync(new URL("./fixtures/huf-eur.html", import.meta.url), "utf8");
// The two directional fixtures were captured independently at different times. They prove parser
// behavior only and must not be interpreted as a simultaneous bid/ask spread observation.
const eurObservedAt = new Date(1783951201280 + 60_000);
const hufObservedAt = new Date(1783945437594 + 60_000);

function expectParseCode(action: () => unknown, code: string) {
  expect(action).toThrowError(expect.objectContaining<Partial<RevolutPageParseError>>({ code }));
}

describe("parseRevolutPublicPage", () => {
  it("parses the saved EUR to HUF structured fixture", () => {
    expect(
      parseRevolutPublicPage({ html: eurHufHtml, expectedPair: "EUR-HUF", now: eurObservedAt }),
    ).toMatchObject({
      pair: "EUR-HUF",
      rate: "354.87926170023974",
      sourceSenderAmount: "100000",
      sourceRecipientAmount: "35487926",
    });
  });

  it("parses the saved HUF to EUR structured fixture independently", () => {
    expect(
      parseRevolutPublicPage({ html: hufEurHtml, expectedPair: "HUF-EUR", now: hufObservedAt }),
    ).toMatchObject({ pair: "HUF-EUR", rate: "0.0027870214788934" });
  });

  it("selects only the named exchange widget and its nested timestamp", () => {
    const withDecoys = eurHufHtml
      .replace('"pageProps": {', '"pageProps": { "timestamp": 1, "rate": 9999,')
      .replace(
        '"widgetData": {',
        '"widgetData": { "decoy-widget": { "senderCurrency": "HUF", "recipientCurrency": "EUR", "senderAmount": 1, "recipientAmount": 9999, "rate": { "from": "HUF", "rate": 9999, "timestamp": 1, "to": "EUR" } },',
      );

    expect(
      parseRevolutPublicPage({ html: withDecoys, expectedPair: "EUR-HUF", now: eurObservedAt }),
    ).toMatchObject({
      pair: "EUR-HUF",
      rate: "354.87926170023974",
      rateTimestamp: new Date(1783951201280).toISOString(),
    });
  });

  it("rejects content for the wrong currency direction", () => {
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: eurHufHtml,
          expectedPair: "HUF-EUR",
          now: eurObservedAt,
        }),
      "WRONG_CURRENCY_PAIR",
    );
  });

  it("rejects malformed HTML and missing rate data", () => {
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: "<html><body>not structured data</body></html>",
          expectedPair: "EUR-HUF",
          now: eurObservedAt,
        }),
      "MISSING_STRUCTURED_DATA",
    );
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: eurHufHtml.replace(/"rate":\s*\{[\s\S]*?"to":\s*"HUF"\s*\}/u, '"rate": null'),
          expectedPair: "EUR-HUF",
          now: eurObservedAt,
        }),
      "MISSING_RATE",
    );
  });

  it("rejects challenge, access-error and bot-blocking pages", () => {
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: "<html><head><title>Just a quick security check | Revolut</title></head></html>",
          expectedPair: "EUR-HUF",
          now: eurObservedAt,
        }),
      "BLOCKED_PAGE",
    );
    for (const title of ["Consent required | Revolut", "Error | Revolut"]) {
      expectParseCode(
        () =>
          parseRevolutPublicPage({
            html: `<html><head><title>${title}</title></head></html>`,
            expectedPair: "EUR-HUF",
            now: eurObservedAt,
          }),
        "BLOCKED_PAGE",
      );
    }
  });

  it("rejects implausible and stale rates", () => {
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: eurHufHtml.replace("354.87926170023974", "5000"),
          expectedPair: "EUR-HUF",
          now: eurObservedAt,
        }),
      "IMPLAUSIBLE_RATE",
    );
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: eurHufHtml,
          expectedPair: "EUR-HUF",
          now: new Date(1783951201280 + 16 * 60_000),
        }),
      "STALE_SOURCE_RATE",
    );
  });

  it("rejects a rate that is inconsistent with the structured amounts", () => {
    expectParseCode(
      () =>
        parseRevolutPublicPage({
          html: eurHufHtml.replace(/"recipientAmount":\s*35487926/u, '"recipientAmount": 30000000'),
          expectedPair: "EUR-HUF",
          now: eurObservedAt,
        }),
      "INCONSISTENT_AMOUNTS",
    );
  });
});
