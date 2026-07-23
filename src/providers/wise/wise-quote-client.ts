import { decimal, decimalToPlainString } from "@/domain/decimal";
import type { SupportedCurrencyCode } from "@/domain/quote";
import { buildWiseComparisonUrl, wiseQuoteClientConfig } from "@/providers/wise/wise-config";
import {
  parseWiseComparisonResponse,
  WiseComparisonParseError,
} from "@/providers/wise/wise-comparison-parser";

export type WiseQuoteClientErrorCode =
  | "TIMEOUT"
  | "REQUEST_ABORTED"
  | "NETWORK_ERROR"
  | "HTTP_403"
  | "HTTP_429"
  | "HTTP_ERROR"
  | "REDIRECT"
  | "INVALID_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_RESPONSE";

export class WiseQuoteClientError extends Error {
  constructor(
    readonly code: WiseQuoteClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WiseQuoteClientError";
  }
}

export type WiseQuoteObservation = Readonly<{
  sourceAmount: string;
  targetAmount: string;
  fee: string;
  rate: string;
  effectiveRate: string;
  markup: string;
  isConsideredMidMarketRate: boolean;
  rateTimestamp: string;
  retrievedAt: string;
  sourceUrl: string;
  freshness: "FRESH" | "STALE";
}>;

export interface WiseQuoteClient {
  getQuote(
    input: Readonly<{
      sourceCurrency: SupportedCurrencyCode;
      targetCurrency: SupportedCurrencyCode;
      sourceAmount: string;
    }>,
    signal?: AbortSignal,
  ): Promise<WiseQuoteObservation>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type WisePublicQuoteClientDependencies = Readonly<{
  fetcher?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  maximumJsonBytes?: number;
  freshCacheMs?: number;
  negativeCacheMs?: number;
  staleCacheMs?: number;
}>;

type CachedObservation = Omit<WiseQuoteObservation, "freshness">;
type CachedFailure = Readonly<{ error: WiseQuoteClientError; expiresAt: number }>;

function canonicalAmount(sourceAmount: string): string {
  try {
    const amount = decimal(sourceAmount);
    if (!amount.greaterThan(0)) throw new TypeError("Non-positive amount");
    return decimalToPlainString(amount);
  } catch {
    throw new WiseQuoteClientError("INVALID_RESPONSE", "Invalid source amount.");
  }
}

function toClientError(error: unknown): WiseQuoteClientError {
  if (error instanceof WiseQuoteClientError) return error;
  if (error instanceof WiseComparisonParseError) {
    return new WiseQuoteClientError("INVALID_RESPONSE", error.code);
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new WiseQuoteClientError("REQUEST_ABORTED", "Wise request was aborted.");
  }
  return new WiseQuoteClientError("NETWORK_ERROR", "Wise request failed.");
}

function mergeAbortSignals(
  externalSignal: AbortSignal | undefined,
  timeoutMs: number,
): Readonly<{ signal: AbortSignal; cleanup: () => void; didTimeout: () => boolean }> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromExternal = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromExternal();
  else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    },
  };
}

export class WisePublicQuoteClient implements WiseQuoteClient {
  readonly #fetcher: FetchLike;
  readonly #now: () => Date;
  readonly #timeoutMs: number;
  readonly #maximumJsonBytes: number;
  readonly #freshCacheMs: number;
  readonly #negativeCacheMs: number;
  readonly #staleCacheMs: number;
  readonly #successCache = new Map<string, CachedObservation>();
  readonly #failureCache = new Map<string, CachedFailure>();
  readonly #inFlight = new Map<string, Promise<WiseQuoteObservation>>();

  constructor(dependencies: WisePublicQuoteClientDependencies = {}) {
    this.#fetcher = dependencies.fetcher ?? fetch;
    this.#now = dependencies.now ?? (() => new Date());
    this.#timeoutMs = dependencies.timeoutMs ?? wiseQuoteClientConfig.timeoutMs;
    this.#maximumJsonBytes =
      dependencies.maximumJsonBytes ?? wiseQuoteClientConfig.maximumJsonBytes;
    this.#freshCacheMs = dependencies.freshCacheMs ?? wiseQuoteClientConfig.freshCacheMs;
    this.#negativeCacheMs = dependencies.negativeCacheMs ?? wiseQuoteClientConfig.negativeCacheMs;
    this.#staleCacheMs = dependencies.staleCacheMs ?? wiseQuoteClientConfig.staleCacheMs;
  }

