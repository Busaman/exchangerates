# Revolut staging validation

This report records controlled preview-only validation of the undocumented Revolut public quote
endpoint. It is operational evidence, not production approval. Production remains disabled unless
`REVOLUT_ADAPTER_ENABLED` is exactly `true`; NeoRate does not set that value in production.

## Method

Each interval uses the same 46 NeoRate API calls: 14 cold sequential representative amounts in both
directions, the same 14 as immediate warm requests, four modest concurrent identical requests to
exercise single-flight, then the 14 requests again after the configured positive TTL expires. The
amounts cover 1,000–5,000,000 HUF and 968–10,000 EUR, including EUR 968–974. Only Standard is
requested because the public endpoint has so far returned only that exact plan.

Measure API status counts and p50/p95 client latency from the script, and use structured runtime logs
for outbound status, cache outcomes, validation failures and ranking exclusions. Vercel's cache is
in-process and not shared between function instances, so hit ratios may change with instance routing
or cold starts. No test runs below 15 seconds and traffic remains controlled.

Run against an explicitly selected preview URL:

```powershell
$env:NEORATE_STAGING_URL="https://preview.example"
$env:REVOLUT_STAGING_INTERVAL_MS="60000"
pnpm test:revolut:staging
```

## Results

Controlled preview runs completed on 2026-07-16 in the dedicated `neorate-staging` Vercel project.
The Revolut gate was enabled only for Preview; the Production environment has neither Revolut
variable and therefore remains disabled. Each interval used a new explicit Preview deployment.

| Fresh TTL | API requests | Revolut outbound | Fresh hits | Misses | 400 / 403 / 429 / 5xx / timeout |  API p50 / p95 | Outbound p50 / p95 |
| --------: | -----------: | ---------------: | ---------: | -----: | ------------------------------: | -------------: | -----------------: |
| 60,000 ms |           46 |               29 |         17 |     29 |               0 / 0 / 0 / 0 / 0 | 320 / 1,154 ms |       124 / 151 ms |
| 30,000 ms |           46 |               29 |         17 |     29 |               0 / 0 / 0 / 0 / 0 | 308 / 1,024 ms |       126 / 159 ms |
| 15,000 ms |           46 |               29 |         17 |     29 |               0 / 0 / 0 / 0 / 0 |   281 / 705 ms |       125 / 167 ms |

All 138 API responses were HTTP 200 and passed the NeoRate response schema. Every one of the 87
outbound observations was HTTP 200. There were no stale or negative-cache hits, validation
failures, single-flight joins recorded by the server instance, Cloudflare challenges or ranking
exclusions in these weekday runs. The four concurrent callers still completed successfully; a
single-flight event is not guaranteed to be visible when Vercel routes calls to separate instances.

The hundredth-major-unit boundary was correct in both directions. Representative preview results
included 100,000 HUF to 274.47–274.58 EUR with zero fee, 400,000 HUF to about 1,099.5 EUR with a
500 HUF fee, and EUR 968–974 with distinct, increasing Standard fees. At one close comparison, the
official converter showed EUR 972 to HUF 349,996.83 with a EUR 0.10 fee and rate 360.0790; Preview
showed HUF 349,994.41 with the same EUR 0.10 fee and rate 360.0765595 shortly beforehand. The small
payout difference is consistent with the intervening live-rate movement. A close HUF 100,000 check
similarly showed EUR 274.59 in the converter and EUR 274.58 in Preview, both fee-free. All successful
rows remained `LIVE_UNOFFICIAL`, `FRESH`, `FULL_ALLOWANCE_ASSUMED`, and carried the app-verification
warning.

## Decision

Keep the 60-second default and staging value. The 30- and 15-second intervals each passed one
controlled run, but that is not repeated, multi-region evidence and is insufficient to justify the
extra undocumented-endpoint traffic. The 60-second interval met every decision criterion while
retaining an effective cache and is the lowest safe recommendation supported by the current amount
of evidence. Repeat the experiment over longer windows before lowering it.

Weekend fee verification is outstanding because these measurements ran outside the documented
America/New_York weekend window. Every Revolut weekend quote must remain visible but excluded from
ranking until simultaneous endpoint/converter evidence supports a narrower policy. These staging
results are operational evidence only; production remains disabled pending legal/product approval.
