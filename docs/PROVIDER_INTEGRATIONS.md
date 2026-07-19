# Provider adapter guide

## Approval gate

Before implementation, document the source owner, official documentation or legal basis, terms of
use, authentication, rate limits, supported regions/plans/directions, timestamp semantics, expected
fees, retention constraints and fallback behavior. Add an ADR for any unofficial or estimated source.
No scraping, private API reverse engineering or endpoint guessing belongs in an adapter.

## Implementation checklist

1. Add the provider identifier to `providerIdentifierSchema` and create one module under
   `src/providers/<provider>` implementing `ProviderAdapter`.
2. Define a Zod schema for the raw response and validate before reading values.
3. Map source amount, resulting amount, effective rate, explicit fee and total cost without binary
   floating-point arithmetic. Preserve directional pricing and plan/tier.
4. Set `rateTimestamp` from the provider and `retrievedAt` locally; never conflate them.
5. Set source type, source URL/identifier, freshness and reliability from documented evidence.
6. Return `unavailable` without numeric fields for unsupported pairs, failed validation, provider
   downtime or missing reliable data. Do not substitute a market rate.
7. Log structured operational context without credentials, account details or sensitive raw payloads.
8. Add a `ProviderRegistration` to `providerRegistry` with status `SUPPORTED` or `UNAVAILABLE`,
   including a provider-specific timeout only when measured behavior requires it. Do not add
   provider-specific conditionals to the quote service or API route.

Adapters receive an `AbortSignal` in their context and should stop network work promptly when it is
aborted. They return normalized `quote` or `unavailable` results. Thrown exceptions, timeouts and
schema-invalid adapter responses are converted by the service to numeric-field-free `error/FAILED`
results with public error codes; private exception details remain in structured logs only.

## Tests required before enablement

- Sanitized, legally retainable contract fixtures for valid and malformed responses.
- Both EUR/HUF and HUF/EUR where supported; never derive one from the other.
- Provider plan, fee, rounding and amount-boundary cases.
- Timeout, rate-limit, authentication, unavailable and stale behavior.
- Timestamp/freshness and provenance assertions.
- Comparison-service integration proving unavailable quotes cannot win or expose numbers.
- The reusable `runProviderAdapterContract` suite, proving normalized shape, decimal strings,
  timestamps, provenance and numeric-field-free non-quote results.

Keep a new adapter disabled until its source, tests and user-facing labeling have been reviewed.

## Revolut Hungary personal adapter

Scope is personal customers only: `STANDARD`, `PLUS`, `PREMIUM`, `METAL`, and `ULTRA`, with an
explicit selected plan. Revolut Business, Pro, merchant/corporate products, authenticated accounts,
private app endpoints and reciprocal inference are prohibited.

Approved public website endpoint:

- `GET https://www.revolut.com/api/exchange/quote`
- required query: `amount`, `country=HU`, `fromCurrency`, `isRecipientAmount=false`, `toCurrency`
- request headers: `Accept: application/json`, `Accept-Language: hu`, and the non-deceptive NeoRate User-Agent only
- explicitly forbidden: cookies, authorization, browser/user identifiers, copied Cloudflare data,
  Sentry/analytics headers, HTML parsing and browser automation

Fee policy sources:

- `https://help.revolut.com/hu-HU/help/wealth/exchanging-money/how-much-does-it-cost-to-make-an-exchange/will-i-be-charged-for-exchanging-foreign-currencies/`
- `https://www.revolut.com/hu-HU/legal/standard-fees/`

There is no documented public personal Revolut API. Although this JSON endpoint is publicly
accessible and used by Revolut's official converter, it is not a supported external contract; valid
results are `LIVE_UNOFFICIAL`, medium-reliability and explicitly indicative. Preserve the exact query
URL, endpoint timestamp and retrieval timestamp. Non-JSON content, redirect/challenge responses,
invalid fields or access failure become unavailable and no fallback is allowed.

All endpoint monetary amounts are integer hundredths of a major unit, including HUF. Convert the
user's exact major-unit source amount with `major × 100`, and decode `sender`, `recipient`, `fees.fx`,
`fees.total`, and `fees.cost` with `apiAmount / 100` before consistency checks or normalization.
Amounts not exactly representable in hundredths fail closed. The decoded sender and direction must
match exactly; decoded recipient must be positive and within 0.01 target unit of `sender × rawRate`.
Preserve `targetAmountCalculation: ENDPOINT_HUNDREDTH_UNIT_DECODED`.

After decoding, `fees.cost` may differ from `sender.amount + fees.total` by at most one endpoint API
unit: 0.01 major unit for either HUF or EUR. The
boundary is inclusive; a larger difference is invalid. The returned cost is preserved unchanged.

