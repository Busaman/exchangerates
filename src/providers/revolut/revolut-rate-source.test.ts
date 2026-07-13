import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { revolutRateSourceConfig } from "@/providers/revolut/revolut-config";
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

  it("rejects HTTP 429 without substituting another rate", async () => {
    const fetcher = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(observationTimeMs),
      sleep: async () => Promise.resolve(),
    });

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("HTTP 429");
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("negative-caches a failed refresh for a short interval", async () => {
    const fetcher = vi.fn(async () => new Response("blocked", { status: 403 }));
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(observationTimeMs),
      sleep: async () => Promise.resolve(),
      negativeCacheMs: 30_000,
    });

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("HTTP 403");
    await expect(source.getRate("EUR-HUF")).rejects.toThrow("HTTP 403");

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("deduplicates concurrent refreshes for the same pair", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(
      async () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(observationTimeMs),
    });

    const first = source.getRate("EUR-HUF");
    const second = source.getRate("EUR-HUF");
    expect(fetcher).toHaveBeenCalledOnce();
    resolveFetch?.(okResponse());

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(fetcher).toHaveBeenCalledOnce();
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
    const cachedStale = await source.getRate("EUR-HUF");

    expect(stale).toMatchObject({ rate: live.rate, freshness: "STALE" });
    expect(cachedStale).toMatchObject({
      retrievedAt: live.retrievedAt,
      rateTimestamp: live.rateTimestamp,
      freshness: "STALE",
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
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

  it("rejects a downloaded body that exceeds the configured size limit", async () => {
    const oversizedHtml = `<html>${"x".repeat(revolutRateSourceConfig.maximumHtmlBytes)}</html>`;
    const source = new RevolutPublicPageRateSource({
      fetch: async () =>
        new Response(oversizedHtml, {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      now: () => new Date(observationTimeMs),
      sleep: async () => Promise.resolve(),
    });

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("response size limit");
  });

  it("rejects malformed content types", async () => {
    const source = new RevolutPublicPageRateSource({
      fetch: async () =>
        new Response(JSON.stringify({ rate: 400 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      now: () => new Date(observationTimeMs),
      sleep: async () => Promise.resolve(),
    });

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("unexpected content type");
  });

  it("rejects an unexpected redirect target", async () => {
    const redirected = okResponse();
    Object.defineProperty(redirected, "url", {
      value: "https://www.revolut.com/blocked/",
    });
    const source = new RevolutPublicPageRateSource({
      fetch: async () => redirected,
      now: () => new Date(observationTimeMs),
      sleep: async () => Promise.resolve(),
    });

    await expect(source.getRate("EUR-HUF")).rejects.toThrow("unexpected URL");
  });

  it("honors a caller abort without retrying", async () => {
    const fetcher = vi.fn(
      async (_input: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("fetch aborted by caller")),
            { once: true },
          );
        }),
    );
    const source = new RevolutPublicPageRateSource({
      fetch: fetcher,
      now: () => new Date(observationTimeMs),
      sleep: async () => Promise.resolve(),
    });
    const controller = new AbortController();

    const pending = source.getRate("EUR-HUF", controller.signal);
    controller.abort();

    await expect(pending).rejects.toThrow("fetch aborted by caller");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
