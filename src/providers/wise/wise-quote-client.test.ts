import { describe, expect, it, vi } from "vitest";
import eurHufFixture from "@/providers/wise/fixtures/eur-huf-comparison.json";
import hufEurFixture from "@/providers/wise/fixtures/huf-eur-comparison.json";
import { WisePublicQuoteClient, WiseQuoteClientError } from "@/providers/wise/wise-quote-client";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("WisePublicQuoteClient", () => {
  it("retrieves and validates HUF to EUR using only ordinary server headers", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      expect(headers.get("Accept")).toBe("application/json");
      expect(headers.get("User-Agent")).toContain("NeoRate");
      expect(headers.has("Cookie")).toBe(false);
      expect(headers.has("Authorization")).toBe(false);
      return jsonResponse(hufEurFixture);
    });
    const client = new WisePublicQuoteClient({
      fetcher,
      now: () => new Date("2026-07-16T18:44:00Z"),
    });

    const result = await client.getQuote({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "998877",
    });

    expect(result).toMatchObject({
      sourceAmount: "998877",
      targetAmount: "2721.46",
      fee: "14537",
      rate: "0.00276476",
      freshness: "FRESH",
    });
    const requestedUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(Object.fromEntries(requestedUrl.searchParams)).toMatchObject({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sendAmount: "998877",
      sourceCountry: "HU",
      filter: "POPULAR",
      includeWise: "true",
      numberOfProviders: "3",
    });
  });

  it("retrieves and validates EUR to HUF without duplicating the endpoint fee", async () => {
    const client = new WisePublicQuoteClient({
      fetcher: async () => jsonResponse(eurHufFixture),
      now: () => new Date("2026-07-16T21:17:00Z"),
    });

    await expect(
      client.getQuote({
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
      }),
    ).resolves.toMatchObject({
      sourceAmount: "1000",
      targetAmount: "356332",
      fee: "16.01",
      effectiveRate: "356.332",
    });
  });

  it("fails closed when HTTP 200 omits Wise or uses a non-exact alias", async () => {
    for (const providers of [[], [{ ...hufEurFixture.providers[0], alias: "Wise" }]] as const) {
      const client = new WisePublicQuoteClient({
        fetcher: async () => jsonResponse({ ...hufEurFixture, providers }),
        now: () => new Date("2026-07-16T18:44:00Z"),
      });
      await expect(
        client.getQuote({
          sourceCurrency: "HUF",
          targetCurrency: "EUR",
          sourceAmount: "998877",
        }),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it.each([
    [403, "HTTP_403"],
    [429, "HTTP_429"],
    [500, "HTTP_ERROR"],
  ] as const)("classifies HTTP %i fail closed", async (status, code) => {
    const client = new WisePublicQuoteClient({
      fetcher: async () => jsonResponse({ error: true }, status),
      now: () => new Date("2026-07-16T18:44:00Z"),
    });
    await expect(
      client.getQuote({
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "998877",
      }),
    ).rejects.toMatchObject({ code });
  });

  it("rejects malformed JSON, wrong content types and oversized bodies", async () => {
    const cases = [
      new Response("{", { headers: { "Content-Type": "application/json" } }),
      new Response("<html>challenge</html>", { headers: { "Content-Type": "text/html" } }),
      new Response(JSON.stringify(hufEurFixture), {
        headers: { "Content-Type": "application/json", "Content-Length": "999999" },
      }),
    ];
    for (const response of cases) {
      const client = new WisePublicQuoteClient({
        fetcher: async () => response,
        now: () => new Date("2026-07-16T18:44:00Z"),
        maximumJsonBytes: 1024,
      });
      await expect(
        client.getQuote({
          sourceCurrency: "HUF",
          targetCurrency: "EUR",
          sourceAmount: "998877",
        }),
      ).rejects.toBeInstanceOf(WiseQuoteClientError);
    }
  });

  it("times out an abort-aware request", async () => {
    vi.useFakeTimers();
    const client = new WisePublicQuoteClient({
      fetcher: async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        }),
      now: () => new Date("2026-07-16T18:44:00Z"),
      timeoutMs: 10,
    });
    const promise = client.getQuote({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "998877",
    });
    const expectation = expect(promise).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(11);
    await expectation;
    vi.useRealTimers();
  });

  it("uses exact canonical amount cache keys and single-flight only for identical requests", async () => {
    const fetcher = vi.fn(async () => jsonResponse(eurHufFixture));
    const client = new WisePublicQuoteClient({
      fetcher,
      now: () => new Date("2026-07-16T21:17:00Z"),
    });
    const input = {
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
    } as const;

    const [first, second] = await Promise.all([
      client.getQuote(input),
      client.getQuote({ ...input, sourceAmount: "1000.00" }),
    ]);
    expect(first).toEqual(second);
    expect(fetcher).toHaveBeenCalledOnce();

    const adjacentFixture = { ...eurHufFixture, amount: 1001 };
    const adjacentQuote = adjacentFixture.providers[0]?.quotes[0];
    if (adjacentQuote === undefined) throw new Error("Invalid fixture");
    adjacentFixture.providers = [
      {
        ...adjacentFixture.providers[0],
        quotes: [
          {
            ...adjacentQuote,
            fee: 16.01,
            receivedAmount: 356694,
          },
        ],
      },
    ];
    fetcher.mockResolvedValueOnce(jsonResponse(adjacentFixture));
    await client.getQuote({ ...input, sourceAmount: "1001" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("serves a last-known-good observation only as stale after a failed refresh", async () => {
    let now = new Date("2026-07-16T18:44:00Z");
    const fetcher = vi
      .fn<(url: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(jsonResponse(hufEurFixture))
      .mockResolvedValueOnce(jsonResponse({ error: true }, 500));
    const client = new WisePublicQuoteClient({
      fetcher,
      now: () => now,
      freshCacheMs: 1_000,
      negativeCacheMs: 30_000,
      staleCacheMs: 15 * 60_000,
    });
    const input = {
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "998877",
    } as const;
    await expect(client.getQuote(input)).resolves.toMatchObject({ freshness: "FRESH" });
    now = new Date("2026-07-16T18:44:02Z");
    await expect(client.getQuote(input)).resolves.toMatchObject({ freshness: "STALE" });
    await expect(client.getQuote(input)).resolves.toMatchObject({ freshness: "STALE" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
