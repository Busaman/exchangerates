# Architectural decisions

## ADR-001 — Web stack and versions

**Status:** Accepted (2026-07-12)

Use Next.js 16.2.10 App Router, React 19.2.4, TypeScript 5.9.3 and Tailwind CSS 4.3.2. These are the
mutually resolved stable foundation versions and include the relevant React Server Component
security fixes. Prefer Server Components and shadcn/ui-compatible tokens/composition; add shadcn
primitives only when a concrete UI needs them. Require Node.js 22.13 or newer because the selected
pnpm 11.7.0 runtime depends on Node APIs unavailable in Node 20.

## ADR-002 — Package manager

**Status:** Accepted (2026-07-12)

Use pnpm 11.7.0 and commit `pnpm-lock.yaml`. It provides deterministic, space-efficient installs and
explicit dependency build-script approval in `pnpm-workspace.yaml`.

## ADR-003 — Database and ORM

**Status:** Accepted (2026-07-12)

Use PostgreSQL with Prisma 7.8.0 and its `pg` driver adapter. PostgreSQL decimal, JSON and indexing
support fit normalized and historical quote data. Instantiate the client lazily so builds do not
require secrets. No baseline migration is created until a shared database/migration policy exists.

## ADR-004 — Provider adapter pattern

**Status:** Accepted (2026-07-12)

One isolated adapter per provider implements a small common interface. Every external response is
runtime-validated and normalized into the discriminated quote/unavailable union before use. This
keeps provider volatility out of UI, comparison and persistence layers.

## ADR-005 — Reference versus executable rates

**Status:** Accepted (2026-07-12)

A market/reference mid-rate is a separate data product and provenance type. It may be used to explain
spread but must never silently replace an actual provider customer quote. Unavailable provider data
produces no numeric quote.

## ADR-006 — Caching and updates

**Status:** Accepted (2026-07-12)

Start without shared cache. When real integrations exist, introduce short per-provider TTLs and
store rate/retrieval timestamps separately. Failed refreshes do not renew freshness. Stale values may
only be served with explicit `STALE` status and visible age under an approved product policy.

## ADR-007 — No scraping or private API reverse engineering

**Status:** Accepted (2026-07-12)

The foundation implements only a deterministic mock and unavailable example. Do not scrape,
reverse-engineer or speculate about provider endpoints. A future adapter requires an official or
otherwise legally reliable source, documented approval and contract fixtures.

## ADR-008 — Exact comparison and adapter failure isolation

**Status:** Accepted (2026-07-12)

Compare normalized decimal strings without conversion to JavaScript `number`. Expected provider
failures return unavailable results directly; the comparison service also isolates unexpected
adapter exceptions, logs them, and returns a numeric-field-free unavailable result for that provider
so one integration cannot erase valid quotes from other providers.

## ADR-009 — decimal.js and rounding policy

**Status:** Accepted (2026-07-13)

Use decimal.js 10.6.0 with a cloned 40-digit precision context. Never convert money or rates to
JavaScript `number` for calculation. The deterministic mock uses `ROUND_HALF_UP`: preserve the
source amount string, calculate the fee exactly and round it to the source currency scale, subtract
that rounded fee, convert at the direction-specific rate, and round the result to the target
currency scale. EUR uses 2 fraction digits, HUF uses 0, and effective rates use 8. API and domain
values remain plain decimal strings.

This rounding mode is a mock-fixture policy, not a universal customer-payout rule. Every real
provider adapter must reproduce and test the provider's documented fee, rate and payout rounding
direction. Until verified, an adapter must return unavailable rather than apply the mock policy.

The Revolut JSON client uses a provider-specific fixed-hundredth codec. Request amounts are exact
integer hundredths of the displayed major amount, and every endpoint money field uses the same unit,
including HUF. NeoRate multiplies by 100 on request and divides by 100 before validation and
normalization. The decoded endpoint recipient is retained as the target with
`ENDPOINT_HUNDREDTH_UNIT_DECODED`; no ISO currency-scale inference or raw-rate reconstruction occurs.

The public quote API limits source amounts to 30 characters and applies product minimums of 0.01 EUR
and 100 HUF. This prevents target-currency rounding from presenting a zero or severely distorted
payout as the best available quote. Normalized `AVAILABLE` quotes independently require positive
source amounts, target amounts and effective rates as defense in depth.

## ADR-010 — Registry-driven versioned quote API

**Status:** Accepted (2026-07-13)

