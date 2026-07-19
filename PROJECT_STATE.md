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
- Derived rates use NeoRate's documented `proRate / (1 + markup)` interpretation; this remains an
  estimate until a real plan-specific quote validates it. Derived payouts round down to EUR 2/HUF 0,
  and effective rates are recomputed from those stored payouts. Rate markups are not represented as
  fabricated monetary fees. The official CET wording is interpreted as fixed UTC+1 year-round.
  Off-market classification uses request time and stale Free observations cannot rank.
- Gate: only exact `ZEN_ADAPTER_ENABLED=true` enables retrieval; default is disabled.
- Current local evidence (2026-07-19): all seven sequential Node variants returned Cloudflare HTTP
  403 HTML (24–207 ms), including the justified combined request in both directions. A minimal curl
  control also returned 403 in 117 ms. No cookies, Cloudflare tokens, session data, browser
  automation, proxy, or fingerprint spoofing were used.
- Protected Preview evidence (2026-07-19): deployment `dpl_DkUHYvPtEKZx6TqLowjyLjTpo913` in Vercel
  `iad1` returned the same explicit upstream HTTP 403 unavailable result for HUF→EUR and EUR→HUF.
  The temporary Preview-only flag was removed immediately; production had no ZEN environment flag.

## Validation state

The new ZEN tests cover successful normalization, exact form construction, inverse-rate metadata,
missing/malformed/non-positive rates, malformed JSON, HTTP 403, timeout, exact amount precision,
adapter contract compliance, numeric-field-free unavailability, feature-gate safety, and strict
isolation of the untrusted Revolut/Wise `alternatives` rows. Plan-policy coverage also pins exact
derived payout behavior, cache-boundary pricing windows, stale ranking exclusion, and fail-closed
calculation errors.

## Plan quote policy

- Global ranking uses ZEN Free and Revolut Standard only. A fresh, available, eligible ZEN Free
  estimate may win, but the badge is explicitly qualified as estimated and indicative.
- ZEN Free/Gold/Platinum derive from unchanged live Pro rate and official markups.
- Revolut Standard stays live and untouched. Fee-on-top semantics are proven inside Standard, but
  a common plan-independent base rate is not; every paid plan therefore fails closed numerically.
- Paid plans never receive a global rank and their monthly subscription is not charged to one
  exchange.
- Official pricing sources were retrieved 2026-07-17. Both live providers remain undocumented,
  `LIVE_UNOFFICIAL`, production-default-off, and require staging/legal/product review.

## Next action

Do not merge PR #8 as a completed ZEN feature: local and protected Preview server runtimes both
receive Cloudflare HTTP 403. Prefer splitting reusable plan architecture/Revolut-safe changes from
the dormant ZEN runtime if that architecture is independently valuable. Keep ZEN default-off unless
a future legitimate, minimal, cookie-free source becomes operational and passes legal/product review.
