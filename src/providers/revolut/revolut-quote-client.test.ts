import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { revolutQuoteClientConfig } from "@/providers/revolut/revolut-config";
import {
  parseRevolutQuoteResponse,
  RevolutPublicQuoteClient,
  type RevolutQuoteRequest,
} from "@/providers/revolut/revolut-quote-client";

const hufEurJson = readFileSync(new URL("./fixtures/huf-eur.json", import.meta.url), "utf8");
const eurHufJson = readFileSync(new URL("./fixtures/eur-huf.json", import.meta.url), "utf8");
const planFeesJson = readFileSync(
  new URL("./fixtures/huf-eur-plan-fees.json", import.meta.url),
  "utf8",
);
const hufTimestamp = 1783958571976;
const hufObservedAt = new Date(hufTimestamp + 60_000);
const hufRequest: RevolutQuoteRequest = {
  pair: "HUF-EUR",
  sourceAmount: "100000",
  plan: "STANDARD",
};

function payload(json = hufEurJson): unknown {
  return JSON.parse(json) as unknown;
}

function response(
  body = hufEurJson,
  options: { status?: number; contentType?: string } = {},
): Response {
  return new Response(body, {
    status: options.status ?? 200,
    headers: { "content-type": options.contentType ?? "application/json" },
  });
}

function parse(json: string, request = hufRequest) {
  return parseRevolutQuoteResponse({
    payload: payload(json),
    request,
    retrievedAt: hufObservedAt,
    sourceUrl:
      "https://www.revolut.com/api/exchange/quote?amount=100000&country=HU&fromCurrency=HUF&isRecipientAmount=false&toCurrency=EUR",
  });
}

describe("parseRevolutQuoteResponse", () => {
  it("parses a HUF to EUR quote from the public JSON contract", () => {
    expect(parse(hufEurJson)).toMatchObject({
      pair: "HUF-EUR",
      sourceAmount: "100000",
      targetAmount: "277.43",
      rate: "0.0027743132467174",
      plan: "STANDARD",
      fxFee: { amount: "0", currency: "HUF" },
      totalFee: { amount: "0", currency: "HUF" },
      totalSourceCost: { amount: "100000", currency: "HUF" },
      fxTooltip: "A Revolut nem számít fel díjat",
      planTooltipShort: "Díjmentes",
    });
  });

  it("parses EUR to HUF independently without reciprocal inference", () => {
    const request: RevolutQuoteRequest = {
      pair: "EUR-HUF",
      sourceAmount: "1000",
      plan: "STANDARD",
    };
    const observation = parseRevolutQuoteResponse({
      payload: payload(eurHufJson),
      request,
      retrievedAt: new Date(1783951201280 + 60_000),
      sourceUrl:
        "https://www.revolut.com/api/exchange/quote?amount=1000&country=HU&fromCurrency=EUR&isRecipientAmount=false&toCurrency=HUF",
    });

    expect(observation).toMatchObject({
      pair: "EUR-HUF",
      targetAmount: "354879",
      rate: "354.87926170023974",
      fxFee: { currency: "EUR" },
    });
  });

  it.each(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"] as const)(
    "selects exactly the requested %s plan",
    (plan) => {
      const observation = parse(planFeesJson, {
        pair: "HUF-EUR",
        sourceAmount: "1100000",
        plan,
      });
      const expectedFee = plan === "STANDARD" ? "7500" : plan === "PLUS" ? "250" : "0";

      expect(observation.plan).toBe(plan);
      expect(observation.fxFee.amount).toBe(expectedFee);
      expect(observation.totalFee.amount).toBe(expectedFee);
    },
  );

  it.each(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"] as const)(
    "normalizes a zero-fee below-allowance %s fixture without adding manual fees",
    (plan) => {
      const observation = parse(hufEurJson, { ...hufRequest, plan });

      expect(observation.fxFee.amount).toBe("0");
      expect(observation.totalFee.amount).toBe("0");
      expect(observation.totalSourceCost.amount).toBe("100000");
    },
  );

  it("fails closed when the selected plan is missing", () => {
    const withoutMetal = hufEurJson.replace('"id": "METAL"', '"id": "REMOVED"');
    expect(() => parse(withoutMetal, { ...hufRequest, plan: "METAL" })).toThrow(
      "SELECTED_PLAN_MISSING_OR_DUPLICATED",
    );
  });

  it("fails closed when selected-plan fees are malformed", () => {
    const malformed = hufEurJson.replace(
      '"total": { "amount": 0, "currency": "HUF" }',
      '"total": { "currency": "HUF" }',
    );
    expect(() => parse(malformed)).toThrow("SELECTED_PLAN_FEES_INVALID");
  });

  it("rejects sender amount and currency-direction mismatches", () => {
    expect(() => parse(hufEurJson.replace('"amount": 100000', '"amount": 99999'))).toThrow(
      "SENDER_AMOUNT_MISMATCH",
    );
    expect(() => parse(hufEurJson.replace('"from": "HUF"', '"from": "EUR"'))).toThrow(
      "WRONG_CURRENCY_DIRECTION",
    );
  });

  it("rejects zero recipient, implausible rates and inconsistent amounts", () => {
    expect(() => parse(hufEurJson.replace('"amount": 277.43', '"amount": 0'))).toThrow(
      "INVALID_RECIPIENT_AMOUNT",
    );
    expect(() => parse(hufEurJson.replace("0.0027743132467174", "0.5"))).toThrow(
      "IMPLAUSIBLE_RATE",
    );
    expect(() => parse(hufEurJson.replace('"amount": 277.43', '"amount": 200'))).toThrow(
      "INCONSISTENT_SENDER_RECIPIENT_RATE",
    );
  });

  it("rejects inconsistent fee currency, total and source-side cost", () => {
    expect(() =>
      parse(
        hufEurJson.replace(
          '"fx": { "amount": 0, "currency": "HUF" }',
          '"fx": { "amount": 1, "currency": "EUR" }',
        ),
      ),
    ).toThrow("INCONSISTENT_FEE_CURRENCY");
    expect(() =>
      parse(
        hufEurJson.replace(
          '"cost": { "amount": 100000, "currency": "HUF" }',
          '"cost": { "amount": 100001, "currency": "HUF" }',
        ),
      ),
    ).toThrow("INCONSISTENT_TOTAL_SOURCE_COST");
  });

  it("rejects stale and implausibly future timestamps", () => {
    expect(() =>
      parseRevolutQuoteResponse({
        payload: payload(),
        request: hufRequest,
        retrievedAt: new Date(hufTimestamp + 16 * 60_000),
        sourceUrl: "https://www.revolut.com/api/exchange/quote",
      }),
    ).toThrow("STALE_SOURCE_QUOTE");
    expect(() =>
      parseRevolutQuoteResponse({
        payload: payload(),
        request: hufRequest,
        retrievedAt: new Date(hufTimestamp - 3 * 60_000),
        sourceUrl: "https://www.revolut.com/api/exchange/quote",
      }),
    ).toThrow("FUTURE_SOURCE_QUOTE");
    expect(() =>
      parse(hufEurJson.replace('"timestamp": 1783958571976', '"timestamp": 8640000000000001')),
    ).toThrow("INVALID_TIMESTAMP");
  });
});

