# ZEN public converter transport investigation

## Status

**Verdict: BLOCKED — unresolved Cloudflare/server-environment restriction.** ZEN remains default-off,
PR #8 remains draft, and no production enablement is justified. This report contains only sanitized,
low-volume evidence and no cookies, tokens, personal identifiers, raw response bodies or bypasses.

## Public contract evidence

Investigation date: 2026-07-19. The official public converter page exposes
`https://www.zen.com/landing_currencies.php` as its calculator API URL and separately references
`get_currencies.php` for chart/history data. The observed quote contract remains a source-driven
form POST with `action=change_currency`, `sourceCurrency`, `targetCurrency`, two-decimal `amount`,
and `endpoint=change_currency`. Public page HTML exposes a WordPress nonce for other page functions,
but no evidence established that the calculator request sends or requires it. No alternate quote
endpoint was observed.

The official help article states: “Weekend currency exchange fee (from Friday 21:00 CET to Sunday
22:00 CET).” NeoRate treats CET literally as fixed UTC+1 year-round. The same source describes the
plan adjustment as “ZEN Rate + X%”; it does not establish the exact target-rate formula.

Sources:

- https://www.zen.com/gb/online-currency-exchange/
- https://ask.zen.com/hc/en-us/articles/11817930934300-What-exchange-rates-are-applied-to-my-transactions
- https://www.zen.com/files/pricing/individual_pricing.pdf

## Local request matrix

Runtime: Node 26.4.0 and curl from the same Windows machine. Requests were sequential. Node timeout
was 5 seconds, redirects were manual, and response size was capped at 64 KiB.

| Variant                            | Direction | Status | Content type | Response class   | Latency |
| ---------------------------------- | --------- | -----: | ------------ | ---------------- | ------: |
| Minimal form POST                  | HUF→EUR   |    403 | text/html    | Cloudflare block |  207 ms |
| Browser-compatible Accept only     | HUF→EUR   |    403 | text/html    | Cloudflare block |   46 ms |
| Official Origin only               | HUF→EUR   |    403 | text/html    | Cloudflare block |   27 ms |
| Calculator Referer only            | HUF→EUR   |    403 | text/html    | Cloudflare block |   24 ms |
| Descriptive server User-Agent only | HUF→EUR   |    403 | text/html    | Cloudflare block |   27 ms |
| Justified combined headers         | HUF→EUR   |    403 | text/html    | Cloudflare block |   27 ms |
| Justified combined headers         | EUR→HUF   |    403 | text/html    | Cloudflare block |   27 ms |
| Minimal curl control               | HUF→EUR   |    403 | text/html    | Cloudflare block |  117 ms |

The justified combination used ordinary JSON/AJAX Accept, English Accept-Language, official Origin,
calculator Referer, descriptive NeoRate User-Agent and `X-Requested-With: XMLHttpRequest`. It did not
send Cookie, Authorization, Cloudflare tokens, browser identifiers or analytics headers. Node and
curl therefore agree from this egress environment. Compression and HTTP-version differences were
not shown to affect the result; no redirect occurred.

## Source inspection and limitation

The publicly delivered HTML confirms the endpoint and loads a dedicated converter script. Direct
cookie-free retrieval of that minified script from the same environment was also blocked, and the
available browser-control interface did not expose a sanitized HAR. Consequently this investigation
does not claim whether an ordinary first-party browser session supplies a prerequisite not visible
in HTML. No cookie/session test was attempted because such a dependency would be unsuitable for
NeoRate.

## Protected Preview evidence

Deployment `dpl_DkUHYvPtEKZx6TqLowjyLjTpo913` ran the committed branch in Vercel `iad1`. The feature
gate was temporarily set to exact `true` for Preview only. Two authenticated smoke requests reached
NeoRate successfully:

| Direction | NeoRate HTTP | Quote result          | Upstream result | Numeric quote |
| --------- | -----------: | --------------------- | --------------- | ------------- |
| HUF→EUR   |          200 | `NO_AVAILABLE_QUOTES` | ZEN HTTP 403    | none          |
| EUR→HUF   |          200 | `NO_AVAILABLE_QUOTES` | ZEN HTTP 403    | none          |

Each response contained the sanitized reason that the public ZEN endpoint blocked the server-side
request with HTTP 403 and that no fallback was substituted. There was no NeoRate 500. The temporary
Preview environment variable was removed immediately after the test. Production had no environment
variables and was never modified or enabled.

## Decision

The result is not a fixable static-header mismatch: every individually tested semantic header and
their reasonable combination failed locally, and an independent Vercel server region failed too.
The exact Cloudflare rule is not observable, so classify the blocker as an **unresolved anti-bot or
server-environment restriction**, not as a proven first-party-session requirement. Do not add
cookies, browser automation, proxies, clearance tokens or header spoofing. The replaceable transport
and fail-closed adapter may remain reviewable architecture, but it is not a completed ZEN product
feature. Prefer splitting reusable generic plan architecture from the dormant ZEN runtime if the
generic work is worth merging before a viable source exists.
