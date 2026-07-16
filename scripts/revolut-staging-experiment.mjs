const stagingUrlValue = process.env.NEORATE_STAGING_URL;
const intervalMs = Number(process.env.REVOLUT_STAGING_INTERVAL_MS);
const protectionBypass = process.env.NEORATE_STAGING_PROTECTION_BYPASS;

if (stagingUrlValue === undefined || !Number.isInteger(intervalMs) || intervalMs < 15_000) {
  console.error(
    "Set NEORATE_STAGING_URL and REVOLUT_STAGING_INTERVAL_MS (minimum 15000) explicitly.",
  );
  process.exit(1);
}

const stagingUrl = new URL(stagingUrlValue);
const endpointUrl = new URL("/api/v1/quotes", stagingUrl);
const previewShareToken = stagingUrl.searchParams.get("_vercel_share");
if (previewShareToken !== null) endpointUrl.searchParams.set("_vercel_share", previewShareToken);

const cases = [
  { sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000" },
  { sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "100000" },
  { sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "400000" },
  { sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "1000000" },
  { sourceCurrency: "HUF", targetCurrency: "EUR", sourceAmount: "5000000" },
  ...["968", "969", "970", "971", "972", "973", "974", "2000", "10000"].map((sourceAmount) => ({
    sourceCurrency: "EUR",
    targetCurrency: "HUF",
    sourceAmount,
  })),
];

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

async function requestQuote(testCase, wave) {
  const startedAt = performance.now();
  const response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(protectionBypass === undefined ? {} : { "x-vercel-protection-bypass": protectionBypass }),
    },
    body: JSON.stringify({
      ...testCase,
      providers: ["REVOLUT"],
      providerContexts: { REVOLUT: { plan: "STANDARD" } },
    }),
  });
  const durationMs = performance.now() - startedAt;
  const payload = await response.json();
  const quote = Array.isArray(payload?.quotes)
    ? payload.quotes.find((candidate) => candidate?.provider?.id === "REVOLUT")
    : undefined;
  return {
    wave,
    request: testCase,
    httpStatus: response.status,
    durationMs,
    sourceStatus: payload?.sourceStatus ?? null,
    warnings: payload?.warnings ?? [],
    quote:
      quote === undefined
        ? null
        : {
            recipientAmount: quote?.targetAmount?.amount ?? null,
            rawRate: quote?.providerDetails?.displayedBaseRate ?? null,
            totalFee: quote?.providerDetails?.totalFee ?? null,
            totalSourceCost: quote?.providerDetails?.totalSourceCost ?? null,
            feePercentage: quote?.providerDetails?.feePercentage ?? null,
            rateTimestamp: quote?.rateTimestamp ?? null,
            retrievedAt: quote?.retrievedAt ?? null,
            sourceType: quote?.sourceType ?? null,
            freshness: quote?.freshness ?? null,
            rankingStatus: quote?.rankingStatus ?? null,
            rankingExclusionReason: quote?.rankingExclusionReason ?? null,
            allowanceAssumption: quote?.providerDetails?.allowanceAssumption ?? null,
          },
  };
}

async function sequentialWave(name) {
  const results = [];
  for (const testCase of cases) results.push(await requestQuote(testCase, name));
  return results;
}

async function waitForExpiry(milliseconds) {
  let remaining = milliseconds;
  while (remaining > 0) {
    const step = Math.min(remaining, 10_000);
    await new Promise((resolve) => setTimeout(resolve, step));
    remaining -= step;
  }
}

const first = await sequentialWave("cold");
const warm = await sequentialWave("warm");
const concurrentCase = { sourceCurrency: "EUR", targetCurrency: "HUF", sourceAmount: "1234.56" };
const concurrent = await Promise.all(
  Array.from({ length: 4 }, () => requestQuote(concurrentCase, "concurrent")),
);
await waitForExpiry(intervalMs + 1_000);
const expired = await sequentialWave("expired");
const results = [...first, ...warm, ...concurrent, ...expired];
const latencies = results.map((result) => result.durationMs);
const statusCounts = Object.groupBy(results, (result) => String(result.httpStatus));

console.log(
  JSON.stringify({
    intervalMs,
    stagingUrl: stagingUrl.origin,
    totalQuoteRequests: results.length,
    httpStatusCounts: Object.fromEntries(
      Object.entries(statusCounts).map(([status, entries]) => [status, entries?.length ?? 0]),
    ),
    medianLatencyMs: Number(percentile(latencies, 0.5).toFixed(2)),
    p95LatencyMs: Number(percentile(latencies, 0.95).toFixed(2)),
    schemaSuccessCount: results.filter(
      (result) =>
        result.httpStatus === 200 &&
        result.quote?.sourceType === "LIVE_UNOFFICIAL" &&
        result.quote?.allowanceAssumption === "FULL_ALLOWANCE_ASSUMED",
    ).length,
    representativeQuotes: first,
  }),
  null,
  2,
);
