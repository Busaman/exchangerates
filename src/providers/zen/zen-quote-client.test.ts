import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatZenSourceAmount,
  selectZenResponseHeaders,
  ZenPublicQuoteClient,
  ZenQuoteClientError,
  type ZenQuoteTransport,
} from "@/providers/zen/zen-quote-client";

const fixture = readFileSync(new URL("./fixtures/huf-eur-1000.json", import.meta.url), "utf8");
const fixedNow = new Date("2026-07-17T10:00:00.000Z");

function jsonResponse(body = fixture, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=UTF-8" },
  });
}

function payload(): Record<string, unknown> {
  return JSON.parse(fixture) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ZenPublicQuoteClient", () => {
  it("posts the exact source-driven form and validates the primary exchangeRate", async () => {
    let capturedRequest;
    const transport: ZenQuoteTransport = async (request) => {
      capturedRequest = request;
      return jsonResponse();
    };
    const client = new ZenPublicQuoteClient({ transport, now: () => fixedNow });

    await expect(
      client.getQuote({
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "1000",
      }),
    ).resolves.toEqual({
      sourceAmount: "1000",
      targetAmount: "2.74",
      exchangeRate: "0.002749",
      retrievedAt: fixedNow.toISOString(),
      sourceUrl: "https://www.zen.com/landing_currencies.php",
      freshness: "FRESH",
    });
    expect(capturedRequest).toMatchObject({
      method: "POST",
      body: "action=change_currency&sourceCurrency=HUF&targetCurrency=EUR&amount=1000.00&endpoint=change_currency",
      headers: {
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "hu-HU,hu;q=0.9",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Origin: "https://www.zen.com",
        Referer: "https://www.zen.com/hu/online-valutavalto/",
        "User-Agent": "NeoRate server-side ZEN provider adapter",
        "X-Requested-With": "XMLHttpRequest",
      },
      maximumResponseBytes: 64 * 1024,
    });
    expect(capturedRequest).not.toHaveProperty("headers.Cookie");
    expect(capturedRequest).not.toHaveProperty("headers.Authorization");
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not-a-rate"],
    ["zero", "0"],
    ["negative", "-0.002749"],
  ])("fails closed for a %s exchangeRate", async (_label, exchangeRate) => {
    const raw = payload();
    const data = raw.data as Record<string, unknown>;
    if (exchangeRate === undefined) delete data.exchangeRate;
    else data.exchangeRate = exchangeRate;
    const client = new ZenPublicQuoteClient({
      transport: async () => jsonResponse(JSON.stringify(raw)),
    });

    await expect(
      client.getQuote({ sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000" }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("classifies malformed JSON without exposing placeholder data", async () => {
    const client = new ZenPublicQuoteClient({
      transport: async () => jsonResponse("{not-json"),
    });

    await expect(
      client.getQuote({ sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000" }),
    ).rejects.toMatchObject({ code: "INVALID_JSON" });
  });

  it("classifies HTTP 403", async () => {
    const client = new ZenPublicQuoteClient({
      transport: async () => jsonResponse("{}", 403),
    });

    await expect(
      client.getQuote({ sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000" }),
    ).rejects.toMatchObject({ code: "HTTP_403" });
  });

  it("classifies HTTP 429", async () => {
    const client = new ZenPublicQuoteClient({ transport: async () => jsonResponse("{}", 429) });
    await expect(
      client.getQuote({ sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000" }),
    ).rejects.toMatchObject({ code: "HTTP_429" });
  });

  it("rejects challenge HTML, redirects and oversized response bodies", async () => {
    const challenge = new ZenPublicQuoteClient({
      transport: async () =>
        new Response("<html>Just a moment</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    });
    const redirected = new ZenPublicQuoteClient({
      transport: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://www.zen.com/challenge" },
        }),
    });
    const oversized = new ZenPublicQuoteClient({
      maximumResponseBytes: 10,
      transport: async () =>
        new Response(fixture, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const input = {
      sourceCurrency: "HUF" as const,
      targetCurrency: "EUR" as const,
      sourceAmount: "1000",
    };

    await expect(challenge.getQuote(input)).rejects.toMatchObject({ code: "INVALID_CONTENT_TYPE" });
    await expect(redirected.getQuote(input)).rejects.toMatchObject({ code: "HTTP_ERROR" });
    await expect(oversized.getQuote(input)).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("drops every response cookie, including cf_clearance and bot-management cookies", () => {
    const headers = selectZenResponseHeaders({
      "content-type": "application/json; charset=UTF-8",
      "content-length": "42",
      "set-cookie": [
        "cf_clearance=synthetic-clearance; Secure",
        "__cf_bm=synthetic-bot-cookie; Secure",
        "PHPSESSID=synthetic-session; HttpOnly",
      ],
    });

    expect(headers.get("content-type")).toBe("application/json; charset=UTF-8");
    expect(headers.get("content-length")).toBe("42");
    expect(headers.has("set-cookie")).toBe(false);
  });

  it("uses fresh cache and single-flight only for the identical canonical amount", async () => {
    let calls = 0;
    let release: ((response: Response) => void) | undefined;
    const transport: ZenQuoteTransport = async () => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    };
    const client = new ZenPublicQuoteClient({ transport, now: () => fixedNow });
    const first = client.getQuote({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "1000",
    });
    const joined = client.getQuote({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "1000.00",
    });
    await vi.waitFor(() => expect(calls).toBe(1));
    release?.(jsonResponse());
    await expect(Promise.all([first, joined])).resolves.toHaveLength(2);
    await client.getQuote({ sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000" });
    expect(calls).toBe(1);
  });

  it("returns last-known-good only as STALE and negative-caches refresh failure", async () => {
    let now = fixedNow;
    let calls = 0;
    const client = new ZenPublicQuoteClient({
      now: () => now,
      freshCacheMs: 60_000,
      negativeCacheMs: 30_000,
      staleCacheMs: 900_000,
      transport: async () => {
        calls += 1;
        return calls === 1 ? jsonResponse() : jsonResponse("{}", 403);
      },
    });
    const input = {
      sourceCurrency: "HUF" as const,
      targetCurrency: "EUR" as const,
      sourceAmount: "1000",
    };
    await expect(client.getQuote(input)).resolves.toMatchObject({ freshness: "FRESH" });
    now = new Date(fixedNow.getTime() + 61_000);
    await expect(client.getQuote(input)).resolves.toMatchObject({ freshness: "STALE" });
    await expect(client.getQuote(input)).resolves.toMatchObject({ freshness: "STALE" });
    expect(calls).toBe(2);
  });

  it("aborts at the strict client timeout", async () => {
    vi.useFakeTimers();
    const transport: ZenQuoteTransport = async () => new Promise<Response>(() => undefined);
    const client = new ZenPublicQuoteClient({ transport, timeoutMs: 25 });
    const pending = client.getQuote({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "1000",
    });
    const rejection = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

    await vi.advanceTimersByTimeAsync(25);
    await rejection;
  });

  it("requires exact two-decimal representability without floating point", () => {
    expect(formatZenSourceAmount("1000")).toBe("1000.00");
    expect(formatZenSourceAmount("965.01")).toBe("965.01");
    expect(() => formatZenSourceAmount("965.001")).toThrow(ZenQuoteClientError);
  });
});
