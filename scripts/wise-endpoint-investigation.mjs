import Decimal from "decimal.js";
import { z } from "zod";
import { classifyWiseExpectation } from "./wise-investigation-expectation.mjs";

if (process.env.WISE_INVESTIGATION_ENABLED !== "true") {
  console.error("Set WISE_INVESTIGATION_ENABLED=true to run live Wise investigation requests.");
  process.exit(1);
}

const endpoint = "https://wise.com/gateway/v4/comparisons";
const timeoutMs = 5_000;
const maximumResponseBytes = 512 * 1024;
const interRequestDelayMs = 350;
const freshnessWaitCandidate = Number(process.env.WISE_FRESHNESS_WAIT_MS ?? "5000");
const freshnessWaitMs =
  Number.isInteger(freshnessWaitCandidate) &&
  freshnessWaitCandidate >= 5_000 &&
  freshnessWaitCandidate <= 60_000
    ? freshnessWaitCandidate
    : 5_000;
const userAgent = "NeoRate technical investigation";
const frontendToken = process.env.WISE_FRONTEND_TOKEN;

const finiteNumber = z.number().finite();
const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable();
const quoteSchema = z
  .object({
    dateCollected: z.iso.datetime(),
    fee: finiteNumber,
    isConsideredMidMarketRate: z.boolean(),
    markup: finiteNumber,
    rate: finiteNumber,
    receivedAmount: finiteNumber,
    sendAmount: finiteNumber.nullable().optional(),
    sourceCountry: countrySchema,
    targetCountry: countrySchema,
  })
  .passthrough();
const providerSchema = z
  .object({
    alias: z.string(),
    name: z.string(),
    quotes: z.array(z.unknown()),
    type: z.string(),
  })
  .passthrough();
const responseSchema = z
  .object({
    amount: finiteNumber,
    amountType: z.string(),
    providers: z.array(providerSchema),
    sourceCountry: countrySchema,
    sourceCurrency: z.string(),
    targetCountry: countrySchema.optional(),
    targetCurrency: z.string(),
  })
  .passthrough();

const baseHeaders = {
  Accept: "application/json",
  "User-Agent": userAgent,
};

const matrix = [
  ...["100", "10000", "100000", "400000", "998877", "1000000"].map((sendAmount) => ({
    expectWise: sendAmount !== "100",
    sendAmount,
    sourceCurrency: "HUF",
    targetCurrency: "EUR",
  })),
  ...["1", "10", "100", "1000", "5000"].map((sendAmount) => ({
    expectWise: true,
    sendAmount,
    sourceCurrency: "EUR",
    targetCurrency: "HUF",
  })),
];

const records = [];
let failures = 0;