describe("RevolutPublicQuoteClient", () => {
  it("sends only the allowlisted query and non-deceptive JSON headers", async () => {
    const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(async () =>
      response(),
    );
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
    });

    await client.getQuote(hufRequest);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://www.revolut.com/api/exchange/quote?amount=100000&country=HU&fromCurrency=HUF&isRecipientAmount=false&toCurrency=EUR",
    );
    expect(init?.headers).toEqual({
      Accept: "application/json",
      "Accept-Language": "hu",
      "User-Agent": revolutQuoteClientConfig.userAgent,
    });
    const requestHeaders = new Headers(init?.headers);
    expect(requestHeaders.get("Accept-Language")).toBe("hu");
    expect(requestHeaders.has("Cookie")).toBe(false);
    expect(requestHeaders.has("Authorization")).toBe(false);
    expect(new URL(String(url)).searchParams.has("localeCode")).toBe(false);
    expect(init?.credentials).toBeUndefined();
  });

  it("applies a strict timeout with bounded retries", async () => {
    const fetcher = vi.fn(async () => new Promise<Response>(() => undefined));
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
      timeoutMs: 2,
      sleep: async () => Promise.resolve(),
    });

    await expect(client.getQuote(hufRequest)).rejects.toThrow("REQUEST_TIMEOUT");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("retries transient failures and succeeds", async () => {
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response("temporarily unavailable", { status: 500 }))
      .mockResolvedValueOnce(response());
    const sleep = vi.fn(async () => Promise.resolve());
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
      sleep,
    });

    await expect(client.getQuote(hufRequest)).resolves.toMatchObject({ freshness: "FRESH" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it.each([429, 500])("retries HTTP %s and then fails closed", async (status) => {
    const fetcher = vi.fn(async () => response("unavailable", { status }));
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
      sleep: async () => Promise.resolve(),
    });

    await expect(client.getQuote(hufRequest)).rejects.toThrow(`HTTP_${status}`);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not retry HTTP 403", async () => {
    const fetcher = vi.fn(async () => response("forbidden", { status: 403 }));
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
      sleep: async () => Promise.resolve(),
    });

    await expect(client.getQuote(hufRequest)).rejects.toThrow("HTTP_403");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects HTML and malformed content types before JSON parsing", async () => {
    const htmlClient = new RevolutPublicQuoteClient({
      fetch: async () => response("<html>challenge</html>", { contentType: "text/html" }),
      now: () => hufObservedAt,
    });
    await expect(htmlClient.getQuote(hufRequest)).rejects.toThrow("UNEXPECTED_CONTENT_TYPE");

    const textClient = new RevolutPublicQuoteClient({
      fetch: async () => response(hufEurJson, { contentType: "text/plain" }),
      now: () => hufObservedAt,
    });
    await expect(textClient.getQuote(hufRequest)).rejects.toThrow("UNEXPECTED_CONTENT_TYPE");

    const malformedJsonClient = new RevolutPublicQuoteClient({
      fetch: async () => response('{"sender":'),
      now: () => hufObservedAt,
    });
    await expect(malformedJsonClient.getQuote(hufRequest)).rejects.toThrow("MALFORMED_JSON");
  });

  it("rejects redirects and oversized downloaded responses", async () => {
    const redirected = response();
    Object.defineProperty(redirected, "url", { value: "https://www.revolut.com/challenge" });
    const redirectClient = new RevolutPublicQuoteClient({
      fetch: async () => redirected,
      now: () => hufObservedAt,
    });
    await expect(redirectClient.getQuote(hufRequest)).rejects.toThrow("UNEXPECTED_RESPONSE_URL");

    const oversized = JSON.stringify({
      value: "x".repeat(revolutQuoteClientConfig.maximumJsonBytes),
    });
    const sizeClient = new RevolutPublicQuoteClient({
      fetch: async () => response(oversized),
      now: () => hufObservedAt,
    });
    await expect(sizeClient.getQuote(hufRequest)).rejects.toThrow("RESPONSE_TOO_LARGE");
  });

  it("serves a fresh amount-and-plan-specific cache entry", async () => {
    const fetcher = vi.fn(async () => response());
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
    });

    await client.getQuote(hufRequest);
    await client.getQuote(hufRequest);
    await client.getQuote({ ...hufRequest, plan: "PLUS" });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never reuses a cached quote for another source amount", async () => {
    const doubledJson = hufEurJson
      .replaceAll("100000", "200000")
      .replace('"amount": 277.43', '"amount": 554.86');
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response(doubledJson));
    const client = new RevolutPublicQuoteClient({ fetch: fetcher, now: () => hufObservedAt });

    await client.getQuote(hufRequest);
    const doubled = await client.getQuote({ ...hufRequest, sourceAmount: "200000" });

    expect(doubled.targetAmount).toBe("554.86");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("negative-caches failure without retrying another request", async () => {
    const fetcher = vi.fn(async () => response("forbidden", { status: 403 }));
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
    });

    await expect(client.getQuote(hufRequest)).rejects.toThrow("HTTP_403");
    await expect(client.getQuote(hufRequest)).rejects.toThrow("HTTP_403");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("returns only the last successful quote as STALE after refresh failure", async () => {
    let nowMs = hufObservedAt.getTime();
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response())
      .mockResolvedValue(response("forbidden", { status: 403 }));
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => new Date(nowMs),
    });

    const fresh = await client.getQuote(hufRequest);
    nowMs += 61_000;
    const stale = await client.getQuote(hufRequest);

    expect(stale).toMatchObject({
      targetAmount: fresh.targetAmount,
      rateTimestamp: fresh.rateTimestamp,
      retrievedAt: fresh.retrievedAt,
      freshness: "STALE",
    });
  });

  it("does not return a cached observation beyond the stale policy", async () => {
    let nowMs = hufObservedAt.getTime();
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(response())
      .mockResolvedValue(response("forbidden", { status: 403 }));
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => new Date(nowMs),
    });

    await client.getQuote(hufRequest);
    nowMs = hufTimestamp + revolutQuoteClientConfig.staleCacheMs + 1;

    await expect(client.getQuote(hufRequest)).rejects.toThrow("HTTP_403");
  });

  it("honors a caller abort without returning a cached or numeric fallback", async () => {
    const controller = new AbortController();
    const client = new RevolutPublicQuoteClient({
      fetch: async () => new Promise<Response>(() => undefined),
      now: () => hufObservedAt,
      sleep: async () => Promise.resolve(),
    });

    const pending = client.getQuote(hufRequest, controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow("REQUEST_ABORTED");
  });

  it("deduplicates concurrent calls for the same amount and plan", async () => {
    let resolveFetch: ((value: Response) => void) | undefined;
    const fetcher = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const client = new RevolutPublicQuoteClient({
      fetch: fetcher,
      now: () => hufObservedAt,
    });

    const first = client.getQuote(hufRequest);
    const second = client.getQuote(hufRequest);
    expect(fetcher).toHaveBeenCalledOnce();
    resolveFetch?.(response());

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
