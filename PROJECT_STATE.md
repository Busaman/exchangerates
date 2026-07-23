# NeoRate project state

Last updated: 2026-07-23

## Runtime providers

- Deterministic mock: implemented for development and tests.
- Unavailable example: implemented for failure-contract coverage.
- Revolut Personal Hungary: implemented as gated `LIVE_UNOFFICIAL`; disabled by default.
- ZEN.COM plans: live Pro transport plus derived Free/Gold/Platinum quotes, cache, API/UI contract
  and tests implemented; cookie-free local and protected-Preview smoke tests pass, but the adapter
  remains disabled by default pending review.
- Wise Personal: implemented as gated `LIVE_UNOFFICIAL` public comparison quote; disabled by default
  pending protected-Preview and legal/product verification.

## Wise status

- Source: `GET https://wise.com/gateway/v4/comparisons`.
- Scope: EUR→HUF and HUF→EUR for Hungary; Personal / Alapárazás only.
- Semantics: total source debit in `amount`, included source-currency fee in `fee`, pre-fee
  directional `rate`, net payout in `receivedAmount`. The fee is used exactly once.
- Classification: indicative `LIVE_UNOFFICIAL` bank-transfer comparison, not account-specific or an
  executable transfer quote.
- Validation: exact `alias === "wise"`, one provider and one quote, country/pair/amount/timestamp
  checks and decimal-safe payout reconciliation. HTTP 200 without Wise fails closed.
- Cache: exact canonical amount/pair/HU key, 60s fresh, 30s negative, 15m stale, single-flight.
- Gate: only exact `WISE_ADAPTER_ENABLED=true`; default and malformed values disable safely.

## ZEN plan status

- Source: `POST https://www.zen.com/landing_currencies.php`.
- Scope: EUR→HUF and HUF→EUR; live Pro base plus official Free/Gold/Platinum derivation.
- Primary rate: `data.exchangeRate`; never reconstructed from rounded `data.targetAmount`.
- Classification: Pro base `LIVE_UNOFFICIAL`; Free/Gold/Platinum derived; top-level Free
  `ESTIMATED`. App verification required.
- Transport: server-only native Node HTTPS behind a replaceable boundary, 2.5-second timeout, 64 KiB
  cap, no cookie/auth/browser identity, response cookies discarded, strict response and decimal
  validation. The quote route is pinned to Node runtime. Final headers are Content-Type,
  Content-Length, honest NeoRate User-Agent and the required official-page Referer only.
- Failure behavior: numeric-field-free unavailable; no mock, market, reciprocal-opposite-direction,
  or competitor fallback. Cache: 60s fresh, 30s negative, 15m stale, single-flight.
- Derived rates use NeoRate's documented `proRate / (1 + markup)` interpretation; this remains an
  estimate until a real plan-specific quote validates it. Derived payouts round down to EUR 2/HUF 0,
  and effective rates are recomputed from those stored payouts. Rate markups are not represented as
  fabricated monetary fees. The official CET wording is interpreted as fixed UTC+1 year-round.
  Off-market classification uses request time and stale Free observations cannot rank.
- Gate: only exact `ZEN_ADAPTER_ENABLED=true` enables retrieval; default is disabled.
- Current local evidence (2026-07-19): Undici `fetch` was blocked with Cloudflare HTTP 403, while
  curl and native Node HTTPS from the same host returned HTTP 200 JSON without a preliminary GET,
  cookie, nonce or CSRF token. A five-request native matrix passed at 1,000/9,000/100,000 HUF and
  10/1,000 EUR. The response's `__cf_bm` cookie was discarded and was not required for success.
- Protected Preview evidence (2026-07-19): the minimal-header hardening deployment
  `dpl_Bxrve4xsKiaAr5z7F2PquuepfuZ3` in Vercel `iad1` returned fresh successful HUF→EUR and EUR→HUF
  NeoRate quotes. The temporary Preview-only flag was removed immediately; production still has no
  ZEN environment flag.

## Validation state

The ZEN tests cover successful normalization, exact form construction, native transport header and
cookie isolation, inverse-rate metadata,
missing/malformed/non-positive rates, malformed JSON, HTTP 403, timeout, exact amount precision,
adapter contract compliance, numeric-field-free unavailability, feature-gate safety, and strict
isolation of the untrusted Revolut/Wise `alternatives` rows. Plan-policy coverage also pins exact
derived payout behavior, cache-boundary pricing windows, stale ranking exclusion, and fail-closed
calculation errors. HTTP 204/304, empty HTTP 200, protocol-failure cache/single-flight release and the
Node route runtime are covered deterministically.

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

Deploy the Fintech v2 three-provider branch to protected Preview with all three provider gates enabled
only in Preview. Smoke-test HUF→EUR and EUR→HUF, keep production unchanged, and return the new draft
PR for review.
