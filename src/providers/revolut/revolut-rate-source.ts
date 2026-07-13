import {
  revolutRateSourceConfig,
  revolutSourceUrls,
  type RevolutPairKey,
} from "@/providers/revolut/revolut-config";
import {
  parseRevolutPublicPage,
  type ParsedRevolutRate,
} from "@/providers/revolut/revolut-page-parser";

export type RevolutRateObservation = ParsedRevolutRate &
  Readonly<{
    retrievedAt: string;
    sourceUrl: string;
    freshness: "FRESH" | "STALE";
  }>;

export interface RevolutRateSource {
  getRate(pair: RevolutPairKey, signal?: AbortSignal): Promise<RevolutRateObservation>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export type RevolutPublicPageRateSourceDependencies = Readonly<{
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: Sleep;
  timeoutMs?: number;
  freshCacheMs?: number;
  staleCacheMs?: number;
}>;

type CachedObservation = Omit<RevolutRateObservation, "freshness">;

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("Request aborted"));
      return;
    }
    const abort = () => {
      clearTimeout(timeoutId);
      reject(new Error("Request aborted"));
    };
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function fetchWithTimeout({
  fetcher,
  url,
  parentSignal,
  timeoutMs,
}: {
  fetcher: FetchLike;
  url: string;
  parentSignal?: AbortSignal;
  timeoutMs: number;
}): Promise<Response> {
  if (parentSignal?.aborted === true) throw new Error("Request aborted");
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(new Error("Revolut public page request timed out"));
      }, timeoutMs);
    });
    return await Promise.race([
      fetcher(url, {
        method: "GET",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.7",
          "User-Agent": revolutRateSourceConfig.userAgent,
        },
        redirect: "follow",
        signal: controller.signal,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export class RevolutPublicPageRateSource implements RevolutRateSource {
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  readonly #sleep: Sleep;
  readonly #timeoutMs: number;
  readonly #freshCacheMs: number;
  readonly #staleCacheMs: number;
  readonly #cache = new Map<RevolutPairKey, CachedObservation>();

  constructor(dependencies: RevolutPublicPageRateSourceDependencies = {}) {
    this.#fetch = dependencies.fetch ?? fetch;
    this.#now = dependencies.now ?? (() => new Date());
    this.#sleep = dependencies.sleep ?? defaultSleep;
    this.#timeoutMs = dependencies.timeoutMs ?? revolutRateSourceConfig.timeoutMs;
    this.#freshCacheMs = dependencies.freshCacheMs ?? revolutRateSourceConfig.freshCacheMs;
    this.#staleCacheMs = dependencies.staleCacheMs ?? revolutRateSourceConfig.staleCacheMs;
  }

  async getRate(pair: RevolutPairKey, signal?: AbortSignal): Promise<RevolutRateObservation> {
    const requestTime = this.#now();
    const cached = this.#cache.get(pair);
    if (cached !== undefined) {
      const cacheAge = requestTime.getTime() - Date.parse(cached.retrievedAt);
      const sourceAge = requestTime.getTime() - Date.parse(cached.rateTimestamp);
      if (
        cacheAge <= this.#freshCacheMs &&
        sourceAge <= revolutRateSourceConfig.maximumSourceObservationAgeMs
      ) {
        return { ...cached, freshness: "FRESH" };
      }
    }

    let lastError: unknown;
    const sourceUrl = revolutSourceUrls[pair];
    const totalAttempts = revolutRateSourceConfig.retryBackoffMs.length + 1;
    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout({
          fetcher: this.#fetch,
          url: sourceUrl,
          parentSignal: signal,
          timeoutMs: this.#timeoutMs,
        });
        if (!response.ok) throw new Error(`Revolut public page returned HTTP ${response.status}`);
        if (response.url !== "" && response.url !== sourceUrl) {
          throw new Error("Revolut public page redirected to an unexpected URL");
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("text/html")) {
          throw new Error("Revolut public page returned an unexpected content type");
        }
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > revolutRateSourceConfig.maximumHtmlBytes) {
          throw new Error("Revolut public page exceeded the response size limit");
        }
        const html = await response.text();
        if (new TextEncoder().encode(html).byteLength > revolutRateSourceConfig.maximumHtmlBytes) {
          throw new Error("Revolut public page exceeded the response size limit");
        }
        const retrievedAt = this.#now();
        const parsed = parseRevolutPublicPage({ html, expectedPair: pair, now: retrievedAt });
        const observation: CachedObservation = {
          ...parsed,
          retrievedAt: retrievedAt.toISOString(),
          sourceUrl,
        };
        this.#cache.set(pair, observation);
        return { ...observation, freshness: "FRESH" };
      } catch (error) {
        lastError = error;
        if (signal?.aborted === true) break;
        const backoff = revolutRateSourceConfig.retryBackoffMs[attempt];
        if (backoff !== undefined) await this.#sleep(backoff, signal);
      }
    }

    if (signal?.aborted === true) {
      throw lastError instanceof Error ? lastError : new Error("Request aborted");
    }
    if (cached !== undefined) {
      const staleAge = this.#now().getTime() - Date.parse(cached.rateTimestamp);
      if (staleAge <= this.#staleCacheMs) return { ...cached, freshness: "STALE" };
    }
    throw lastError instanceof Error ? lastError : new Error("Revolut rate is unavailable");
  }
}
