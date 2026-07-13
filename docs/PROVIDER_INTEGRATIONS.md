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
- request headers: `Accept: application/json` and the non-deceptive NeoRate User-Agent only
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

Returned sender amount and currency direction must match exactly. The only numerical tolerance is a
configurable 0.5% relative check between raw rate and actual recipient/sender, allowing for the
endpoint's displayed recipient precision; normalization never changes the endpoint values. Fee
currency and total source-side cost checks are exact decimal identities.

Fixtures under `src/providers/revolut/fixtures` are sanitized JSON contract examples. Unit tests
never call Revolut. The optional `pnpm test:revolut:live` script runs only with
`REVOLUT_LIVE_TEST_ENABLED=true` and prints sanitized summaries. The client uses a 2.5-second
per-attempt timeout, two bounded retries, 60-second fresh cache, 30-second negative cache,
amount/direction/plan-specific single-flight and a 15-minute stale ceiling. Negative results suppress
retry storms but do not renew timestamps or stale age. Only a last successful observation for the
same material request can become `STALE`; it is never ranked.

For a successful quote, select exactly the requested plan and validate `fees.fx`, `fees.total`, and
`fees.cost`. Their currencies must equal the source currency, total fee cannot be below FX fee, and
total source-side cost must equal sender amount plus total fee. Use the endpoint's actual recipient
amount; derive effective rate with decimal.js. Do not manually add fair-usage/weekend fees or apply a
second payout calculation.

The endpoint has no authenticated account or prior-usage input and therefore cannot know actual
rolling-30-day allowance usage. NeoRate has removed the old usage field rather than claim false
account-specific accuracy or double-charge endpoint fees. Results state `FULL_ALLOWANCE_ASSUMED` and
must be checked in-app. Sanitized fixtures cover zero and non-zero per-plan fee objects, but the
2026-07-13 live probe returned HTTP 400 (`Required 'localeCode' is missing`) for the required
no-cookie request. Below/above-allowance and weekday/weekend behavior are not live-verified until the
exact non-speculative request contract is confirmed in staging.

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