Compose provider adapters only in `ProviderAdapterRegistry`. The quote service selects registry
entries, applies a 2-second default provider timeout with `AbortSignal`, and honors optional
per-registration deadlines (10 seconds for the enabled experimental Revolut adapter). It validates
results and ranks only fresh `AVAILABLE` quotes. Expose this through strict `POST /api/v1/quotes`. Valid partial or
complete provider failure is a `200` domain response; request validation is `400`, and unexpected
route failure is a sanitized `500`. Provider errors never expose stack traces or private messages.

Every successful quote has an explicit cost-normalized `rankingEffectiveRate`. Use
`targetAmount / providerDetails.totalSourceCost` when that cost exists, is positive, and uses the
source currency; otherwise use `targetAmount / sourceAmount`. All arithmetic and comparison use
decimal.js. Sort descending, then break exact ties by ascending provider identifier. This treats a
fee deducted before conversion and a fee charged separately on top consistently. A malformed or
wrong-currency provider-supplied total cost fails closed as `PROVIDER_INVALID_RESPONSE`; absence of
the optional provider cost is the only fallback case. Raw rate and provider-specific `effectiveRate`
retain their existing semantics.

## ADR-011 — Revolut Hungary personal public JSON integration

**Status:** Accepted with operational caveat (2026-07-13)

Support only Hungarian personal `STANDARD`, `PLUS`, `PREMIUM`, `METAL`, and `ULTRA` plans for
directional EUR/HUF and HUF/EUR. Revolut's official converter uses the publicly reachable
`GET https://www.revolut.com/api/exchange/quote` endpoint, but Revolut does not document it as a
supported external personal API. Fetch it with `amount`, `country=HU`, `fromCurrency`,
`isRecipientAmount=false`, and `toCurrency`; classify successful observations as
`LIVE_UNOFFICIAL`. Hungarian locale selection uses the website endpoint's `Accept-Language: hu`
header; there is no `localeCode` query parameter. Never use HTML/`__NEXT_DATA__`, cookies, authorization, user/browser identifiers,
browser automation, Revolut Business/Pro, private authenticated app endpoints, reciprocal
inference, or a reference-rate fallback.

Use a 2.5-second per-attempt source timeout, two retries (150 ms and 400 ms backoff), a 60-second
in-process fresh cache, a 30-second negative-result cache, amount/plan-specific single-flight
refreshes, and a 15-minute maximum stale window. Negative caching reduces repeated blocked traffic
but never renews a successful observation or extends the stale window. Endpoint timestamps older
than 15 minutes, future timestamps beyond 2 minutes, non-JSON content, redirects, inconsistent
sender/recipient/rate values, wrong directions, invalid plan fee data, and values outside configured
EUR/HUF or HUF/EUR plausibility bounds are rejected. A cached observation after refresh failure is
explicitly `STALE` and cannot win comparison.

Decoded sender amount and currencies must match exactly. The decoded endpoint recipient is the
normalized payout and must be positive and within 0.01 target unit of `sender × rawRate`. Fee
currency checks are exact; source-cost arithmetic uses only the endpoint-unit tolerance below.

After decoding, accept a difference of at most one endpoint API unit (0.01 major unit for EUR or HUF)
between `fees.cost` and `sender.amount + fees.total`, inclusive. Larger differences fail closed. This tolerance validates the response but does
not change the returned cost used for ranking.

The selected plan's endpoint fee object is authoritative only as a record of what that public source
returned; it is not assumed to be a complete account fee calculation. NeoRate requires an exact
personal plan match, validates `fees.fx`, `fees.total`, and `fees.cost`, requires a consistent source
fee currency and total source-side cost, and uses the source-returned fee once. It does not manually
recalculate or substitute fair-usage or weekend fees and therefore cannot double-charge them. For a
source-driven quote, NeoRate derives the separate display field `feePercentage` as
`fees.total / sender.amount × 100` with decimal.js. It preserves the full decimal string in the API;
the UI uses adaptive presentation precision so a positive fee cannot round to `0%`.

The endpoint request contains no account identity or prior rolling-30-day usage. Sanitized fixtures
show complete per-plan fee objects without such context. NeoRate removes the usage input and labels
every successful quote `FULL_ALLOWANCE_ASSUMED`; this is less misleading than accepting account
usage while also using endpoint-computed fees. Actual allowance and weekend fees must be verified
in-app.

