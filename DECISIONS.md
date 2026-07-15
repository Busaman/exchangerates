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

The Revolut JSON client preserves the endpoint sender, raw directional rate, fees, and original
recipient display. Live evidence on 2026-07-15 showed that HUF→EUR `recipient.amount` may be truncated
to whole EUR, including `0` for 100 HUF, despite a positive high-precision raw rate. NeoRate therefore
calculates the indicative normalized payout as `sourceAmount × rawRate` with decimal.js and rounds
down to the target-currency scale. The original endpoint recipient and the
`RAW_RATE_ROUNDED_DOWN` method remain visible; this is not a claim about executable app rounding.

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

Sender amount and currencies must match exactly. The endpoint recipient is a coarse display
consistency signal: it must be within one target display unit of `sender × rawRate`. NeoRate then
normalizes the indicative payout as `sender × rawRate`, rounded down to EUR 2 or HUF 0 decimal places.
The raw endpoint recipient is preserved separately. Fee currency checks are exact; source-cost
arithmetic uses only the minor-unit tolerance below.

The endpoint serializes monetary display values at currency precision, so accept a difference of at
most one source-currency minor unit between `fees.cost` and `sender.amount + fees.total`: 1 HUF or
0.01 EUR, inclusive. Larger differences fail closed. This tolerance validates the response but does
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

A follow-up no-cookie probe on 2026-07-15 confirmed a contract change/variant: HUF→EUR returned a
positive directional rate but whole-EUR recipient displays (`0` for 100 HUF, `2` for 1,000 HUF,
`27` for 10,000 HUF, and `67` around 24,560 HUF). The old 0.5% relative comparison created an
amount-dependent false rejection threshold. The one-display-unit guard plus transparent
rate-derived normalization removes that artifact without using the opposite direction or a market
fallback. EUR→HUF and HUF→EUR remain independent directional prices.

A second 2026-07-15 measurement found a separate fee-coverage discrepancy. With the official web
converter set to EUR→HUF, 968–971 EUR displayed `0.00 EUR`, 972 displayed `0.01 EUR`, 973 displayed
`0.02 EUR`, and 974 displayed `0.03 EUR`; the first positive amount is rate-dependent and is not a
product constant. Source-driven public JSON requests for the exact 968–974 amounts all returned HTTP
200 with Standard `fees.fx = 0`, `fees.total = 0`, and `fees.cost = sender.amount`. NeoRate therefore
must not claim that the endpoint exposes the converter UI's dynamic allowance threshold. The JSON
fee is preserved as source-reported evidence but is not treated as complete. No fixed or locally
reconstructed EUR threshold or replacement fee is permitted. Staging must investigate the official
converter's additional fee context before this limitation can be removed.

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

`FULL_ALLOWANCE_ASSUMED` is an optimistic best-case constraint, not account-specific evidence. For
weekday Standard and Plus quotes, NeoRate uses the documented HUF allowance only as a ranking
eligibility guard: HUF source amount consumes HUF directly; EUR source amount is converted with the
same directional endpoint rate. Consumption above 350,000 HUF for Standard or 1,050,000 HUF for
Plus sets `rankingStatus = EXCLUDED_INCOMPLETE_FEES`. The row and source-returned numbers remain
visible, but it cannot become `bestProviderId`. No fee is calculated or substituted locally. At or
below the zero-usage boundary, weekday quotes remain eligible and a winning badge is qualified as
“Legjobb indikatív best-case eredmény · teljes keret feltételezve”.

Revolut's public endpoint has not yet demonstrated weekend-fee coverage. During Friday 17:00 ET
through Sunday 18:00 ET, classified with `America/New_York`, every Revolut plan is therefore visible
but `EXCLUDED_INCOMPLETE_FEES` with reason `WEEKEND_FEE_UNVERIFIED`. This rule follows daylight-saving
transitions and must remain until controlled weekend evidence supports a narrower policy. App
verification remains required in every case.
