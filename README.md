# NeoRate

NeoRate compares the amount a customer would actually receive when exchanging money through
neobanks, fintech providers and selected banks, after known provider margins and fees. The first
supported directions are EUR/HUF and HUF/EUR; the domain and adapter boundaries are designed for
more currencies and providers.

> **Foundation status:** the application currently displays one deterministic mock provider and one
> intentionally unavailable provider. It does **not** show live or executable rates and is not
> production-ready. A market mid-rate must never be presented as a provider customer rate.

## Selected stack

- Next.js 16.2.10 (App Router), React 19.2.4, strict TypeScript 5.9.3
- Tailwind CSS 4.3.2 with a shadcn/ui-compatible token and component structure
- PostgreSQL, Prisma ORM and client 7.8.0, Zod 4.4.3
- decimal.js 10.6.0 for exact monetary and rate arithmetic
- Vitest 4.1.10 and Playwright 1.61.1
- ESLint 9.39.5, Prettier 3.9.5, pnpm 11.7.0

See [DECISIONS.md](./DECISIONS.md) for why these choices were made. Exact transitive versions are
locked in `pnpm-lock.yaml`.

## Local setup

Requirements: Node.js 20.9 or newer, pnpm 11, and PostgreSQL for persistence work.

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm dev
```

Open `http://localhost:3000`. The health endpoint is `GET /api/health`. On Windows PowerShell, copy
the environment template with `Copy-Item .env.example .env`.

## Quote API

`POST /api/v1/quotes` is the versioned server-side comparison boundary. Monetary values are plain
decimal strings. Requests reject unknown fields, unsupported currencies/providers, duplicate
providers, equal currencies, malformed/non-positive amounts, amount strings longer than 30
characters, values below the source-currency minimum (0.01 EUR or 100 HUF), and amounts above
`1000000000000`. Omitting `providers` compares every adapter registered on the server.

```json
{
  "sourceCurrency": "EUR",
  "targetCurrency": "HUF",
  "sourceAmount": "1000",
  "providers": ["MOCK_PROVIDER", "UNAVAILABLE_PROVIDER"],
  "customerPlan": null
}
```

A successful HTTP response uses status `200`, including partial or fully unavailable provider
outcomes. It contains request metadata, normalized `quotes`, numeric-field-free `issues`,
`bestProviderId`, `generatedAt`, `sourceStatus`, and warnings:

```json
{
  "request": {
    "id": "00000000-0000-4000-8000-000000000000",
    "sourceCurrency": "EUR",
    "targetCurrency": "HUF",
    "sourceAmount": "1000",
    "providers": ["MOCK_PROVIDER", "UNAVAILABLE_PROVIDER"],
    "customerPlan": null
  },
  "quotes": [
    {
      "kind": "quote",
      "provider": { "id": "MOCK_PROVIDER", "name": "Demo Fintech" },
      "pair": { "sourceCurrency": "EUR", "targetCurrency": "HUF" },
      "direction": "SELL_SOURCE_BUY_TARGET",
      "sourceAmount": { "currency": "EUR", "amount": "1000" },
      "targetAmount": { "currency": "HUF", "amount": "391323" },
      "effectiveRate": "391.32300000",
      "explicitFee": { "currency": "EUR", "amount": "3.00" },
      "totalCost": { "currency": "EUR", "amount": "3.00" },
      "rateTimestamp": "2026-01-01T12:00:00.000Z",
      "retrievedAt": "2026-01-01T12:00:00.000Z",
      "sourceType": "MOCK",
      "status": "AVAILABLE",
      "freshness": "FRESH",
      "reliability": "LOW",
      "sourceId": "deterministic-foundation-v2",
      "disclaimer": "Deterministic development fixture; this is not a live or executable rate."
    }
  ],
  "issues": [
    {
      "kind": "unavailable",
      "provider": { "id": "UNAVAILABLE_PROVIDER", "name": "Unavailable example" },
      "pair": { "sourceCurrency": "EUR", "targetCurrency": "HUF" },
      "status": "UNAVAILABLE",
      "freshness": "UNKNOWN",
      "reliability": "NOT_APPLICABLE",
      "retrievedAt": "2026-01-01T12:00:00.000Z",
      "reason": "No verified provider integration is configured in the foundation phase.",
      "sourceId": "foundation-unavailable-example"
    }
  ],
  "bestProviderId": "MOCK_PROVIDER",
  "generatedAt": "2026-01-01T12:00:00.000Z",
  "sourceStatus": "PARTIAL_SUCCESS",
  "warnings": ["MOCK_DATA"]
}
```

The complete runtime contract is defined in `src/domain/quote.ts` and `src/domain/quote-api.ts`.
Invalid JSON or input returns `400` with
`INVALID_JSON` or `VALIDATION_ERROR`. Unexpected server failures return a sanitized `500
INTERNAL_ERROR`; stack traces and internal provider errors are never returned.

Provider calls time out after 2 seconds by default. One timeout or exception becomes a provider-level
`FAILED` issue and does not remove valid results from other providers.

## Decimal and rounding rules

All calculations use decimal.js—never JavaScript `number`. Input is preserved as a decimal string.
The deterministic mock rounds fees and target amounts with `ROUND_HALF_UP` to their currency scales
(EUR 2, HUF 0), and effective rates to 8 decimal places. The rounded explicit fee is deducted before
target conversion. This is not a universal provider policy: future real adapters must implement and
test the provider's documented rounding direction. See `DECISIONS.md` for the authoritative policy.

## Environment variables

| Variable       | Required                       | Purpose                                                                   |
| -------------- | ------------------------------ | ------------------------------------------------------------------------- |
| `DATABASE_URL` | For database commands/features | PostgreSQL connection URL; validated lazily before a DB client is created |
| `LOG_LEVEL`    | No                             | `debug`, `info`, `warn`, or `error`; defaults to `info`                   |

Never commit `.env` files or credentials. `.env.example` contains documentation-only values.

## Commands

```bash
pnpm dev              # local development server
pnpm build            # production build
pnpm start            # serve the production build
pnpm lint             # ESLint
pnpm typecheck        # strict TypeScript validation
pnpm test             # unit tests once
pnpm test:watch       # unit tests in watch mode
pnpm test:coverage    # unit test coverage
pnpm test:e2e         # future Playwright suite
pnpm format           # write formatting
pnpm format:check     # verify formatting
pnpm db:generate      # generate Prisma client
pnpm db:validate      # validate Prisma schema/config
pnpm db:migrate       # create/apply a local development migration
pnpm db:studio        # inspect the configured database
```

## Database

Set `DATABASE_URL`, run `pnpm db:generate`, then `pnpm db:migrate`. The schema separates numeric
`QuoteSnapshot` rows from `ProviderAvailabilityEvent` rows, preventing unavailable observations
from carrying placeholder numbers. No migration is committed yet because no shared database or
baseline migration policy has been selected.

## Deployment

The web application is Vercel-compatible. Configure `DATABASE_URL` and `LOG_LEVEL` in the deployment
environment, provision a reachable PostgreSQL database, run migrations as a controlled release
step, and deploy with the standard Next.js build command. The health endpoint verifies the web
process only; database readiness should be added when persistence becomes part of the request path.

Current limitations: only a deterministic mock adapter and an intentionally unavailable example are
registered. No quote is live or executable, persistence is not yet connected to the quote request
path, and no external provider integration exists.

## Project context

Read `AGENTS.md` before changing code. Architecture, decisions, sequencing and provider rules live
in `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, and `docs/PROVIDER_INTEGRATIONS.md`.