function pause(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildUrl({
  filter = "POPULAR",
  includeWise = "true",
  numberOfProviders = "3",
  sendAmount,
  sourceCountry = "HU",
  sourceCurrency,
  targetCurrency,
}) {
  const url = new URL(endpoint);
  url.searchParams.set("sourceCurrency", sourceCurrency);
  url.searchParams.set("targetCurrency", targetCurrency);
  url.searchParams.set("sendAmount", sendAmount);
  if (sourceCountry !== null) url.searchParams.set("sourceCountry", sourceCountry);
  if (filter !== null) url.searchParams.set("filter", filter);
  if (includeWise !== null) url.searchParams.set("includeWise", includeWise);
  if (numberOfProviders !== null) url.searchParams.set("numberOfProviders", numberOfProviders);
  return url;
}

function validate(payload, request, observedAt) {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new Error("MALFORMED_RESPONSE");
  const response = parsed.data;
  if (response.amountType !== "SEND") throw new Error("UNSUPPORTED_AMOUNT_TYPE");
  if (
    response.sourceCurrency !== request.sourceCurrency ||
    response.targetCurrency !== request.targetCurrency
  ) {
    throw new Error("CURRENCY_MISMATCH");
  }

  const amount = new Decimal(String(response.amount));
  const requestedAmount = new Decimal(request.sendAmount);
  if (!requestedAmount.greaterThan(0) || !amount.equals(requestedAmount)) {
    throw new Error("AMOUNT_MISMATCH");
  }
  // Investigation variants tolerate null country metadata so omitted-country behavior remains
  // observable. The isolated parser is strict, and a future Hungarian adapter must stay strict.
  if (
    request.sourceCountry !== null &&
    response.sourceCountry !== null &&
    response.sourceCountry !== request.sourceCountry
  ) {
    throw new Error("SOURCE_COUNTRY_MISMATCH");
  }

  const wiseProviders = response.providers.filter((provider) => provider.alias === "wise");
  if (wiseProviders.length === 0) {
    return {
      evidence: {
        amount: amount.toString(),
        amountType: response.amountType,
        responseSourceCountry: response.sourceCountry,
        responseTargetCountry: response.targetCountry ?? null,
      },
      otherProviderAliases: response.providers.map((provider) => provider.alias),
      wisePresent: false,
    };
  }
  if (wiseProviders.length !== 1) throw new Error("WISE_PROVIDER_NOT_UNIQUE");
  const provider = wiseProviders[0];
  if (provider.quotes.length !== 1) throw new Error("WISE_QUOTE_COUNT_UNSUPPORTED");
  const quoteResult = quoteSchema.safeParse(provider.quotes[0]);
  if (!quoteResult.success) throw new Error("MALFORMED_WISE_QUOTE");
  const quote = quoteResult.data;

  const fee = new Decimal(String(quote.fee));
  const rate = new Decimal(String(quote.rate));
  const receivedAmount = new Decimal(String(quote.receivedAmount));
  const markup = new Decimal(String(quote.markup));
  if (fee.isNegative()) throw new Error("NEGATIVE_FEE");
  if (!rate.greaterThan(0)) throw new Error("NON_POSITIVE_RATE");
  if (!receivedAmount.greaterThan(0)) throw new Error("NON_POSITIVE_RECEIVED_AMOUNT");
  if (markup.isNegative()) throw new Error("NEGATIVE_MARKUP");

  const convertedSourceAmount = amount.minus(fee);
  if (!convertedSourceAmount.greaterThan(0)) throw new Error("NON_POSITIVE_CONVERTED_AMOUNT");
  const expectedReceivedAmount = convertedSourceAmount.times(rate);
  const mathematicalDifference = expectedReceivedAmount.minus(receivedAmount).abs();
  const tolerance = new Decimal(request.targetCurrency === "EUR" ? "0.01" : "1");
  if (mathematicalDifference.greaterThan(tolerance)) {
    throw new Error("MATHEMATICAL_MISMATCH");
  }

  const dateCollectedMs = Date.parse(quote.dateCollected);
  const quoteAgeMs = observedAt.getTime() - dateCollectedMs;
  if (!Number.isFinite(dateCollectedMs)) throw new Error("INVALID_QUOTE_TIMESTAMP");
  if (quoteAgeMs < -120_000) throw new Error("FUTURE_QUOTE_TIMESTAMP");
  if (quoteAgeMs > 900_000) throw new Error("STALE_QUOTE_TIMESTAMP");

  return {
    evidence: {
      amount: amount.toString(),
      amountType: response.amountType,
      convertedSourceAmount: convertedSourceAmount.toString(),
      dateCollected: quote.dateCollected,
      effectiveRate: receivedAmount.dividedBy(amount).toString(),
      expectedReceivedAmount: expectedReceivedAmount.toString(),
      fee: fee.toString(),
      isConsideredMidMarketRate: quote.isConsideredMidMarketRate,
      markup: markup.toString(),
      mathematicalDifference: mathematicalDifference.toString(),
      quoteSendAmount:
        quote.sendAmount === undefined || quote.sendAmount === null
          ? null
          : new Decimal(String(quote.sendAmount)).toString(),
      quoteSourceCountry: quote.sourceCountry,
      quoteTargetCountry: quote.targetCountry,
      rate: rate.toString(),
      receivedAmount: receivedAmount.toString(),
      responseSourceCountry: response.sourceCountry,
      responseTargetCountry: response.targetCountry ?? null,
      wiseAlias: provider.alias,
      wiseName: provider.name,
      wiseQuoteCount: provider.quotes.length,
      wiseType: provider.type,
    },
    otherProviderAliases: response.providers
      .filter((candidate) => candidate.alias !== "wise")
      .map((candidate) => candidate.alias),
    quoteAgeMs,
    wisePresent: true,
  };
}

async function probe({ expectWise = true, headers = baseHeaders, label, params }) {
  const url = buildUrl(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  let httpStatus = null;
  let latencyMs = 0;
  let record;

  try {
    const response = await fetch(url, {
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    const observedAt = new Date();
    latencyMs = Math.round(performance.now() - startedAt);
    httpStatus = response.status;
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maximumResponseBytes) {
      throw new Error("RESPONSE_TOO_LARGE");
    }
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new Error("UNEXPECTED_CONTENT_TYPE");
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("MALFORMED_JSON");
    }
    const validated = validate(payload, params, observedAt);
    const classification = classifyWiseExpectation({
      expectWise,
      wisePresent: validated.wisePresent,
    });
    const { failureCount, ...classificationFields } = classification;
    failures += failureCount;
    const commonRecord = {
      cacheHeaders: {
        age: response.headers.get("age"),
        cacheControl: response.headers.get("cache-control"),
        cfCacheStatus: response.headers.get("cf-cache-status"),
        xCache: response.headers.get("x-cache"),
      },
      httpStatus,
      label,
      latencyMs,
      otherProviderAliases: validated.otherProviderAliases,
      requestedAmount: params.sendAmount,
      sourceCountry: params.sourceCountry,
      sourceCurrency: params.sourceCurrency,
      targetCurrency: params.targetCurrency,
      wisePresent: validated.wisePresent,
      ...(validated.evidence ?? {}),
      quoteAgeMs: validated.quoteAgeMs ?? null,
    };
    record = { ...commonRecord, ...classificationFields };
  } catch (error) {
    failures += 1;
    record = {
      failureCode:
        error instanceof Error
          ? error.name === "AbortError"
            ? "REQUEST_TIMEOUT"
            : error.message
          : "UNKNOWN_FAILURE",
      httpStatus,
      label,
      latencyMs: latencyMs || Math.round(performance.now() - startedAt),
      requestedAmount: params.sendAmount,
      sourceCountry: params.sourceCountry,
      sourceCurrency: params.sourceCurrency,
      targetCurrency: params.targetCurrency,
      validationResult: "FAIL",
    };
  } finally {
    clearTimeout(timeout);
  }

  records.push(record);
  console.log(JSON.stringify(record));
  await pause(interRequestDelayMs);
  return record;
}

const baseRequest = {
  sendAmount: "100000",
  sourceCountry: "HU",
  sourceCurrency: "HUF",
  targetCurrency: "EUR",
};

for (const entry of matrix) {
  const { expectWise, ...params } = entry;
  await probe({
    expectWise,
    label: `matrix-${entry.sourceCurrency}-${entry.targetCurrency}-${entry.sendAmount}`,
    params: { ...params, sourceCountry: "HU" },
  });
}

const minimal = await probe({ label: "headers-A-minimal", params: baseRequest });
if (minimal.validationResult !== "PASS" && frontendToken !== undefined) {
  await probe({
    headers: { ...baseHeaders, "x-access-token": frontendToken },
    label: "headers-B-public-frontend-token",
    params: baseRequest,
  });
} else {
  console.log(
    JSON.stringify({
      label: "headers-B-public-frontend-token",
      reason:
        minimal.validationResult === "PASS"
          ? "SKIPPED_MINIMAL_SUCCEEDED"
          : "SKIPPED_NO_TEMPORARY_TOKEN",
      validationResult: "NOT_RUN",
    }),
  );
}
await probe({
  headers: { ...baseHeaders, "Accept-Language": "en-GB,en;q=0.9" },
  label: "headers-C-language",
  params: baseRequest,
});
await probe({ label: "headers-D-no-token-no-cookies", params: baseRequest });

await probe({ label: "country-HU", params: baseRequest });
await probe({ label: "country-omitted", params: { ...baseRequest, sourceCountry: null } });
await probe({ label: "country-DE", params: { ...baseRequest, sourceCountry: "DE" } });

await probe({ label: "parameter-filter-omitted", params: { ...baseRequest, filter: null } });
await probe({
  expectWise: false,
  label: "parameter-include-wise-omitted",
  params: { ...baseRequest, includeWise: null },
});
await probe({
  expectWise: false,
  label: "parameter-include-wise-false",
  params: { ...baseRequest, includeWise: "false" },
});
await probe({
  label: "parameter-provider-count-omitted",
  params: { ...baseRequest, numberOfProviders: null },
});

const freshnessCases = [
  baseRequest,
  {
    sendAmount: "1000",
    sourceCountry: "HU",
    sourceCurrency: "EUR",
    targetCurrency: "HUF",
  },
];
for (const entry of freshnessCases) {
  await probe({ label: `freshness-before-${entry.sourceCurrency}`, params: entry });
}
await pause(freshnessWaitMs);
for (const entry of freshnessCases) {
  await probe({ label: `freshness-after-${entry.sourceCurrency}`, params: entry });
}

console.log(
  JSON.stringify({
    failures,
    frontendTokenUsed:
      records.some((record) => record.label === "headers-B-public-frontend-token") &&
      minimal.validationResult !== "PASS",
    totalRequests: records.length,
    validationResult: failures === 0 ? "PASS" : "FAIL",
  }),
);

if (failures > 0) process.exitCode = 1;
