import { z } from "zod";
import { decimal, decimalToPlainString, isWithinCurrencyMinorUnit } from "@/domain/decimal";
import {
  revolutPersonalPlanSchema,
  supportedCurrencyCodeSchema,
  type RevolutPersonalPlan,
  type SupportedCurrencyCode,
} from "@/domain/quote";
import {
  buildRevolutQuoteUrl,
  currenciesForRevolutPair,
  revolutQuoteClientConfig,
  type RevolutPairKey,
} from "@/providers/revolut/revolut-config";

const externalDecimalSchema = z.union([z.number().finite(), z.string().min(1)]);

const externalMoneySchema = z
  .object({
    amount: externalDecimalSchema,
    currency: supportedCurrencyCodeSchema,
  })
  .passthrough();

const selectedPlanSchema = z
  .object({
    id: revolutPersonalPlanSchema,
    name: z.string().min(1),
    fees: z
      .object({
        fx: externalMoneySchema,
        total: externalMoneySchema,
        cost: externalMoneySchema,
      })
      .passthrough(),
    tooltipLong: z.string().min(1).nullish(),
    tooltipShort: z.string().min(1).nullish(),
  })
  .passthrough();

const responseSchema = z
  .object({
    sender: externalMoneySchema,
    recipient: externalMoneySchema,
    rate: z
      .object({
        from: supportedCurrencyCodeSchema,
        to: supportedCurrencyCodeSchema,
        rate: externalDecimalSchema,
        timestamp: z.number().int().positive(),
      })
      .passthrough(),
    fxTooltip: z.string().min(1).nullish(),
    plans: z.array(z.unknown()).min(1),
  })
  .passthrough();

export type RevolutQuoteRequest = Readonly<{
  pair: RevolutPairKey;
  sourceAmount: string;
  plan: RevolutPersonalPlan;
}>;

export type RevolutQuoteObservation = Readonly<{
  pair: RevolutPairKey;
  sourceAmount: string;
  targetAmount: string;
  rate: string;
  rateTimestamp: string;
  retrievedAt: string;
  sourceUrl: string;
  freshness: "FRESH" | "STALE";
  plan: RevolutPersonalPlan;
  fxFee: Readonly<{ amount: string; currency: SupportedCurrencyCode }>;
  totalFee: Readonly<{ amount: string; currency: SupportedCurrencyCode }>;
  totalSourceCost: Readonly<{ amount: string; currency: SupportedCurrencyCode }>;
  fxTooltip?: string;
  planTooltipLong?: string;
  planTooltipShort?: string;
}>;

export interface RevolutQuoteClient {
  getQuote(request: RevolutQuoteRequest, signal?: AbortSignal): Promise<RevolutQuoteObservation>;
}

