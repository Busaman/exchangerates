# NeoRate project state

Last updated: 2026-07-17

## Runtime providers

- Deterministic mock: implemented for development and tests.
- Unavailable example: implemented for failure-contract coverage.
- Revolut Personal Hungary: implemented as gated `LIVE_UNOFFICIAL`; disabled by default.
- ZEN.COM plans: live Pro transport plus derived Free/Gold/Platinum quotes, cache, API/UI contract and tests implemented;
  disabled by default because current cookie-free server-side probes did not return a valid quote.
- Wise: investigation/parser only; not registered or exposed at runtime.

## ZEN plan status

- Source: `POST https://www.zen.com/landing_currencies.php`.
- Scope: EUR→HUF and HUF→EUR; live Pro base plus official Free/Gold/Platinum derivation.
- Primary rate: `data.exchangeRate`; never reconstructed from rounded `data.targetAmount`.
- Classification: Pro base `LIVE_UNOFFICIAL`; Free/Gold/Platinum derived; top-level Free
  `ESTIMATED`. App verification required.
- Transport: server-only, replaceable, 2.5-second timeout, 64 KiB cap, no cookie/auth/browser
  identity, strict response and decimal validation.
- Failure behavior: numeric-field-free unavailable; no mock, market, reciprocal-opposite-direction,
  or competitor fallback. Cache: 60s fresh, 30s negative, 15m stale, single-flight.
- Derived payouts use exact decimal multiplication from the Pro rate and official markup; only Pro
  preserves the endpoint-rounded payout. Rate markups are not represented as fabricated monetary
  fees. Off-market classification uses request time and stale Free observations cannot rank.
- Gate: only exact `ZEN_ADAPTER_ENABLED=true` enables retrieval; default is disabled.
- Current live evidence (2026-07-17): literal minimal request returned HTTP 403 (~106 ms). An
  identifying NeoRate User-Agent reached HTTP 200 (~168–259 ms) but received the 16-byte error
  envelope `{"error":"1..."}`. Adding the public page's ordinary AJAX marker did not change it.
  No cookies, Cloudflare tokens, Referer, session data, or browser automation were used.

## Validation state

The new ZEN tests cover successful normalization, exact form construction, inverse-rate metadata,
missing/malformed/non-positive rates, malformed JSON, HTTP 403, timeout, exact amount precision,
adapter contract compliance, numeric-field-free unavailability, feature-gate safety, and strict
isolation of the untrusted Revolut/Wise `alternatives` rows. Plan-policy coverage also pins exact
derived payout behavior, cache-boundary pricing windows, stale ranking exclusion, and fail-closed
calculation errors.

## Plan quote policy

- Global ranking uses ZEN Free and Revolut Standard only.
- ZEN Free/Gold/Platinum derive from unchanged live Pro rate and official markups.
- Revolut Standard stays live and untouched. Fee-on-top semantics are proven inside Standard, but
  a common plan-independent base rate is not; every paid plan therefore fails closed numerically.
- Paid plans never receive a global rank and their monthly subscription is not charged to one
  exchange.
- Official pricing sources were retrieved 2026-07-17. Both live providers remain undocumented,
  `LIVE_UNOFFICIAL`, production-default-off, and require staging/legal/product review.

## Next action

Run a controlled low-volume staging probe of the cookie-free ZEN transport. Do not enable ZEN in
production unless staging returns stable validated quotes and legal/product review approves reliance
on the undocumented public webpage endpoint.
