# NeoRate roadmap

## 1. Repository and application foundation — complete

Next.js application, shared documentation, environment validation, logging/error foundations,
Prisma schema, unit test tooling, health endpoint and transparent initial UI.

## 2. Domain model and mocked providers — in progress

The normalized quote union, deterministic mock, unavailable example, exact decimal comparison,
adapter failure isolation and regression tests exist. Next, finish decimal calculation primitives,
contract test utilities, adapter registry and quote API.

## 3. Official or legally reliable provider integrations — planned

Evaluate Wise, Revolut, ZEN and PayPal sources independently. Record terms, authentication, limits,
plans, timestamps and reliability before implementing any adapter. Investigate Gránit Bank only if a
reliable legal source is identified.

## 4. Historical rate storage — planned

Approve migration policy, create baseline migration, persist normalized snapshots and availability
events, define retention and provenance audit behavior.

## 5. Comparison calculator — planned

Add server-side decimal calculations, amount/plan-aware comparison API, validation and consistent
best-result rules.

## 6. Charts and alerts — planned

Add historical visualizations and user alerts only after historical data quality is measured.

## 7. Production hardening — planned

Authentication where needed, rate limiting, telemetry, SLOs, security review, backups, accessibility
audit, E2E coverage and incident runbooks.

## 8. Additional currencies and providers — planned

Expand from directional EUR/HUF and HUF/EUR using measured demand and verified provider sources.

## Next recommended task

**Build the server-side quote application service and versioned `/api/v1/quotes` Route Handler using
decimal arithmetic, an adapter registry, Zod request/response validation, and contract tests—still
using only the deterministic mock and unavailable adapters.**