export class RevolutQuoteClientError extends Error {
  constructor(
    readonly code: string,
    readonly retryable = false,
  ) {
    super(`Revolut public quote validation failed: ${code}`);
    this.name = "RevolutQuoteClientError";
  }
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type Sleep = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export type RevolutPublicQuoteClientDependencies = Readonly<{
  fetch?: FetchLike;
  now?: () => Date;
  sleep?: Sleep;
  timeoutMs?: number;
  freshCacheMs?: number;
  negativeCacheMs?: number;
  staleCacheMs?: number;
}>;

type CachedObservation = Omit<RevolutQuoteObservation, "freshness">;
type CachedFailure = Readonly<{ error: RevolutQuoteClientError; expiresAt: number }>;

function plainDecimal(value: string | number, code: string, positive: boolean): string {
  try {
    const parsed = decimal(String(value));
    if (positive ? !parsed.greaterThan(0) : parsed.lessThan(0)) {
      throw new RevolutQuoteClientError(code);
    }
    return decimalToPlainString(parsed);
  } catch (error) {
    if (error instanceof RevolutQuoteClientError) throw error;
    throw new RevolutQuoteClientError(code);
  }
}

function publicError(code: string, retryable = false): RevolutQuoteClientError {
  return new RevolutQuoteClientError(code, retryable);
}

function selectPlan(plans: readonly unknown[], plan: RevolutPersonalPlan) {
  const matches = plans.filter((candidate) => {
    const parsed = z.object({ id: z.string() }).safeParse(candidate);
    return parsed.success && parsed.data.id === plan;
  });
  if (matches.length === 0) throw publicError("SELECTED_PLAN_MISSING");
  if (matches.length > 1) throw publicError("SELECTED_PLAN_DUPLICATED");
  const selected = selectedPlanSchema.safeParse(matches[0]);
  if (!selected.success) throw publicError("SELECTED_PLAN_FEES_INVALID");
  return selected.data;
}

export function parseRevolutQuoteResponse({
  payload,
  request,
  retrievedAt,
  sourceUrl,
}: {
  payload: unknown;
  request: RevolutQuoteRequest;
  retrievedAt: Date;
  sourceUrl: string;
}): RevolutQuoteObservation {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw publicError("INVALID_JSON_SHAPE");

  const response = parsed.data;
  const expected = currenciesForRevolutPair(request.pair);
  if (
    response.sender.currency !== expected.sourceCurrency ||
    response.recipient.currency !== expected.targetCurrency ||
    response.rate.from !== expected.sourceCurrency ||
    response.rate.to !== expected.targetCurrency
  ) {
    throw publicError("WRONG_CURRENCY_DIRECTION");
  }

  const requestedAmount = decimal(request.sourceAmount);
  const senderAmount = decimal(plainDecimal(response.sender.amount, "INVALID_SENDER_AMOUNT", true));
  const recipientAmount = decimal(
    plainDecimal(response.recipient.amount, "INVALID_RECIPIENT_AMOUNT", true),
  );
  const rate = decimal(plainDecimal(response.rate.rate, "INVALID_RATE", true));
  if (!senderAmount.equals(requestedAmount)) throw publicError("SENDER_AMOUNT_MISMATCH");

  const bounds = revolutQuoteClientConfig.plausibleRates[request.pair];
  if (rate.lessThan(bounds.minimum) || rate.greaterThan(bounds.maximum)) {
    throw publicError("IMPLAUSIBLE_RATE");
  }
  const derivedRate = recipientAmount.dividedBy(senderAmount);
  const relativeDifference = derivedRate.minus(rate).abs().dividedBy(rate);
  if (relativeDifference.greaterThan(revolutQuoteClientConfig.consistencyTolerance)) {
    throw publicError("INCONSISTENT_SENDER_RECIPIENT_RATE");
  }

  const selectedPlan = selectPlan(response.plans, request.plan);
  const fxFee = decimal(plainDecimal(selectedPlan.fees.fx.amount, "INVALID_FX_FEE", false));
  const totalFee = decimal(
    plainDecimal(selectedPlan.fees.total.amount, "INVALID_TOTAL_FEE", false),
  );
  const totalSourceCost = decimal(
    plainDecimal(selectedPlan.fees.cost.amount, "INVALID_TOTAL_SOURCE_COST", true),
  );
  const feeCurrencies = [
    selectedPlan.fees.fx.currency,
    selectedPlan.fees.total.currency,
    selectedPlan.fees.cost.currency,
  ];
  if (feeCurrencies.some((currency) => currency !== expected.sourceCurrency)) {
    throw publicError("INCONSISTENT_FEE_CURRENCY");
  }
  if (totalFee.lessThan(fxFee)) throw publicError("INCONSISTENT_FEE_TOTAL");
  if (
    !isWithinCurrencyMinorUnit(
      totalSourceCost,
      senderAmount.plus(totalFee),
      expected.sourceCurrency,
    )
  ) {
    throw publicError("INCONSISTENT_TOTAL_SOURCE_COST");
  }

  const rateDate = new Date(response.rate.timestamp);
  if (Number.isNaN(rateDate.getTime())) throw publicError("INVALID_TIMESTAMP");
  const ageMs = retrievedAt.getTime() - rateDate.getTime();
  if (ageMs > revolutQuoteClientConfig.maximumSourceObservationAgeMs) {
    throw publicError("STALE_SOURCE_QUOTE");
  }
  if (ageMs < -revolutQuoteClientConfig.maximumFutureClockSkewMs) {
    throw publicError("FUTURE_SOURCE_QUOTE");
  }

  return {
    pair: request.pair,
    sourceAmount: decimalToPlainString(senderAmount),
    targetAmount: decimalToPlainString(recipientAmount),
    rate: decimalToPlainString(rate),
    rateTimestamp: rateDate.toISOString(),
    retrievedAt: retrievedAt.toISOString(),
    sourceUrl,
    freshness: "FRESH",
    plan: request.plan,
    fxFee: {
      amount: decimalToPlainString(fxFee),
      currency: expected.sourceCurrency,
    },
    totalFee: {
      amount: decimalToPlainString(totalFee),
      currency: expected.sourceCurrency,
    },
    totalSourceCost: {
      amount: decimalToPlainString(totalSourceCost),
      currency: expected.sourceCurrency,
    },
    ...(response.fxTooltip == null ? {} : { fxTooltip: response.fxTooltip }),
    ...(selectedPlan.tooltipLong == null ? {} : { planTooltipLong: selectedPlan.tooltipLong }),
    ...(selectedPlan.tooltipShort == null ? {} : { planTooltipShort: selectedPlan.tooltipShort }),
  };
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(publicError("REQUEST_ABORTED"));
      return;
    }
    const abort = () => {
      clearTimeout(timeoutId);
      reject(publicError("REQUEST_ABORTED"));
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
  if (parentSignal?.aborted === true) throw publicError("REQUEST_ABORTED");
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let removeParentAbort: (() => void) | undefined;
  const parentAbort = new Promise<never>((_, reject) => {
    if (parentSignal === undefined) return;
    const abort = () => {
      controller.abort();
      reject(publicError("REQUEST_ABORTED"));
    };
    parentSignal.addEventListener("abort", abort, { once: true });
    removeParentAbort = () => parentSignal.removeEventListener("abort", abort);
  });

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort();
        reject(publicError("REQUEST_TIMEOUT", true));
      }, timeoutMs);
    });
    return await Promise.race([
      fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Accept-Language": "hu",
          "User-Agent": revolutQuoteClientConfig.userAgent,
        },
        redirect: "manual",
        signal: controller.signal,
      }),
      timeout,
      parentAbort,
    ]);
  } catch (error) {
    if (error instanceof RevolutQuoteClientError) throw error;
    throw publicError("NETWORK_FAILURE", true);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    removeParentAbort?.();
  }
}

