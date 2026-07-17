import { z } from "zod";
import { currencyMinorUnit, decimal, decimalPattern, decimalToPlainString } from "@/domain/decimal";
import type { SupportedCurrencyCode } from "@/domain/quote";
import {
  zenQuoteEndpoint,
  zenFreshCacheMs,
  zenQuoteMaximumResponseBytes,
  zenNegativeCacheMs,
  zenStaleCacheMs,
  zenQuoteTimeoutMs,
} from "@/providers/zen/zen-config";

const zenDecimalSchema = z.string().regex(decimalPattern);
const zenPositiveDecimalSchema = zenDecimalSchema.refine(
  (value) => decimalPattern.test(value) && decimal(value).greaterThan(0),
);

const zenQuoteResponseSchema = z
  .object({
    data: z
      .object({
        sourceAmount: zenPositiveDecimalSchema,
        targetAmount: zenPositiveDecimalSchema,
        exchangeRate: zenPositiveDecimalSchema,
        alternatives: z.array(z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ZenQuoteClientErrorCode =
  | "UNREPRESENTABLE_SOURCE_AMOUNT"
  | "TIMEOUT"
  | "REQUEST_ABORTED"
  | "NETWORK_ERROR"
  | "HTTP_403"
  | "HTTP_429"
  | "HTTP_ERROR"
  | "INVALID_CONTENT_TYPE"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_RESPONSE"
  | "IMPLAUSIBLE_RATE"
  | "INCONSISTENT_RESPONSE";

export class ZenQuoteClientError extends Error {
  constructor(
    readonly code: ZenQuoteClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZenQuoteClientError";
  }
}

export type ZenTransportRequest = Readonly<{
  url: string;
  method: "POST";
  headers: Readonly<Record<string, string>>;
  body: string;
  signal: AbortSignal;
}>;

export type ZenQuoteTransport = (request: ZenTransportRequest) => Promise<Response>;

export const fetchZenQuoteTransport: ZenQuoteTransport = async (request) =>
  fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    cache: "no-store",
    redirect: "manual",
  });

export type ZenQuoteObservation = Readonly<{
  sourceAmount: string;
  targetAmount: string;
  exchangeRate: string;
  retrievedAt: string;
  sourceUrl: string;
  freshness: "FRESH" | "STALE";
}>;

export interface ZenQuoteClient {
  getQuote(
    input: Readonly<{
      sourceCurrency: SupportedCurrencyCode;
      targetCurrency: SupportedCurrencyCode;
      sourceAmount: string;
    }>,
    signal?: AbortSignal,
  ): Promise<ZenQuoteObservation>;
}

export type ZenPublicQuoteClientDependencies = Readonly<{
  transport?: ZenQuoteTransport;
  timeoutMs?: number;
  maximumResponseBytes?: number;
  now?: () => Date;
  freshCacheMs?: number;
  negativeCacheMs?: number;
  staleCacheMs?: number;
}>;

type CachedZenObservation = Omit<ZenQuoteObservation, "freshness">;
type CachedZenFailure = Readonly<{ error: ZenQuoteClientError; expiresAt: number }>;

export function formatZenSourceAmount(sourceAmount: string): string {
  let amount;
  try {
    amount = decimal(sourceAmount);
  } catch {
    throw new ZenQuoteClientError(
      "UNREPRESENTABLE_SOURCE_AMOUNT",
      "ZEN source amount must be a plain decimal value.",
    );
  }

  if (!decimalPattern.test(sourceAmount) || !amount.greaterThan(0)) {
    throw new ZenQuoteClientError(
      "UNREPRESENTABLE_SOURCE_AMOUNT",
      "ZEN source amount must be a positive plain decimal value.",
    );
  }
  if (!amount.toDecimalPlaces(2).equals(amount)) {
    throw new ZenQuoteClientError(
      "UNREPRESENTABLE_SOURCE_AMOUNT",
      "ZEN source amount must be exactly representable with at most two decimal places.",
    );
  }
  return amount.toFixed(2);
}

function buildZenRequestBody({
  sourceCurrency,
  targetCurrency,
  sourceAmount,
}: {
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
  sourceAmount: string;
}): string {
  return new URLSearchParams({
    action: "change_currency",
    sourceCurrency,
    targetCurrency,
    amount: formatZenSourceAmount(sourceAmount),
    endpoint: "change_currency",
  }).toString();
}

function assertPlausibleRate(
  rate: string,
  sourceCurrency: SupportedCurrencyCode,
  targetCurrency: SupportedCurrencyCode,
): void {
  const parsedRate = decimal(rate);
  const plausible =
    sourceCurrency === "HUF" && targetCurrency === "EUR"
      ? parsedRate.greaterThan("0.0001") && parsedRate.lessThan("0.1")
      : sourceCurrency === "EUR" && targetCurrency === "HUF"
        ? parsedRate.greaterThan(10) && parsedRate.lessThan(10_000)
        : false;
  if (!plausible) {
    throw new ZenQuoteClientError(
      "IMPLAUSIBLE_RATE",
      "ZEN returned a rate outside the supported pair guardrails.",
    );
  }
}

function assertConsistentResponse({
  sourceAmount,
  targetAmount,
  exchangeRate,
  requestedSourceAmount,
  sourceCurrency,
  targetCurrency,
}: {
  sourceAmount: string;
  targetAmount: string;
  exchangeRate: string;
  requestedSourceAmount: string;
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
}): void {
  if (!decimal(sourceAmount).equals(requestedSourceAmount)) {
    throw new ZenQuoteClientError(
      "INCONSISTENT_RESPONSE",
      "ZEN returned a source amount that differs from the request.",
    );
  }
  assertPlausibleRate(exchangeRate, sourceCurrency, targetCurrency);
  const expectedTarget = decimal(sourceAmount).times(exchangeRate);
  const difference = expectedTarget.minus(targetAmount).abs();
  if (difference.greaterThan(currencyMinorUnit[targetCurrency])) {
    throw new ZenQuoteClientError(
      "INCONSISTENT_RESPONSE",
      "ZEN target amount is inconsistent with the directional exchange rate.",
    );
  }
}

async function readValidatedJson(
  response: Response,
  maximumResponseBytes: number,
): Promise<unknown> {
  if (response.status === 403) {
    throw new ZenQuoteClientError(
      "HTTP_403",
      "ZEN rejected the server-side request with HTTP 403.",
    );
  }
  if (response.status === 429) {
    throw new ZenQuoteClientError("HTTP_429", "ZEN rate-limited the server-side request.");
  }
  if (!response.ok) {
    throw new ZenQuoteClientError("HTTP_ERROR", `ZEN returned HTTP ${response.status}.`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new ZenQuoteClientError("INVALID_CONTENT_TYPE", "ZEN did not return JSON content.");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maximumResponseBytes) {
    throw new ZenQuoteClientError("RESPONSE_TOO_LARGE", "ZEN response exceeded the size limit.");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new ZenQuoteClientError("RESPONSE_TOO_LARGE", "ZEN response exceeded the size limit.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ZenQuoteClientError("INVALID_JSON", "ZEN returned malformed JSON.");
  }
}

export class ZenPublicQuoteClient implements ZenQuoteClient {
  readonly #transport: ZenQuoteTransport;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;
  readonly #now: () => Date;
  readonly #freshCacheMs: number;
  readonly #negativeCacheMs: number;
  readonly #staleCacheMs: number;
  readonly #cache = new Map<string, CachedZenObservation>();
  readonly #failures = new Map<string, CachedZenFailure>();
  readonly #inFlight = new Map<string, Promise<ZenQuoteObservation>>();

  constructor(dependencies: ZenPublicQuoteClientDependencies = {}) {
    this.#transport = dependencies.transport ?? fetchZenQuoteTransport;
    this.#timeoutMs = dependencies.timeoutMs ?? zenQuoteTimeoutMs;
    this.#maximumResponseBytes = dependencies.maximumResponseBytes ?? zenQuoteMaximumResponseBytes;
    this.#now = dependencies.now ?? (() => new Date());
    this.#freshCacheMs = dependencies.freshCacheMs ?? zenFreshCacheMs;
    this.#negativeCacheMs = dependencies.negativeCacheMs ?? zenNegativeCacheMs;
    this.#staleCacheMs = dependencies.staleCacheMs ?? zenStaleCacheMs;
  }

  async getQuote(
    input: Readonly<{
      sourceCurrency: SupportedCurrencyCode;
      targetCurrency: SupportedCurrencyCode;
      sourceAmount: string;
    }>,
    externalSignal?: AbortSignal,
  ): Promise<ZenQuoteObservation> {
    const requestedSourceAmount = formatZenSourceAmount(input.sourceAmount);
    const key = `${input.sourceCurrency}-${input.targetCurrency}|${requestedSourceAmount}`;
    const requestTime = this.#now();
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      const age = requestTime.getTime() - Date.parse(cached.retrievedAt);
      if (age <= this.#freshCacheMs) return { ...cached, freshness: "FRESH" };
    }

    const cachedFailure = this.#failures.get(key);
    if (cachedFailure !== undefined && requestTime.getTime() < cachedFailure.expiresAt) {
      const stale = this.#staleObservation(cached, requestTime);
      if (stale !== undefined) return stale;
      throw cachedFailure.error;
    }
    if (cachedFailure !== undefined) this.#failures.delete(key);

    const existingRequest = this.#inFlight.get(key);
    if (existingRequest !== undefined) return existingRequest;
    const pending = this.#refresh(input, requestedSourceAmount, externalSignal);
    this.#inFlight.set(key, pending);
    try {
      const observation = await pending;
      const cachedObservation: CachedZenObservation = observation;
      this.#cache.set(key, cachedObservation);
      this.#failures.delete(key);
      return observation;
    } catch (error) {
      const publicError =
        error instanceof ZenQuoteClientError
          ? error
          : new ZenQuoteClientError("NETWORK_ERROR", "ZEN quote refresh failed.");
      this.#failures.set(key, {
        error: publicError,
        expiresAt: this.#now().getTime() + this.#negativeCacheMs,
      });
      const stale = this.#staleObservation(cached, this.#now());
      if (stale !== undefined) return stale;
      throw publicError;
    } finally {
      if (this.#inFlight.get(key) === pending) this.#inFlight.delete(key);
    }
  }

  #staleObservation(
    cached: CachedZenObservation | undefined,
    at: Date,
  ): ZenQuoteObservation | undefined {
    if (cached === undefined) return undefined;
    const age = at.getTime() - Date.parse(cached.retrievedAt);
    return age <= this.#staleCacheMs ? { ...cached, freshness: "STALE" } : undefined;
  }

  async #refresh(
    input: Readonly<{
      sourceCurrency: SupportedCurrencyCode;
      targetCurrency: SupportedCurrencyCode;
      sourceAmount: string;
    }>,
    requestedSourceAmount: string,
    externalSignal?: AbortSignal,
  ): Promise<ZenQuoteObservation> {
    const body = buildZenRequestBody({ ...input, sourceAmount: requestedSourceAmount });
    const controller = new AbortController();
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const abortPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        "abort",
        () =>
          reject(
            new ZenQuoteClientError(
              timedOut ? "TIMEOUT" : "REQUEST_ABORTED",
              timedOut ? "ZEN request timed out." : "ZEN request was aborted.",
            ),
          ),
        { once: true },
      );
    });

    let response: Response;
    try {
      response = await Promise.race([
        this.#transport({
          url: zenQuoteEndpoint,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "NeoRate server-side ZEN provider adapter",
          },
          body,
          signal: controller.signal,
        }),
        abortPromise,
      ]);
    } catch (error) {
      if (error instanceof ZenQuoteClientError) throw error;
      throw new ZenQuoteClientError(
        "NETWORK_ERROR",
        "ZEN request failed at the transport boundary.",
      );
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }

    const raw = await readValidatedJson(response, this.#maximumResponseBytes);
    const parsed = zenQuoteResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ZenQuoteClientError("INVALID_RESPONSE", "ZEN response failed schema validation.");
    }
    assertConsistentResponse({
      ...parsed.data.data,
      requestedSourceAmount,
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
    });
    const retrievedAt = this.#now().toISOString();
    return {
      sourceAmount: decimalToPlainString(parsed.data.data.sourceAmount),
      targetAmount: decimalToPlainString(parsed.data.data.targetAmount),
      exchangeRate: decimalToPlainString(parsed.data.data.exchangeRate),
      retrievedAt,
      sourceUrl: zenQuoteEndpoint,
      freshness: "FRESH",
    };
  }
}
