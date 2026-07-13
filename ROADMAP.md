# NeoRate roadmap

## 1. Repository and application foundation — complete

Next.js application, shared documentation, environment validation, logging/error foundations,
Prisma schema, unit test tooling, health endpoint and transparent initial UI.

## 2. Domain model and mocked providers — complete

The normalized quote/error union, decimal.js calculations, deterministic mock, unavailable example,
adapter contract suite, registry, timeout isolation and regression tests are complete.

## 3. Official or legally reliable provider integrations — next

Evaluate Wise, Revolut, ZEN and PayPal sources independently. Record terms, authentication, limits,
plans, timestamps and reliability before implementing any adapter. Investigate Gránit Bank only if a
reliable legal source is identified.

## 4. Historical rate storage — planned

Approve migration policy, create baseline migration, persist normalized snapshots and availability
events, define retention and provenance audit behavior.

## 5. Comparison calculator — foundation complete

The amount/plan-aware server service, strict versioned API, fresh-only best-result rules and minimal
API-backed UI are complete. Future work adds real-provider semantics and persistence-backed history.

## 6. Charts and alerts — planned

Add historical visualizations and user alerts only after historical data quality is measured.

## 7. Production hardening — planned

Authentication where needed, rate limiting, telemetry, SLOs, security review, backups, accessibility
audit, E2E coverage and incident runbooks.

## 8. Additional currencies and providers — planned

Expand from directional EUR/HUF and HUF/EUR using measured demand and verified provider sources.

## Next recommended task

**Research and document the first real provider integration candidate. Evaluate official API/legal
source availability, terms, authentication, rate limits, supported plans/directions, timestamp and
fee semantics, data retention and fallback behavior. Produce an ADR and sanitized contract-fixture
plan before writing any live adapter code.**
