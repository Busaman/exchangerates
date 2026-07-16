# NeoRate roadmap

## 1. Repository and application foundation — complete

Next.js application, shared documentation, environment validation, logging/error foundations,
Prisma schema, unit test tooling, health endpoint and transparent initial UI.

## 2. Domain model and mocked providers — complete

The normalized quote/error union, decimal.js calculations, deterministic mock, unavailable example,
adapter contract suite, registry, timeout isolation and regression tests are complete.

## 3. Official or legally reliable provider integrations — in progress

The first adapter is implemented but disabled by default for Hungarian personal Revolut EUR/HUF and
HUF/EUR using the public JSON endpoint used by Revolut's official converter, strict validation,
explicit `LIVE_UNOFFICIAL` labeling and no fallback. The validated environment gate, per-provider
timeout, amount/plan-aware cache, negative cache and single-flight control are complete. It remains
operationally fragile and indicative. Evaluate Wise, ZEN and PayPal independently only
after source/legal review. Investigate Gránit Bank only if a reliable legal source is identified.

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

**Repeat the controlled Revolut Preview experiment over a longer window and complete simultaneous
weekend endpoint/converter verification during Friday 17:00 ET–Sunday 18:00 ET. The first weekday
Preview run found no 403, 429, 5xx or timeout at 60, 30 or 15 seconds, so the conservative 60-second
setting remains recommended until repeated evidence supports lowering it. Confirm whether any public
request semantics return PLUS, PREMIUM, METAL or ULTRA; never substitute Standard. Obtain legal and
product approval for the undocumented `LIVE_UNOFFICIAL` endpoint before production enablement.
Production must remain disabled, and the weekend ranking exclusion must remain until issue #5's
simultaneous evidence is complete.**
