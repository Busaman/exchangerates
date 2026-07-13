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