The 2026-07-13 no-cookie live probe with `Accept-Language: hu` returned `200 OK` for HUF→EUR at
100,000, 400,000, and 1,100,000 HUF and EUR→HUF at 100, 1,000, and 3,000 EUR. Every sanitized summary
reported matching currencies, positive recipient amount, correct rate direction, and a timestamp.
Every response exposed only `STANDARD`; NeoRate therefore fails closed for the other selected plans
until the endpoint returns their exact complete plan fee objects. Fixture support is contract coverage,
not evidence that every plan is currently returned live. The multi-plan
`huf-eur-plan-fees.json` fixture is explicitly marked `_synthetic: true` and must never be cited as
live evidence. The adjacent zero/positive-fee fixtures are also synthetic contract/cache coverage;
their A/A+1 amounts do not define a real Revolut threshold.

A follow-up 2026-07-16 investigation established that the earlier apparent whole-EUR recipient
behavior was the same unit error: integer API values had been displayed as major values without
dividing by 100. EUR→HUF and HUF→EUR remain independent directional prices.

A 2026-07-16 browser/network investigation invalidated the prior weekday fee-gap conclusion. The
official converter represents displayed `965 EUR` as request/response `sender.amount = 96500`, fee
`2`, cost `96502`, and HUF recipient `34737505`; these decode to 965 EUR, 0.02 EUR, 965.02 EUR, and
347,375.05 HUF. NeoRate had sent `965`/`972`, which the endpoint correctly interpreted as 9.65/9.72
EUR, and had read response integers as major units. Correctly scaled live probes return the dynamic
Standard fee for the exact amount. No fixed threshold, safety margin, or weekday fee-gap ranking
exclusion is retained.

The endpoint is undocumented and its contract/access requirements may change. Saved JSON fixtures
contain only sanitized contract evidence and tests never call Revolut. The Hungarian legal page also describes a conditional migration-linked
special transaction fee whose customer activation cannot be inferred from public context; it is not
modeled and the UI requires final app verification. This adapter is not production approval to rely
on the page as an executable quote. The registration is `UNAVAILABLE` by default and performs no
outbound request. `REVOLUT_ADAPTER_ENABLED=true` is an explicit staging-only opt-in until live
server access, JSON-contract reliability and legal/product approval have been demonstrated.
Only the exact lowercase string `true` enables it. `false`, missing, empty, `yes`, `1`, `TRUE`, and
all other values safely disable Revolut; an unrecognized non-empty value may emit a server warning
but cannot throw during registry or route loading or affect other adapters.

`FULL_ALLOWANCE_ASSUMED` remains an optimistic best-case constraint, not account-specific evidence,
because the public endpoint has no prior rolling-30-day usage input. Correctly decoded weekday fees
and costs are eligible for ranking; no local fee or threshold is calculated. A winning badge remains
qualified as “Legjobb indikatív best-case eredmény · teljes keret feltételezve”.

Revolut's public endpoint has not yet demonstrated weekend-fee coverage. During Friday 17:00 ET
through Sunday 18:00 ET, classified with `America/New_York`, every Revolut plan is therefore visible
but `EXCLUDED_INCOMPLETE_FEES` with reason `WEEKEND_FEE_UNVERIFIED`. This rule follows daylight-saving
transitions and must remain until controlled weekend evidence supports a narrower policy. App
verification remains required in every case.

## ADR-012 — Wise public comparison endpoint investigation

**Status:** Investigated; not approved for runtime integration (2026-07-16)

Wise's undocumented `GET https://wise.com/gateway/v4/comparisons` endpoint was reachable from a
server-side Node environment with ordinary JSON accept and identifying User-Agent headers. Cookies,
authorization, browser identifiers, and the observed public frontend `x-access-token` were not
required. Both HUF→EUR and EUR→HUF returned decimal-reconcilable Wise comparison quotes across the
tested supported amounts, and the public Wise comparison UI matched three representative endpoint
observations. A 100 HUF request returned HTTP 200 with no providers, so HTTP success alone is never
quote success.

The evidence supports `amount` as the total source debit, `fee` as a source-currency deduction,
`rate` as the pre-fee directional rate, and `receivedAmount` as the rounded net payout for the
observed `amountType: SEND` responses. This interpretation remains evidence-bound because the
contract is undocumented. `sourceCountry=HU` materially changed fees and must be retained for
Hungarian results. `includeWise=true` was necessary; the exact `wise` alias and exactly one
understandable quote are mandatory fail-closed invariants.

Verdict: **PROCEED_WITH_RESTRICTIONS**. The repository may retain an opt-in investigation script,
sanitized fixtures, and an isolated network-free parser. It must not register or expose Wise until a
separate adapter PR receives legal/product approval, operational review, staging evidence, and
explicit `LIVE_UNOFFICIAL`/indicative labeling. A future adapter should begin with a conservative
60-second amount/pair/country-aware cache. The comparison endpoint is not assumed to be an
account-specific or payment-method-specific executable quote.