function cacheKey(request: RevolutQuoteRequest): string {
  return `${request.pair}|${decimalToPlainString(decimal(request.sourceAmount))}|${request.plan}`;
}

function retryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function readLimitedJsonBody(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let body = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    receivedBytes += chunk.value.byteLength;
    if (receivedBytes > revolutQuoteClientConfig.maximumJsonBytes) {
      await reader.cancel();
      throw publicError("RESPONSE_TOO_LARGE");
    }
    body += decoder.decode(chunk.value, { stream: true });
  }

  return body + decoder.decode();
}

export class RevolutPublicQuoteClient implements RevolutQuoteClient {
  readonly #fetch: FetchLike;
  readonly #now: () => Date;
  readonly #sleep: Sleep;
  readonly #timeoutMs: number;
  readonly #freshCacheMs: number;
  readonly #negativeCacheMs: number;
  readonly #staleCacheMs: number;
  readonly #cache = new Map<string, CachedObservation>();
  readonly #failures = new Map<string, CachedFailure>();
  readonly #inFlight = new Map<string, Promise<RevolutQuoteObservation>>();

  constructor(dependencies: RevolutPublicQuoteClientDependencies = {}) {
    this.#fetch = dependencies.fetch ?? fetch;
    this.#now = dependencies.now ?? (() => new Date());
    this.#sleep = dependencies.sleep ?? defaultSleep;
    this.#timeoutMs = dependencies.timeoutMs ?? revolutQuoteClientConfig.timeoutMs;
    this.#freshCacheMs = dependencies.freshCacheMs ?? revolutQuoteClientConfig.freshCacheMs;
    this.#negativeCacheMs =
      dependencies.negativeCacheMs ?? revolutQuoteClientConfig.negativeCacheMs;
    this.#staleCacheMs = dependencies.staleCacheMs ?? revolutQuoteClientConfig.staleCacheMs;
  }