Fixtures under `src/providers/revolut/fixtures` are sanitized JSON contract examples. Unit tests
never call Revolut. The optional `pnpm test:revolut:live` script runs only with
`REVOLUT_LIVE_TEST_ENABLED=true` and prints sanitized summaries. The client uses a 2.5-second
per-attempt timeout, two bounded retries, 60-second fresh cache, 30-second negative cache,
amount/direction/plan-specific single-flight and a 15-minute stale ceiling. Negative results suppress
retry storms but do not renew timestamps or stale age. Only a last successful observation for the
same material request can become `STALE`; it is never ranked.

Every Revolut fixture carries `"_amountUnit": "ONE_HUNDREDTH_MAJOR_UNIT"`. Synthetic-only fixtures
also carry `"_synthetic": true`; the response schema permits these unrelated evidence markers but
never uses them as quote data.

The source amount in the cache key is canonicalized to exact API units and includes a codec-version
prefix. Adjacent values such as A and A+1 therefore have distinct fresh, negative, stale, and
in-flight entries; spellings such as `965` and `965.00` share the same entry. The version prefix
prevents reuse of observations created under the former incorrect scale.

`huf-eur-plan-fees.json` is synthetic multi-plan contract coverage and carries top-level
`"_synthetic": true`. It demonstrates strict selection and fee normalization only; it is not live
plan-availability or fee evidence.
`eur-huf-adjacent-zero.json` and `eur-huf-adjacent-positive.json` are likewise synthetic A/A+1
contract fixtures. They prove zero versus small-positive fee preservation and cache isolation, not a
live or fixed Revolut threshold.

For a successful quote, select exactly the requested plan and validate `fees.fx`, `fees.total`, and
`fees.cost`. Their currencies must equal the source currency, total fee cannot be below FX fee, and
total source-side cost must equal sender amount plus total fee. Derive the normalized target from the
directional raw rate as described above and derive effective rate from that target. Do not manually
add fair-usage/weekend fees or apply a second fee calculation.

Expose `feePercentage = fees.total / sender.amount × 100` for source-driven quotes. Use decimal.js,
retain the full decimal string in transport, and render enough fractional digits that a positive fee
cannot appear as zero. Preserve `fees.total` and its source currency unchanged.

If the requested exact plan is absent, return a numeric-field-free unavailable result explaining
that the public Revolut endpoint did not return that plan. Do not collapse this into a generic fetch
failure and never substitute Standard.

The endpoint has no authenticated account or prior-usage input and therefore cannot know actual
rolling-30-day allowance usage. NeoRate has removed the old usage field rather than claim false
account-specific accuracy or double-charge endpoint fees. Results state `FULL_ALLOWANCE_ASSUMED` and
must be checked in-app. The locale is selected by `Accept-Language: hu`, not by a query parameter.
The public request still does not reveal account-specific allowance usage, so below/above-allowance
and weekday/weekend account behavior must be confirmed in the Revolut app and controlled staging.

Live evidence captured 2026-07-13 with no cookies or authorization: HUF→EUR at 100,000, 400,000, and
1,100,000 HUF and EUR→HUF at 100, 1,000, and 3,000 EUR all returned HTTP 200. Sanitized summaries
confirmed matching sender/recipient currencies, positive recipient amounts, correct rate directions,
and rate timestamps. Every response returned only `STANDARD`; Plus/Premium/Metal/Ultra must remain
unavailable unless their exact plan objects appear. Multi-plan fixtures exercise the strict contract
but are not evidence of current live plan availability.

A 2026-07-16 investigation established that the earlier apparent whole-EUR HUF→EUR recipient values
were caused by failing to decode fixed hundredths. The adapter now uses the endpoint recipient after
decoding and does not reconstruct it from the opposite direction or a market rate.

A 2026-07-16 investigation established that the earlier weekday fee gap was caused by incorrect
units: requests sent `972` rather than `97200`, so the endpoint priced 9.72 EUR. Correctly scaled
amount-specific requests return the dynamic Standard fee seen by the public converter. Do not
hard-code a threshold or add a safety margin. Weekday quotes use the decoded endpoint fee and may
rank. `FULL_ALLOWANCE_ASSUMED` remains because account-specific prior usage is still unavailable.