  async getQuote(
    input: Readonly<{
      sourceCurrency: SupportedCurrencyCode;
      targetCurrency: SupportedCurrencyCode;
      sourceAmount: string;
    }>,
    signal?: AbortSignal,
  ): Promise<WiseQuoteObservation> {
    const amount = canonicalAmount(input.sourceAmount);
    const sourceUrl = buildWiseComparisonUrl({ ...input, sourceAmount: amount });
    const cacheKey = `${input.sourceCurrency}:${input.targetCurrency}:${amount}:HU`;
    const nowMs = this.#now().getTime();
    const cached = this.#successCache.get(cacheKey);
    if (cached !== undefined && nowMs - Date.parse(cached.retrievedAt) <= this.#freshCacheMs) {
      return { ...cached, freshness: "FRESH" };
    }
    const cachedFailure = this.#failureCache.get(cacheKey);
    if (cachedFailure !== undefined && cachedFailure.expiresAt > nowMs) {
      if (cached !== undefined && nowMs - Date.parse(cached.retrievedAt) <= this.#staleCacheMs) {
        return { ...cached, freshness: "STALE" };
      }
      throw cachedFailure.error;
    }

    const existing = this.#inFlight.get(cacheKey);
    if (existing !== undefined) return existing;

    const refresh = this.#fetchAndParse({ ...input, sourceAmount: amount, sourceUrl }, signal).then(
      (observation) => {
        const stored: CachedObservation = { ...observation };
        this.#successCache.set(cacheKey, stored);
        this.#failureCache.delete(cacheKey);
        return { ...stored, freshness: "FRESH" as const };
      },
      (error: unknown) => {
        const clientError = toClientError(error);
        this.#failureCache.set(cacheKey, {
          error: clientError,
          expiresAt: this.#now().getTime() + this.#negativeCacheMs,
        });
        const lastSuccess = this.#successCache.get(cacheKey);
        if (
          lastSuccess !== undefined &&
          this.#now().getTime() - Date.parse(lastSuccess.retrievedAt) <= this.#staleCacheMs
        ) {
          return { ...lastSuccess, freshness: "STALE" as const };
        }
        throw clientError;
      },
    );
    this.#inFlight.set(cacheKey, refresh);
    try {
      return await refresh;
    } finally {
      this.#inFlight.delete(cacheKey);
    }
  }

  async #fetchAndParse(
    input: Readonly<{
      sourceCurrency: SupportedCurrencyCode;
      targetCurrency: SupportedCurrencyCode;
      sourceAmount: string;
      sourceUrl: string;
    }>,
    externalSignal?: AbortSignal,
  ): Promise<CachedObservation> {
    const abort = mergeAbortSignals(externalSignal, this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetcher(input.sourceUrl, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": wiseQuoteClientConfig.userAgent,
        },
        redirect: "manual",
        signal: abort.signal,
      });
    } catch (error) {
      if (abort.didTimeout()) {
        throw new WiseQuoteClientError("TIMEOUT", "Wise request exceeded its timeout.");
      }
      throw toClientError(error);
    } finally {
      abort.cleanup();
    }

    if (response.status >= 300 && response.status < 400) {
      throw new WiseQuoteClientError("REDIRECT", "Wise returned an unexpected redirect.");
    }
    if (response.status === 403) {
      throw new WiseQuoteClientError("HTTP_403", "Wise returned HTTP 403.");
    }
    if (response.status === 429) {
      throw new WiseQuoteClientError("HTTP_429", "Wise returned HTTP 429.");
    }
    if (!response.ok) {
      throw new WiseQuoteClientError("HTTP_ERROR", `Wise returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("application/json")) {
      throw new WiseQuoteClientError("INVALID_CONTENT_TYPE", "Wise returned a non-JSON response.");
    }
    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      /^\d+$/.test(declaredLength) &&
      Number(declaredLength) > this.#maximumJsonBytes
    ) {
      throw new WiseQuoteClientError(
        "RESPONSE_TOO_LARGE",
        "Wise response exceeded the size limit.",
      );
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > this.#maximumJsonBytes) {
      throw new WiseQuoteClientError(
        "RESPONSE_TOO_LARGE",
        "Wise response exceeded the size limit.",
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new WiseQuoteClientError("INVALID_JSON", "Wise returned invalid JSON.");
    }
    const retrievedAt = this.#now();
    let evidence;
    try {
      evidence = parseWiseComparisonResponse({
        observedAt: retrievedAt,
        payload,
        request: {
          sendAmount: input.sourceAmount,
          sourceCountry: wiseQuoteClientConfig.sourceCountry,
          sourceCurrency: input.sourceCurrency,
          targetCurrency: input.targetCurrency,
        },
      });
    } catch (error) {
      throw toClientError(error);
    }
    return {
      sourceAmount: evidence.amount,
      targetAmount: evidence.receivedAmount,
      fee: evidence.fee,
      rate: evidence.rate,
      effectiveRate: evidence.effectiveRate,
      markup: evidence.markup,
      isConsideredMidMarketRate: evidence.isConsideredMidMarketRate,
      rateTimestamp: evidence.dateCollected,
      retrievedAt: retrievedAt.toISOString(),
      sourceUrl: input.sourceUrl,
    };
  }
}
