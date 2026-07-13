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
8. Add a `ProviderRegistration` to `providerRegistry` with status `SUPPORTED` or `UNAVAILABLE`.
   Do not add provider-specific conditionals to the quote service or API route.

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

Scope is personal customers only: `STANDARD`, `PLUS`, `PREMIUM`, `METAL`, and `ULTRA`, with explicit
plan and `monthlyExchangeUsedHuf` context. Revolut Business, Pro, merchant/corporate products,
authenticated accounts, private endpoints and reciprocal inference are prohibited.

Approved rate pages:

- `https://www.revolut.com/hu-HU/currency-converter/convert-eur-to-huf-exchange-rate/`
- `https://www.revolut.com/hu-HU/currency-converter/convert-huf-to-eur-exchange-rate/`

Fee policy sources:

- `https://help.revolut.com/hu-HU/help/wealth/exchanging-money/how-much-does-it-cost-to-make-an-exchange/will-i-be-charged-for-exchanging-foreign-currencies/`
- `https://www.revolut.com/hu-HU/legal/standard-fees/`

There is no documented public personal Revolut quote API. The official page is not a documented
machine contract, so parsed rates are `LIVE_UNOFFICIAL`, medium-reliability and explicitly
indicative. Preserve exact URL, page timestamp and retrieval timestamp. The runtime uses plain HTTP
only; if Revolut returns a challenge/access page, parsing fails and no fallback is allowed. Current
manual evidence showed browser-accessible `__NEXT_DATA__` with independent `from`, `to`, `rate`,
`timestamp`, `senderAmount`, and `recipientAmount`, while generic and browser-header server requests
returned HTTP 403 security/access pages. This fragility is expected and must be monitored.

Parser fixtures under `src/providers/revolut/fixtures` are sanitized minimal HTML documents, not
full-page captures. Tests never call Revolut. The rate source uses a NeoRate-identifying User-Agent,
2.5-second per-attempt timeout, two bounded retries, 60-second fresh cache and 15-minute stale ceiling. Only a last
successful observation can become `STALE`; it is never ranked. Wrong direction, challenge content,
missing/invalid structured data, stale/future timestamp, internally inconsistent amounts and
configured implausible rates all become unavailable with no substituted value.

Fee order is:

1. Calculate quote allowance consumption in HUF (HUF source directly; EUR source times the current
   directional page rate solely for allowance accounting).
2. Calculate fair-usage fee in source currency only on the part above remaining monthly allowance.
3. Calculate the 1% weekend fee independently on the full source amount during Friday 17:00 through
   Sunday 18:00 `America/New_York` (`[Friday 17:00, Sunday 18:00)`, DST-aware).
4. Add `fairUsageFee + weekendFee`, subtract once from source, multiply by the directional base rate,
   then round final target payout down to target scale. Do not round intermediate decimals.

The result exposes both fee components, total, fee currency, plan, allowance before/consumed/after,
market session, base/effective rates and indicative warning. Revolut's legal page separately notes a
conditional Hungarian migration-linked special transaction fee. Because public request context
cannot establish its activation for a customer, NeoRate does not calculate it and requires final
verification in the Revolut app.
