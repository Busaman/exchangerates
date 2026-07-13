import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { RevolutPublicPageRateSource } from "@/providers/revolut/revolut-rate-source";

const html = readFileSync(new URL("./fixtures/eur-huf.html", import.meta.url), "utf8");
const observationTimeMs = 1783951201280 + 60_000;

function okResponse(): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
}

describe("RevolutPublicPageRateSource", () => {
  it("applies a strict timeout", async () => {
    const source = new RevolutPublicPageRateSource({
      fetch: () => new Promise<Response>(() => undefined),
      now: () => new Date(observationTimeMs),
      timeoutMs: 2,
      sleep: async () => Promise.resolve(),
    });

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("timed out");
  });

  it("retries a transient failure with bounded backoff", async () => {
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(okResponse());
    const sleep = vi.fn(async () => Promise.resolve());
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(observationTimeMs),
      sleep,
    });

    await expect(source.getRate("EUR-HUF")).resolves.toMatchObject({ freshness: "FRESH" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh cache entry without another HTTP request", async () => {
    const fetcher = vi.fn(async () => okResponse());
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(observationTimeMs),
    });

    await source.getRate("EUR-HUF");
    const cached = await source.getRate("EUR-HUF");

    expect(cached.freshness).toBe("FRESH");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns only the last successful observation as STALE after refresh failure", async () => {
    let nowMs = observationTimeMs;
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValue(new Response("blocked", { status: 403 }));
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(nowMs),
      sleep: async () => Promise.resolve(),
    });

    const live = await source.getRate("EUR-HUF");
    nowMs += 61_000;
    const stale = await source.getRate("EUR-HUF");

    expect(stale).toMatchObject({ rate: live.rate, freshness: "STALE" });
  });

  it("does not substitute a fallback and rejects cache older than the stale interval", async () => {
    let nowMs = observationTimeMs;
    const fetcher = vi
      .fn<(input: string, init: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValue(new Response("blocked", { status: 403 }));
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(nowMs),
      sleep: async () => Promise.resolve(),
    });

    await source.getRate("EUR-HUF");
    nowMs += 16 * 60_000;

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("HTTP 403");
  });
});
