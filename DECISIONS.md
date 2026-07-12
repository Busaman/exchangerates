# Architectural decisions

## ADR-001 — Web stack and versions

**Status:** Accepted (2026-07-12)

Use Next.js 16.2.10 App Router, React 19.2.4, TypeScript 5.9.3 and Tailwind CSS 4.3.2. These are the
mutually resolved stable foundation versions and include the relevant React Server Component
security fixes. Prefer Server Components and shadcn/ui-compatible tokens/composition; add shadcn
primitives only when a concrete UI needs them.

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
