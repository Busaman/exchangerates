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

The Revolut public page does not document executable payout rounding. For this explicitly
indicative integration, retain all source/intermediate precision and use `ROUND_DOWN` only once at
the final target-currency boundary so NeoRate does not overstate the calculated payout. This is a
NeoRate conservative display rule, is disclosed in the result, and must be replaced if Revolut
publishes or exposes verifiable personal-app rounding semantics.

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

## ADR-011 — Revolut Hungary personal public-page integration

**Status:** Accepted with operational caveat (2026-07-13)

Support only Hungarian personal `STANDARD`, `PLUS`, `PREMIUM`, `METAL`, and `ULTRA` plans for
directional EUR/HUF and HUF/EUR. There is no documented public personal quote API available to this
project. Fetch only the two official Hungary converter pages, parse their structured Next.js rate
payload, and classify successful observations as `LIVE_UNOFFICIAL`. Never use Revolut Business/Pro,
private app endpoints, authentication, reciprocal inference, or a reference-rate fallback.

Use a 2.5-second per-attempt source timeout, two retries (150 ms and 400 ms backoff), a 60-second
in-process fresh cache, a 30-second negative-result cache, per-direction single-flight refreshes,
and a 15-minute maximum stale window. Negative caching reduces repeated blocked traffic but never
renews a successful observation or extends the stale window. Page/source timestamps older than 15 minutes, future
timestamps beyond 2 minutes, challenge pages, inconsistent amounts, wrong directions, and values
outside configured EUR/HUF or HUF/EUR plausibility bounds are rejected. A cached observation after
refresh failure is explicitly `STALE` and cannot win comparison.

Fee policy comes from Revolut Hungary's personal fee/help documents: Standard 350,000 HUF at 1%
overage, Plus 1,050,000 HUF at 0.5%, no weekday fair-usage fee for Premium/Metal/Ultra, and 1% for
all plans from Friday 17:00 through Sunday 18:00 in `America/New_York`. The interval is half-open at
Sunday 18:00 and evaluated with IANA DST rules. Plan and the user's prior rolling-30-day HUF usage
are mandatory context; NeoRate never guesses account usage. Fair-usage and weekend components are
calculated independently on source value, summed, then deducted before conversion.

The public page may be bot-blocked and its markup may change. Saved fixtures contain only the
minimal structured evidence. The Hungarian legal page also describes a conditional migration-linked
special transaction fee whose customer activation cannot be inferred from public context; it is not
modeled and the UI requires final app verification. This adapter is not production approval to rely
on the page as an executable quote. The registration is `UNAVAILABLE` by default and performs no
outbound request. `REVOLUT_ADAPTER_ENABLED=true` is an explicit staging-only opt-in until live
server access, parser reliability and legal/product approval have been demonstrated.
