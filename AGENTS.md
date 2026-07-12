# Shared agent instructions

These rules apply to every human or AI coding agent working in this repository.

## Before editing

1. Inspect the repository, current branch, Git status, nearby tests and relevant documentation.
2. Read `ARCHITECTURE.md`, `DECISIONS.md`, and `ROADMAP.md`; treat them as authoritative unless an
   explicit new decision supersedes them.
3. Preserve unrelated or uncommitted work. Never reset, overwrite or delete it to simplify a task.

## Architecture and code

- Use the Next.js App Router, Server Components by default, and small client islands for interaction.
- Keep provider retrieval and normalization inside `src/providers`; UI and public APIs depend only
  on the common domain types in `src/domain`.
- Use strict TypeScript. Do not use `any`, unsafe casts to bypass validation, or unvalidated external
  data. Parse all provider, HTTP and environment input with Zod at its boundary.
- Represent decimal money/rates as validated decimal strings in transport/domain objects and Prisma
  `Decimal` values in persistence. Do not use floating point for real financial calculations.
- Initialize database, cache and third-party clients lazily; module imports and production builds
  must not require runtime secrets.
- Prefer explicit, small modules over speculative abstractions. Keep secrets out of source and logs.
- Keep the UI accessible, responsive and explicit about loading, stale, mock and unavailable states.

## Provider integrations

- Never fabricate a provider API, quote, timestamp, source, plan or reliability classification.
- Never silently substitute a reference market mid-rate for an executable provider customer rate.
- Classify provenance accurately: `LIVE_OFFICIAL`, `LIVE_UNOFFICIAL`, `ESTIMATED`, or `MOCK`.
- Return the unavailable union variant without numeric fields when a reliable quote cannot be obtained.
- Do not scrape or reverse-engineer private provider interfaces without an approved legal/product
  decision recorded in `DECISIONS.md`.
- Isolate each provider, validate raw responses, retain permitted source identifiers, test direction,
  plan, fee, stale-data and failure behavior, and follow `docs/PROVIDER_INTEGRATIONS.md`.

## Tests, validation and documentation

- Add or update unit tests for domain calculations, normalization and failure behavior.
- Add integration/contract fixtures before enabling a real adapter. Fixtures must be sanitized and
  legally retainable. Playwright covers critical user journeys once those journeys stabilize.
- Before finishing, run formatting check, lint, typecheck, unit tests, production build and Prisma
  validation. Report every failure; do not suppress or ignore it.
- Update README/setup instructions for new variables or commands, architecture/decision documents
  for durable changes, and ROADMAP status/next task after material milestones.

## Handoff procedure

Leave a clean, reviewable diff and state: what changed, decisions made, commands and results, known
limitations, required environment or migration steps, and the single best next task. Tell the next
agent to read `AGENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md`, and `ROADMAP.md` first. Commit only
intentional files with a focused message; never push unless explicitly authorized and authenticated.