## ADR-013 — ZEN Pro public webpage quote adapter

**Status:** Accepted behind a disabled operational gate (2026-07-17)

Use only `POST https://www.zen.com/landing_currencies.php` for indicative ZEN Pro EUR/HUF and
HUF/EUR quotes. The request is source-driven form data with `action=change_currency`, allowlisted
source/target currencies, an exact two-decimal source amount, and `endpoint=change_currency`.
Successful data is `LIVE_UNOFFICIAL`: the endpoint belongs to the official ZEN.COM public converter
but is not documented as a supported external API. The official public converter states that the
displayed rate and zero-additional-fee offer apply to ZEN Pro and that the margin is included in the
rate. NeoRate preserves `data.exchangeRate` as the primary directional rate and the endpoint's
rounded `data.targetAmount` as the displayed payout. It never reconstructs the primary rate from
that rounded payout. For HUF→EUR, `1 / data.exchangeRate` is exposed separately as the HUF cost of
one EUR; the independently retrieved opposite direction is never replaced with this reciprocal.

The adapter uses a replaceable server-side transport, a 2.5-second source timeout, manual redirects,
a 64 KiB response limit, strict JSON/Zod validation, decimal.js plausibility and amount/rate
consistency checks, and no cookies, authorization, Cloudflare tokens, browser identifiers, Referer,
or browser automation. The `alternatives` collection is intentionally untrusted and ignored; its
Revolut/Wise rows can never create or modify NeoRate Revolut/Wise provider observations. The endpoint
does not supply a rate timestamp, so a successful quote explicitly uses retrieval time as its rate
observation timestamp.

Current server-side evidence is negative. On 2026-07-17, the literal minimal request returned HTTP
403 in about 106 ms. An identifying NeoRate User-Agent (with or without the public page's semantic
`X-Requested-With: XMLHttpRequest` header) reached HTTP 200 in roughly 168–259 ms but returned only
the 16-byte error envelope `{"error":"1..."}`. No cookies or temporary identifiers were tried.
Therefore `ZEN_ADAPTER_ENABLED` is false by default and only exact lowercase `true` enables network
retrieval in a controlled environment. Missing, empty, false, or malformed values safely disable
ZEN. Disabled, 403, timeout, malformed JSON, invalid schema/rate, or inconsistent amount behavior is
numeric-field-free unavailable; no reference, mock, reciprocal-opposite-direction, or competitor
fallback is substituted. No last-known-good cache is introduced in this change.

## ADR-014 — Provider-independent plan quotes and default-plan ranking

**Status:** Accepted (2026-07-17)

Rank one default plan per provider: ZEN Free and Revolut Standard. Paid plans are provider details
only and cannot win the global ranking. A discriminated `planQuotes` union represents live, derived
and numeric-field-free unavailable plans with subscription, allowance/markup, provenance and ranking
metadata. Monthly subscriptions are displayed but never allocated wholly to one exchange.

ZEN's official calculator identifies its public quote as ZEN Pro. Official pricing retrieved
2026-07-17 gives Free/Gold/Platinum/Pro markups 0.50%/0.20%/0%/0%, monthly fees
0/0.90/6.90/6.90 EUR, and an additional 0.40% outside market hours for all except Pro. NeoRate
preserves `data.exchangeRate` as the live target-per-source Pro rate and derives with
`targetRate = proRate / (1 + totalMarkup)`. The Friday 21:00–Sunday 22:00 European-local rule uses
`Europe/Warsaw` for DST. ZEN now uses pair/amount-specific 60-second fresh, 30-second negative,
15-minute stale and single-flight caching; this supersedes ADR-013's no-cache foundation note.

Revolut fixtures and the 2026-07-17 live matrix prove fee-on-top semantics inside Standard:
`recipient ≈ sender × rate` and `totalSourceCost = sender + totalFee`. Standard remains live and is
never charged twice. They do not prove a common plan-independent base: at the same source timestamp,
350,000 HUF and 400,000 HUF returned different rates, and all live responses exposed only Standard.
Plus/Premium/Metal/Ultra are therefore numeric-field-free unavailable in both directions. Official
subscription and allowance metadata remains visible, but no payout is invented. Until issue #5 is
resolved, Standard also remains ranking-excluded on weekends. The temporary Hungarian 0.45%
provision is not manually added.

Both sources remain undocumented `LIVE_UNOFFICIAL` observations, production-default-off, indicative,
and subject to staging plus legal/product review.