The no-cookie live probe at 2026-07-16T14:30:38Z returned HTTP 200 throughout. At the then-current
rate (~359.67 HUF/EUR), decoded Standard results were: 968 EUR → 348,162.40 HUF / 0.04 EUR fee;
969 → 348,522.08 / 0.05; 970 → 348,881.27 / 0.06; 971 → 349,240.94 / 0.07; 972 → 349,600.61 /
0.08; 973 → 349,960.28 / 0.09; 974 → 350,319.95 / 0.10. The same run returned 1,000 HUF →
2.74 EUR and 100,000 HUF → 274.89 EUR with zero Standard fee. These values are time-specific
evidence, not fixed thresholds. Each request used `displayed major amount × 100` and each response
money field was divided by 100.

Until a controlled weekend probe verifies endpoint coverage, all Revolut plans are similarly
excluded from ranking between Friday 17:00 ET and Sunday 18:00 ET. Evaluate this interval using the
IANA `America/New_York` timezone, including DST transition weekends. Never derive a weekend fee
locally from this classification.

The result exposes selected plan, raw/effective rates, FX and total fee, fee currency, total
source-side cost, tooltips, source/retrieval timestamps and an indicative warning. Revolut's legal page separately notes a
conditional Hungarian migration-linked special transaction fee. Because public request context
cannot establish its activation for a customer, NeoRate does not calculate it and requires final
verification in the Revolut app.

The registration is disabled by default. Without `REVOLUT_ADAPTER_ENABLED=true`, an explicit
Revolut selection returns a numeric-field-free unavailable result and makes no endpoint request. Enable
the flag only in controlled staging until server-side access, schema success and legal/product
approval satisfy the approval gate. The registry's 10-second Revolut deadline does not change the
2-second service default used by other providers.

The gate is typo-safe: only exact lowercase `true` enables Revolut. Missing, empty, `false`, `yes`,
`1`, `TRUE`, or any other value disables it without throwing or blocking other providers. An
unrecognized non-empty value may be logged server-side.

Comparison uses `rankingEffectiveRate = targetAmount / totalSourceCost` when this validated
source-currency Revolut cost exists. Providers without that optional field use
`targetAmount / sourceAmount`. Sort descending; exact ties use ascending provider ID. A malformed,
zero, or wrong-currency supplied cost is invalid rather than silently ignored. A Revolut result with
`FULL_ALLOWANCE_ASSUMED` remains visible but is an optimistic best-case quote. Only an eligible
weekday result can receive the explicitly qualified badge; an incomplete-fee row receives no best
badge even when its numeric payout is largest. Final app verification remains mandatory.

## ZEN.COM ZEN Pro public converter

ZEN Pro uses only `POST https://www.zen.com/landing_currencies.php` with source-driven
`application/x-www-form-urlencoded` fields: `action=change_currency`, allowlisted EUR/HUF source and
target currencies, exact two-decimal `amount`, and `endpoint=change_currency`. Do not use
`get_currencies.php`; it is reference/history input, not the ZEN Pro customer quote used here.

The endpoint belongs to ZEN.COM's official public converter but is undocumented as an external API,
so valid observations are `LIVE_UNOFFICIAL`, medium reliability, plan `ZEN Pro`, and always
indicative. The official public converter states that its displayed rate and fee apply to ZEN Pro,
that the margin is included in the rate, and that the additional ZEN fee is 0%. Preserve
`data.exchangeRate` as the primary directional rate. Preserve `data.targetAmount` as the rounded
endpoint payout, but never derive the primary rate from it. For HUF→EUR, `1 / exchangeRate` may be
shown separately as HUF per EUR; never use that reciprocal as a substitute for an independently
retrieved EUR→HUF quote.

The client runs server-side through an injectable transport with a 2.5-second timeout, manual
redirect handling, 64 KiB response limit, JSON content-type check, strict Zod field validation and
decimal.js positivity, plausibility, request-amount and target/rate consistency checks. It sends only
JSON accept, form content type and an identifying NeoRate User-Agent. It must never send or retain
cookies, authorization, Cloudflare tokens, Referer, browser/session identifiers or personal data.

The `alternatives` array is untrusted comparison content. Ignore it completely for normalization:
ZEN-hosted Revolut and Wise values are not authoritative Revolut/Wise sources and cannot create,
replace or influence their provider rows. A 403, timeout, malformed/non-JSON body, missing or invalid
`exchangeRate`, inconsistent amount or other transport/schema failure returns a numeric-field-free
unavailable result. No mock, neutral market rate, competitor value, inverse opposite direction or
other fallback is allowed. The plan milestone adds amount/pair-specific fresh, negative,
last-known-good stale and single-flight cache handling; stale observations never rank best.

The source does not return a rate timestamp. Use retrieval time as both the observation timestamp
and retrieval timestamp while preserving `rateTimestampBasis =
RETRIEVAL_TIME_SOURCE_HAS_NO_TIMESTAMP`; never imply it came from ZEN's payload.

