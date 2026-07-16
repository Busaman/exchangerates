# Wise comparison endpoint investigation

## Verdict

**PROCEED_WITH_RESTRICTIONS** (investigated 2026-07-16).

`GET https://wise.com/gateway/v4/comparisons` was reachable from a server-side Node environment
with ordinary headers, without cookies, authorization, browser identifiers, or `x-access-token`.
The endpoint returned mathematically consistent Wise comparison quotes for the tested HUF/EUR and
EUR/HUF amounts, except that the smallest tested amount (100 HUF) returned HTTP 200 with no
providers. The endpoint is undocumented and the public comparison result is not proven to be an
account-specific executable quote. Any future integration therefore requires legal/product review,
strict fail-closed validation, explicit `LIVE_UNOFFICIAL` labeling, and separate implementation and
review.

This branch contains investigation tooling and an isolated response parser only. It does not add a
Wise provider identifier, adapter registration, API/UI option, ranking behavior, or production
feature gate.

## Scope and method

The investigation used modest sequential requests with a five-second timeout, a 512 KiB response
limit, and an identifying `NeoRate technical investigation` User-Agent. The scripted run made 25
requests covering the amount matrix and narrowly scoped request variants. A few additional manual
requests were used to confirm ambiguous HTTP statuses and compare representative values with Wise's
public pages. No load, concurrency, cookie, session, or aggressive refresh test was performed.

The opt-in command is:

```powershell
$env:WISE_INVESTIGATION_ENABLED = "true"
pnpm investigate:wise
```

Normal tests and CI never call Wise. `WISE_FRONTEND_TOKEN` is accepted by the script only as a
temporary Variant B input if the minimal request fails; it is never printed or persisted. It was not
needed during this investigation.

## Endpoint and conservative request

```http
GET /gateway/v4/comparisons?sourceCurrency=HUF&targetCurrency=EUR&sendAmount=998877&sourceCountry=HU&filter=POPULAR&includeWise=true&numberOfProviders=3
Accept: application/json
User-Agent: NeoRate technical investigation
```

Use `sourceCountry=HU`, `filter=POPULAR`, `includeWise=true`, and `numberOfProviders=3` as the
conservative Hungarian request even where a single observation found one parameter optional. Wise
selection must use exact `provider.alias === "wise"`; other provider data in this Wise-hosted
comparison response is not an authoritative integration source for those providers.

## Header, token, cookie, and server-access findings

| Variant                               | Result   | Finding                                               |
| ------------------------------------- | -------- | ----------------------------------------------------- |
| A: `Accept` + identifying User-Agent  | HTTP 200 | Minimal server-side request works                     |
| B: public frontend token              | Not run  | Correctly skipped because A succeeded                 |
| C: ordinary `Accept-Language` added   | HTTP 200 | Language header was not required for the tested quote |
| D: explicit no-token/no-cookie repeat | HTTP 200 | Equivalent result to A                                |

Cookies, `x-access-token`, authorization, browser sessions, and Cloudflare clearance data were not
required. Plain Node HTTP access was not blocked. The stability or public discoverability of the
observed frontend token was deliberately not investigated because relying on it was unnecessary. A
future adapter must not send copied browser headers or personal identifiers.

## Amount matrix

All rows are time-specific sanitized evidence. Latency is end-to-end client latency in milliseconds.
`Difference` is the absolute decimal difference between `(amount - fee) × rate` and
`receivedAmount`. EUR targets allow at most EUR 0.01; HUF targets allow at most HUF 1.

| Direction |    Amount | HTTP | Latency |        Fee |       Rate |      Received | Difference | Result                        |
| --------- | --------: | ---: | ------: | ---------: | ---------: | ------------: | ---------: | ----------------------------- |
| HUF→EUR   |       100 |  200 |     221 |          — |          — |             — |          — | No Wise provider; fail closed |
| HUF→EUR   |    10,000 |  200 |      91 |    499 HUF | 0.00276159 |     26.24 EUR | 0.00213341 | Valid                         |
| HUF→EUR   |   100,000 |  200 |      99 |  1,776 HUF | 0.00276159 |    271.25 EUR | 0.00441616 | Valid                         |
| HUF→EUR   |   400,000 |  200 |     100 |  6,035 HUF | 0.00276159 |  1,087.97 EUR | 0.00019565 | Valid                         |
| HUF→EUR   |   998,877 |  200 |      93 | 14,537 HUF | 0.00276159 |  2,718.34 EUR | 0.00350060 | Valid                         |
| HUF→EUR   | 1,000,000 |  200 |      91 | 14,554 HUF | 0.00276159 |  2,721.40 EUR | 0.00218086 | Valid                         |
| EUR→HUF   |         1 |  200 |     104 |   0.87 EUR |     362.11 |        47 HUF |     0.0743 | Valid                         |
| EUR→HUF   |        10 |  200 |      93 |      1 EUR |     362.11 |     3,259 HUF |       0.01 | Valid                         |
| EUR→HUF   |       100 |  200 |      95 |   2.36 EUR |     362.11 |    35,356 HUF |     0.4204 | Valid                         |
| EUR→HUF   |     1,000 |  200 |      92 |  16.01 EUR |     362.11 |   356,313 HUF |     0.3811 | Valid                         |
| EUR→HUF   |     5,000 |  200 |      98 |  76.67 EUR |     362.11 | 1,782,787 HUF |     0.0263 | Valid                         |

Every available Wise quote in this run used `amountType: "SEND"`, matched the requested response
amount and currencies, contained exactly one Wise provider and one Wise quote, and reported
`markup: 0`, `isConsideredMidMarketRate: true`, quote `sendAmount: null`, quote source country `HU`,
quote target country `null`, response source country `HU`, and response target country `null`.
These are observations, not promises about the undocumented contract.

