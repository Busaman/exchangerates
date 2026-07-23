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
The Wise comparison endpoint technical investigation is complete with a
`PROCEED_WITH_RESTRICTIONS` verdict: the isolated parser and opt-in script are not a provider
integration. A future Wise adapter requires a separate legal/product-approved PR and staging gate.
The ZEN Pro transport, Free/Gold/Platinum/Pro plan calculations, cache, validation and UI/API wiring
are implemented. Cookie-free native Node HTTPS probes and a protected Vercel Preview succeeded in
both directions after the blocked Undici/fetch transport was replaced. The adapter remains disabled
by default pending legal/product review and longer operational observation.

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

**Return draft PR #8 for review with the verified native ZEN transport. Keep ZEN production-disabled;
then run a controlled, longer staging comparison against the official calculator and complete
legal/product review before any production-enablement decision. Resolve issue #5 with simultaneous
weekend Revolut evidence before any paid weekend Revolut quote.**

**Deploy with `REVOLUT_ADAPTER_ENABLED=true` only in controlled Vercel staging using the verified
`Accept-Language: hu` locale header. The local probe returned HTTP 200 in both directions but exposed
only `STANDARD`; verify the new policy-derived HUF-source paid plans against simultaneous app
observations. Verify correctly scaled below/above-allowance amounts, actual weekend behavior,
latency, rate-limit/error rates, cache transitions and response-contract stability. Obtain
legal/product approval for the undocumented JSON endpoint before production enablement; add telemetry
without a fallback. Correctly decoded weekday quotes may rank, while the current safety gate keeps
all weekend Revolut rows visible but out of best-result ranking. Validate that remaining gate against
converter/app samples during an actual Friday 17:00 ET–Sunday 18:00 ET window before relaxation.**

The 2026-07-19 ZEN transport follow-up is complete. The public calculator still uses
`landing_currencies.php`; no session or nonce was required. Native Node HTTPS and curl returned valid
cookie-free quotes locally, and protected Preview returned valid NeoRate results in both directions.
The temporary Preview flag was removed and production remained disabled. Do not reintroduce Undici
fetch or add cookie/challenge workarounds.
