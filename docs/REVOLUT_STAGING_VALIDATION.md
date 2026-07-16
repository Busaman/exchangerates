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

Results are pending the controlled preview deployments.

## Decision

Pending measured staging evidence. The safe default remains 60 seconds. Weekend fee verification is
outstanding; every Revolut quote remains visible but excluded from ranking during the documented
America/New_York weekend window.