## Mathematical and response semantics

Decimal-safe reconciliation supports this interpretation for the tested quotes:

```text
amount                = total source-side amount entered
fee                   = source-currency amount deducted before conversion
amount - fee          = source-currency amount converted
rate                  = pre-fee directional conversion rate
receivedAmount        = rounded net target amount
effectiveRate         = receivedAmount / amount
```

The parser requires a non-negative fee, positive rate and received amount, exact requested amount,
matching currencies, one exact `wise` provider, one quote, a valid recent timestamp, and
currency-aware reconciliation. It does not infer additional semantics from `markup` or
`isConsideredMidMarketRate`.

## Country behavior

The same 100,000 HUF→EUR request was compared with a small country variant set:

| `sourceCountry` |  Wise fee |   Received | Country metadata | Other provider observation         |
| --------------- | --------: | ---------: | ---------------- | ---------------------------------- |
| `HU`            | 1,776 HUF | 271.25 EUR | `HU`             | PayPal present                     |
| omitted         |   897 HUF | 273.68 EUR | `null`           | PayPal present                     |
| `DE`            |   897 HUF | 273.68 EUR | `DE`             | No other provider in that response |

`sourceCountry=HU` is not required merely to receive HTTP 200, but it materially changes the fee
and provider context. It is required for a future Hungarian NeoRate integration.

## Parameter behavior

| Variant                  | Observed result                                             |
| ------------------------ | ----------------------------------------------------------- |
| Omit `filter`            | Wise remained present with the same tested Hungarian result |
| Omit `includeWise`       | HTTP 200, only PayPal, no Wise                              |
| `includeWise=false`      | HTTP 200, only PayPal, no Wise                              |
| Omit `numberOfProviders` | Wise remained present with the same tested result           |

`includeWise=true` is required by the evidence. The other known successful parameters should remain
in a future request because an undocumented endpoint may couple behavior not covered by one probe.
Providers can be empty and Wise can be absent even on HTTP 200. No multiple Wise quotes or exposed
payment-method variants were observed.

## Freshness and cache recommendation

Responses reported:

```text
Cache-Control: no-cache, no-store, max-age=0, must-revalidate
CF-Cache-Status: DYNAMIC
```

Despite those headers, a short repeat returned reused and, for one pair, non-monotonic
`dateCollected` values. Representative quote ages were about 9–11 seconds. Fee, rate, and received
amount stayed unchanged over the short sample. The source timestamp must therefore be validated
independently from retrieval time.

The recommended initial positive cache TTL is **60 seconds**, keyed by source currency, target
currency, exact canonical amount, `sourceCountry`, and all material query semantics. This limited
evidence does not justify a lower TTL. A future adapter should use single-flight, short negative
caching, an explicit source-age ceiling, and never rank stale results.

## Public Wise UI comparison

Three representative endpoint results were compared close in time with Wise's public Hungarian
pages:

| Request         | Public comparison UI                  | Endpoint | Finding |
| --------------- | ------------------------------------- | -------- | ------- |
| 100,000 HUF→EUR | fee 1,776 HUF; received 271.25 EUR    | same     | Match   |
| 998,877 HUF→EUR | fee 14,537 HUF; received 2,718.27 EUR | same     | Match   |
| 1,000 EUR→HUF   | fee 16.01 EUR; received 356,322 HUF   | same     | Match   |

The separate Wise currency-converter view showed the fee-free mid-market calculation (for example,
100,000 HUF produced about 276.15 EUR), not the comparison quote. The public comparison page matched
the endpoint and stated bank-transfer assumptions. No authenticated, account-specific, or
payment-method-specific executable quote was tested. Therefore NeoRate must distinguish:

1. the converter's mid-market illustration;
2. the public comparison endpoint result;
3. a final executable Wise quote.

## Schema, fixtures, and prototype parser

Sanitized fixtures retain only fields required to validate the observed response contract. Zod
allows unrelated future fields while requiring the response amount/type/currencies, provider alias,
one quote, date, fee, rate, received amount, markup, mid-market flag, and observed country fields.
The isolated parser accepts already-fetched JSON and performs no network or runtime registration.
Fixtures are investigation evidence, not executable-rate guarantees.

## Privacy, security, legal, and product constraints

- No cookies, tokens, authorization, device IDs, sessions, personal data, or raw response headers
  are stored in source or fixtures.
- Sanitized output excludes other-provider quote bodies; their aliases are used only for schema
  observations.
- The endpoint is undocumented and may change, throttle, restrict access, or have terms that do not
  permit production reliance.
- A later adapter needs explicit legal/product approval and staging evidence before enablement.
- A successful observation would be `LIVE_UNOFFICIAL`, indicative, and must not be described as an
  official API or an account-specific executable quote.

## Recommended future architecture

If approved, implement a separate Wise server-side client and adapter in a later PR. Reuse the
investigation parser's fail-closed invariants, add bounded retry/timeout/size handling, cache by all
material request inputs for 60 seconds, preserve source and retrieval timestamps, return unavailable
without numeric placeholders when Wise is absent, and add explicit user-facing comparison-versus-
executable wording. Do not expose Wise-hosted third-party comparisons as NeoRate provider quotes.

Open risks are the undocumented contract and terms, minimum-amount/provider-availability behavior,
country- and payment-method-specific pricing, unexplained future multiple quotes, timestamp reuse,
rate limits, and the gap between a comparison quote and a user's final executable transfer.