Current low-volume evidence does not support enablement. On 2026-07-19, six one-variable Node header
variants and a combined request returned Cloudflare HTTP 403 with HTML; the combined reverse-direction
request and a minimal curl control did the same. Accept, Origin, calculator Referer, descriptive
User-Agent, Accept-Language and the ordinary AJAX marker did not produce quote data. No cookie/token,
proxy or fingerprint workaround was attempted. `ZEN_ADAPTER_ENABLED` is therefore disabled by
default; only exact lowercase `true` enables a controlled-environment probe. Missing, empty, false
or malformed values disable safely. See `ZEN_ENDPOINT_INVESTIGATION.md` for sanitized evidence.

## Wise comparison endpoint — investigation only

Wise is not a registered NeoRate provider. The 2026-07-16 investigation of
`GET https://wise.com/gateway/v4/comparisons` produced a `PROCEED_WITH_RESTRICTIONS` verdict, not
adapter approval. Minimal server-side requests worked without cookies, authorization, browser
identifiers, or `x-access-token`, and both supported directions produced mathematically consistent
comparison results for the tested supported amounts. However, 100 HUF returned HTTP 200 without a
Wise provider, the contract is undocumented, and the result is not proven account- or
payment-method-specific.

Any future client must conservatively send `sourceCountry=HU`, `filter=POPULAR`,
`includeWise=true`, and `numberOfProviders=3`; select only exact `alias === "wise"`; require exactly
one understandable quote; validate decimal reconciliation and timestamp age; and fail closed when
the provider is absent even on HTTP 200. Other providers returned by Wise's comparison endpoint are
not authoritative integration sources for NeoRate.

The isolated parser and sanitized fixtures under `src/providers/wise` make no network calls and are
not connected to the provider registry, API, UI, or ranking. The opt-in
`pnpm investigate:wise` command is never run by normal CI. Read
[`WISE_ENDPOINT_INVESTIGATION.md`](./WISE_ENDPOINT_INVESTIGATION.md) before proposing a separate
`LIVE_UNOFFICIAL` adapter. Legal/product review, staging evidence, explicit indicative labeling, and
a conservative initial 60-second cache are required first.

## Provider-independent plan quotes (2026-07-17)

The global ranking uses exactly one default quote per provider: ZEN Free and Revolut Standard. Paid
plans live only under `planQuotes`, never receive a separate global rank, and show monthly fees as
metadata rather than allocating them to one exchange.

The ZEN public calculator explicitly describes its quote as ZEN Pro. Official pricing retrieved
2026-07-17 defines Free/Gold/Platinum/Pro markups of 0.50%/0.20%/0%/0%, monthly fees of
0/0.90/6.90/6.90 EUR, and an off-market +0.40% for all except Pro. Preserve Pro's live
`data.exchangeRate`; NeoRate currently interprets “ZEN Rate + X%” as
`calculationRate = proRate / (1 + totalMarkup)`. This is an estimate pending validation against a
real plan-specific quote; `proRate × (1 - totalMarkup)` remains the documented alternative. The
official help text literally says Friday 21:00 CET–Sunday 22:00 CET, so the window is fixed UTC+1
year-round. Pro is live; all other ZEN plan rows are policy-derived. Pro alone uses the endpoint's
rounded target amount; derived payouts are rounded down with decimal.js to the target scale (EUR 2,
HUF 0), and effective rate is recomputed from the rounded payout. Rate markups carry no fabricated separate
monetary fee field. Off-market classification uses the current request timestamp, not a cached
observation timestamp, and stale Free observations remain visible but ranking-excluded. The ZEN
cache is exact pair/amount scoped: 60s fresh, 30s negative, 15m stale, and single-flight. Competitor
alternatives remain untrusted.

`ESTIMATED` quotes are not globally rankable by source type alone. ZEN Free may populate
`bestProviderId` only while it is the disclosed default plan, `AVAILABLE`, `FRESH`, explicitly
`ELIGIBLE`, and has a valid positive cost-normalized rate. Its winning badge must say that it is an
estimated indicative result. Paid, stale, failed, undisclosed or excluded plan quotes cannot win.

For Revolut, fixture reconciliation proves fee-on-top semantics inside Standard. A controlled
2026-07-17 matrix did not prove a common plan-independent base rate: 350,000 HUF and 400,000 HUF had
different rates at the same source timestamp, and only Standard was returned. Every paid plan is
therefore numeric-field-free unavailable; official subscription and allowance metadata remains
visible. Weekend Standard stays excluded until issue #5. No manual fair-usage, weekend, or special
Hungarian fee is added to a live quote.