  async getQuote(
    request: RevolutQuoteRequest,
    signal?: AbortSignal,
  ): Promise<RevolutQuoteObservation> {
    const key = cacheKey(request);
    const requestTime = this.#now();
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      const cacheAge = requestTime.getTime() - Date.parse(cached.retrievedAt);
      const sourceAge = requestTime.getTime() - Date.parse(cached.rateTimestamp);
      if (
        cacheAge <= this.#freshCacheMs &&
        sourceAge <= revolutQuoteClientConfig.maximumSourceObservationAgeMs
      ) {
        return { ...cached, freshness: "FRESH" };
      }
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

    const pending = this.#refresh(request, cached, signal);
    this.#inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.#inFlight.get(key) === pending) this.#inFlight.delete(key);
    }
  }

  #staleObservation(
    cached: CachedObservation | undefined,
    at: Date,
  ): RevolutQuoteObservation | undefined {
    if (cached === undefined) return undefined;
    const staleAge = at.getTime() - Date.parse(cached.rateTimestamp);
    return staleAge <= this.#staleCacheMs ? { ...cached, freshness: "STALE" } : undefined;
  }

  async #refresh(
    request: RevolutQuoteRequest,
    cached: CachedObservation | undefined,
    signal?: AbortSignal,
  ): Promise<RevolutQuoteObservation> {
    const key = cacheKey(request);
    const sourceUrl = buildRevolutQuoteUrl(request.pair, request.sourceAmount);
    const totalAttempts = revolutQuoteClientConfig.retryBackoffMs.length + 1;
    let lastError: RevolutQuoteClientError = publicError("QUOTE_UNAVAILABLE");

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      try {
        const response = await fetchWithTimeout({
          fetcher: this.#fetch,
          url: sourceUrl,
          parentSignal: signal,
          timeoutMs: this.#timeoutMs,
        });
        if (response.status >= 300 && response.status < 400) {
          throw publicError("UNEXPECTED_REDIRECT");
        }
        if (!response.ok) {
          throw publicError(`HTTP_${response.status}`, retryableHttpStatus(response.status));
        }
        if (response.url !== "" && response.url !== sourceUrl) {
          throw publicError("UNEXPECTED_RESPONSE_URL");
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          throw publicError("UNEXPECTED_CONTENT_TYPE");
        }
        const declaredLength = Number(response.headers.get("content-length") ?? "0");
        if (declaredLength > revolutQuoteClientConfig.maximumJsonBytes) {
          throw publicError("RESPONSE_TOO_LARGE");
        }
        const body = await readLimitedJsonBody(response);

        let payload: unknown;
        try {
          payload = JSON.parse(body) as unknown;
        } catch {
          throw publicError("MALFORMED_JSON");
        }
        const observation = parseRevolutQuoteResponse({
          payload,
          request,
          retrievedAt: this.#now(),
          sourceUrl,
        });
        const cachedObservation: CachedObservation = observation;
        this.#cache.set(key, cachedObservation);
        this.#failures.delete(key);
        return observation;
      } catch (error) {
        lastError =
          error instanceof RevolutQuoteClientError ? error : publicError("NETWORK_FAILURE", true);
        if (signal?.aborted === true || !lastError.retryable) break;
        const backoff = revolutQuoteClientConfig.retryBackoffMs[attempt];
        if (backoff !== undefined) await this.#sleep(backoff, signal);
      }
    }

    if (signal?.aborted === true) throw lastError;
    this.#failures.set(key, {
      error: lastError,
      expiresAt: this.#now().getTime() + this.#negativeCacheMs,
    });
    const stale = this.#staleObservation(cached, this.#now());
    if (stale !== undefined) return stale;
    throw lastError;
  }
}
