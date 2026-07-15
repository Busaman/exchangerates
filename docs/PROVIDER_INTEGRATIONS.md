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

Returned sender amount and currency direction must match exactly. Current live HUF→EUR responses may
truncate `recipient.amount` to whole EUR, including zero for a positive small quote. Treat that field
as a display consistency signal: it must be within one target display unit of `sender × rawRate`.
Normalize the indicative target with decimal.js as `sender × rawRate`, rounded down to the target
currency scale, and preserve both the original endpoint recipient and
`targetAmountCalculation: RAW_RATE_ROUNDED_DOWN`. Fee currency checks remain exact; source-cost
arithmetic uses only the minor-unit tolerance below.

Because endpoint monetary values use display precision, `fees.cost` may differ from
`sender.amount + fees.total` by at most one source-currency minor unit: 1 HUF or 0.01 EUR. The
boundary is inclusive; a larger difference is invalid. The returned cost is preserved unchanged.

Fixtures under `src/providers/revolut/fixtures` are sanitized JSON contract examples. Unit tests
never call Revolut. The optional `pnpm test:revolut:live` script runs only with
`REVOLUT_LIVE_TEST_ENABLED=true` and prints sanitized summaries. The client uses a 2.5-second
per-attempt timeout, two bounded retries, 60-second fresh cache, 30-second negative cache,
amount/direction/plan-specific single-flight and a 15-minute stale ceiling. Negative results suppress
retry storms but do not renew timestamps or stale age. Only a last successful observation for the
same material request can become `STALE`; it is never ranked.

The source amount in the cache key is normalized with decimal.js before key creation. Adjacent values
such as A and A+1 therefore have distinct fresh, negative, stale, and in-flight entries; only decimal
spellings of the same exact value can share work.

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

Follow-up live evidence on 2026-07-15 showed whole-EUR HUF→EUR recipient displays: `0` for 100 HUF,
`2` for 1,000 HUF, `27` for 10,000 HUF, and `67` around 24,560 HUF, while the raw directional rate
remained positive and internally consistent within one displayed EUR. The former 0.5% relative check
therefore produced a false amount threshold and has been replaced by the one-display-unit guard and
transparent rate-derived payout normalization. This does not infer the opposite currency direction.

Separate live evidence on 2026-07-15 found the official EUR→HUF converter UI at zero fee for
968–971 EUR and at 0.01/0.02/0.03 EUR for 972/973/974 EUR. The threshold is dynamic. Exact
source-driven public JSON requests for 968–974 all returned HTTP 200 but Standard `fees.fx = 0`,
`fees.total = 0`, and `fees.cost = sender.amount`. This is a source-contract limitation, not a cache
hit: each amount has a separate key and source URL. Do not hard-code the observed threshold, parse
HTML, or reconstruct an authoritative Revolut fee locally. The endpoint fee is preserved exactly as
source-reported, but is not assumed complete. Keep the quote visibly `FULL_ALLOWANCE_ASSUMED` and
verify final fees in the app until controlled staging identifies an official machine-readable
request context that reproduces the converter.

Use the documented allowance policy only as a fail-safe ranking gate, never as a substitute fee.
For weekday Standard/Plus, calculate zero-usage allowance consumption in HUF from the HUF source
amount or from EUR source amount times the same directional Revolut rate. If it exceeds 350,000 HUF
or 1,050,000 HUF respectively, return the quote with
`rankingStatus = EXCLUDED_INCOMPLETE_FEES`, reason `FAIR_USAGE_FEE_NOT_RETURNED`, and the explicit
missing-fee warning. It remains visible but cannot win. At or below the boundary it may rank as a
qualified best-case quote. Premium/Metal/Ultra remain eligible on weekdays. Exact-boundary and
synthetic adjacent-amount tests must not be presented as live threshold evidence.

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
