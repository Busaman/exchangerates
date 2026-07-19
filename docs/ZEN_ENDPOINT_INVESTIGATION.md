# ZEN public converter transport investigation

## Status

**Verdict: OPERATIONAL IN CONTROLLED ENVIRONMENTS, STILL PRODUCTION-DISABLED.** On 2026-07-19 a
legitimate, cookie-free native Node HTTPS transport returned validated ZEN Pro quotes locally and
from protected Vercel Preview. No Cloudflare challenge was bypassed, no browser/user cookie was used,
and no session material is retained. The source remains undocumented `LIVE_UNOFFICIAL`, PR #8 remains
draft, and production enablement still requires legal/product and operational approval.

## Current public calculator contract

The following current public pages were inspected:

- https://www.zen.com/currency-converter/
- https://www.zen.com/online-currency-exchange/
- https://www.zen.com/hu/online-valutavalto/

Browser observations loaded each requested page directly without a cross-origin redirect. They all
loaded the ZEN-owned bundle
`/wp-content/cache/min/1/wp-content/themes/zen/kursywalut/handleConverterOnLandingPage.js`. Public page
configuration still identifies `https://www.zen.com/landing_currencies.php` as the quote URL. The
bundle uses the source-driven form fields `action`, `sourceCurrency`, `targetCurrency`, `amount` and
`endpoint`; `get_currencies.php` remains separate chart/history input.

The current calculator request remains:

```text
POST https://www.zen.com/landing_currencies.php
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

action=change_currency&sourceCurrency=HUF&targetCurrency=EUR&amount=1000.00&endpoint=change_currency
```

The page exposes a public WordPress `nonce` field among general page configuration, but the converter
bundle did not reference it and a direct quote POST succeeded without it. No calculator CSRF field,
calculator identifier, version field, locale field, market field, alternate first-request endpoint,
or JavaScript cookie access was found in the current calculator bundle. No sensitive value was
recorded or committed.

The public calculator says the first calculation starts a session in which rates are temporarily
stored. Controlled HTTP evidence shows this does not require an HTTP application session for the
quote request: the first stateless POST succeeded without a preceding page GET or Cookie header.
NeoRate therefore does not create or retain a calculator cookie jar at runtime.

The official plan/rate policy sources remain:

- https://www.zen.com/hu/online-valutavalto/
- https://ask.zen.com/hc/en-us/articles/11817930934300-What-exchange-rates-are-applied-to-my-transactions
- https://www.zen.com/files/pricing/individual_pricing.pdf

## Transport and anonymous-session evidence

Runtime: Node 26.4.0 and curl from the same Windows machine. Requests were sequential, used a
five-second investigation timeout and a 256 KiB cap, and logged only status, timing, schema class,
cookie names and sanitized quote fields.

| Flow                                            | Preliminary GET          | Cookie sent   | Result                     | Interpretation                                    |
| ----------------------------------------------- | ------------------------ | ------------- | -------------------------- | ------------------------------------------------- |
| Undici `fetch` public-page GET                  | n/a                      | none          | HTTP 403 HTML              | blocked before an application session could start |
| Undici `fetch` quote POST                       | attempted page GET first | none accepted | HTTP 403 HTML              | same fetch transport remained blocked             |
| curl page GET with ordinary public-page headers | yes                      | none          | HTTP 200 HTML, no redirect | public page accessible without a challenge cookie |
| curl quote POST using its temporary empty jar   | yes                      | none          | HTTP 200 JSON              | no session cookie was issued or required          |
| curl direct quote POST                          | no                       | none          | HTTP 200 JSON              | preliminary GET is not required                   |
| Node native `https.request` direct POST         | no                       | none          | HTTP 200 JSON              | selected production transport                     |

The exact Cloudflare rule that distinguishes Undici from curl/native Node HTTPS is not observable.
The evidence establishes a transport-path compatibility issue, not a missing CSRF/session contract.
NeoRate does not spoof a browser fingerprint; it uses Node's standard HTTPS client and the small set
of semantically correct public-calculator headers: JSON/AJAX Accept, Hungarian Accept-Language,
form Content-Type, official Origin/Referer, descriptive User-Agent and `X-Requested-With`.

## Cookies and state classification

Only cookie names were recorded:

| Cookie name                | Observed on                                                       | Classification                                          | Runtime behavior            |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| `__cf_bm`                  | blocked Undici response and successful native Node quote response | Cloudflare Bot Management / uncertain anti-bot state    | rejected and discarded      |
| `cf_clearance`             | never observed                                                    | forbidden challenge clearance                           | would be rejected           |
| application session cookie | not observed                                                      | potentially acceptable only if independently classified | not implemented or retained |
| affinity cookie            | not observed                                                      | potentially acceptable only if independently classified | not implemented or retained |

The successful native request received `__cf_bm` only after the response; the request had already
succeeded without it. It is neither necessary nor reused. The transport exposes only Content-Type
and Content-Length to parsing code, so Set-Cookie cannot enter caches, logs or the public API.
NeoRate never forwards a Cookie supplied by its own users.

## Local validation matrix

All five native Node HTTPS requests returned HTTP 200 `application/json`, passed strict response
validation, and reconciled `sourceAmount × exchangeRate` to the rounded `targetAmount` within the
target currency tolerance.

| Direction |         Source |         Target | `data.exchangeRate` | Latency |
| --------- | -------------: | -------------: | ------------------: | ------: |
| HUF→EUR   |   1,000.00 HUF |       2.74 EUR |            0.002748 |  677 ms |
| HUF→EUR   |   9,000.00 HUF |      24.72 EUR |            0.002747 |  339 ms |
| HUF→EUR   | 100,000.00 HUF |     274.80 EUR |            0.002748 |  390 ms |
| EUR→HUF   |      10.00 EUR |   3,613.80 HUF |          361.380755 |  347 ms |
| EUR→HUF   |   1,000.00 EUR | 361,380.75 HUF |          361.380755 |  309 ms |

The response continued to contain alternatives labeled Revolut, Wise and ZEN. These aliases were
recorded only as schema evidence. Runtime normalization ignores the entire alternatives collection;
it cannot create or modify NeoRate Revolut/Wise observations.

Local NeoRate API smoke requests returned `SUCCESS`, `FRESH` and `bestProviderId=ZEN` in both
directions without a 500. The top-level result is the explicitly `ESTIMATED` Free plan derived from
the validated live Pro base; the provider details preserve the Pro `LIVE_UNOFFICIAL` observation.

## Protected Preview evidence

Deployment `dpl_AP1oHFDzU5N7CTZrQfyNhQVP7A3s` ran the working PR branch in Vercel `iad1`. Exact
`ZEN_ADAPTER_ENABLED=true` was set temporarily for Preview only.

| Direction     | NeoRate HTTP | Result                       | Freshness | Numeric result          |
| ------------- | -----------: | ---------------------------- | --------- | ----------------------- |
| 1,000 HUF→EUR |          200 | `SUCCESS`, best provider ZEN | `FRESH`   | Free estimate 2.72 EUR  |
| 10 EUR→HUF    |          200 | `SUCCESS`, best provider ZEN | `FRESH`   | Free estimate 3,581 HUF |

The Preview flag was removed immediately after the smoke test. Production has no ZEN environment
variable and was never modified. The protected deployment URL is retained only as test evidence; it
does not imply production approval.

## Implementation decision

The smallest correct runtime change is to replace the blocked Undici transport with a standard Node
HTTPS transport behind the existing injectable boundary. No anonymous session manager is needed.
Quote cache and transport state remain separate; there is no session state. Existing exact
pair/amount fresh, negative, stale and single-flight behavior is unchanged, and stale results remain
ranking-ineligible.

The investigation-only cookie policy and tests document how a future page flow would fail closed,
but runtime never consumes those cookies. Challenge HTML, redirects, oversized responses, 403/429,
timeouts, malformed JSON/schema/rates and inconsistent amounts remain sanitized failures with no
numeric fallback.

## Remaining risks and approval gate

- `landing_currencies.php` is public and ZEN-owned but undocumented as an external API.
- Cloudflare behavior or the public bundle contract may change without notice.
- A short successful matrix does not establish long-term rate-limit or availability SLOs.
- Free/Gold/Platinum remain policy-derived estimates; only Pro is the public live base observation.
- Legal/product approval and longer staging comparison against the official calculator remain
  required.
- `ZEN_ADAPTER_ENABLED` must stay absent/false in production until an explicit later decision.

The technical verdict is therefore **PROCEED_WITH_RESTRICTIONS**: PR #8 may return for review as an
operational, gated implementation, but production stays disabled and every executable result must be
verified with ZEN.
