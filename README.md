# NeoRate

NeoRate compares the amount a customer would actually receive when exchanging money through
neobanks, fintech providers and selected banks, after known provider margins and fees. The first
supported directions are EUR/HUF and HUF/EUR; the domain and adapter boundaries are designed for
more currencies and providers.

> **Current status:** NeoRate includes a disabled-by-default experimental Hungarian personal
> Revolut adapter, one deterministic mock and one intentionally unavailable provider. Revolut must
> be explicitly enabled with `REVOLUT_ADAPTER_ENABLED=true` only in a controlled staging
> environment. Validated data from Revolut's public website JSON endpoint is `LIVE_UNOFFICIAL`,
> indicative—not executable—and endpoint or validation failure produces no numeric quote. Always confirm the
> final rate and fees in the Revolut app. NeoRate currently covers personal-provider pricing only.

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

Requirements: Node.js 22.13 or newer, pnpm 11, and PostgreSQL for persistence work.

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
  "providers": ["REVOLUT"],
  "customerPlan": null,
  "providerContexts": {
    "REVOLUT": {
      "plan": "STANDARD"
    }
  }
}
```

Select `REVOLUT` to request Hungarian personal pricing. `plan` must be one of `STANDARD`, `PLUS`,
`PREMIUM`, `METAL`, or `ULTRA`; Business and Pro are rejected. The public endpoint returns plan fee
objects but has no account identity or prior-usage input, so it cannot know the customer's actual
rolling 30-day allowance usage. NeoRate does not ask for or invent that value and does not add a
second manually calculated fee: the selected endpoint plan fee is normalized once, with a visible
`FULL_ALLOWANCE_ASSUMED` limitation. Omitting the whole Revolut context yields a numeric-field-free
unavailable result; malformed context is a `400` validation error. When the experimental adapter
gate is off, an explicit Revolut request returns an unavailable result without making an HTTP request.

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

Provider calls time out after 2 seconds by default. Registrations can declare a narrower or wider
deadline; the enabled experimental Revolut registration uses 10 seconds to contain its bounded
internal retries. One timeout or exception becomes a provider-level `FAILED` issue and does not
remove valid results from other providers.

### Revolut personal quote fields

A successful Revolut result has provider id `REVOLUT`, source type `LIVE_UNOFFICIAL`, the exact
converter `sourceUrl`, source and retrieval timestamps, and `providerDetails.type` set to
`REVOLUT_PERSONAL`. Details include the displayed directional base rate, personal plan,
`fxFee`, `totalFee`, fee currency, total source-side cost, the endpoint and selected-plan tooltip
text, and `allowanceAssumption: FULL_ALLOWANCE_ASSUMED`. Responses also include
`REVOLUT_INDICATIVE`; the final quote must be checked in-app.

The server fetches only:

- `GET https://www.revolut.com/api/exchange/quote`
- query: `amount`, `country=HU`, `fromCurrency`, `isRecipientAmount=false`, `toCurrency`

The endpoint is publicly accessible and used by Revolut's own converter, but is not a documented or
supported external personal API. NeoRate sends `Accept: application/json` and an identifying
User-Agent only—no cookies, authorization, browser identifiers, Sentry/analytics headers, Business
APIs, private app endpoints, reciprocal rates, HTML parsing, browser automation, or market fallback.

## Decimal and rounding rules

All calculations use decimal.js—never JavaScript `number`. Input is preserved as a decimal string.
The deterministic mock rounds fees and target amounts with `ROUND_HALF_UP` to their currency scales
(EUR 2, HUF 0), and effective rates to 8 decimal places. The rounded explicit fee is deducted before
target conversion. This is not a universal provider policy: future real adapters must implement and
test the provider's documented rounding direction. See `DECISIONS.md` for the authoritative policy.

The Revolut adapter preserves the endpoint's rate and actual sender/recipient amounts. It calculates
the effective rate with decimal.js from those returned amounts and normalizes the selected plan's
`fees.fx`, `fees.total`, and `fees.cost` without reconstructing or rounding the payout. It never
duplicates the endpoint fee with a manually calculated allowance or weekend fee.

## Environment variables

| Variable                    | Required                       | Purpose                                                                                    |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`              | For database commands/features | PostgreSQL connection URL; validated lazily before a DB client is created                  |
| `LOG_LEVEL`                 | No                             | `debug`, `info`, `warn`, or `error`; defaults to `info`                                    |
| `REVOLUT_ADAPTER_ENABLED`   | No                             | Experimental opt-in; exactly `true` enables public JSON requests, defaults to `false`      |
| `REVOLUT_LIVE_TEST_ENABLED` | No                             | Exactly `true` enables the explicit manual endpoint probe; normal tests never call Revolut |

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
pnpm test:revolut:live # explicit live endpoint probe (requires its environment flag)
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

Current limitations: Revolut covers only Hungarian personal EUR/HUF and HUF/EUR and remains disabled
by default pending staging and legal/product verification. The undocumented endpoint contract may
change or reject server-side HTTP; that safely becomes unavailable and is negative-cached briefly.
The 2026-07-13 local probe received HTTP 400 (`Required 'localeCode' is missing`) for the documented
request shape, so the gate must remain off until the exact no-cookie request contract is confirmed.
The adapter assumes the public converter's full-allowance plan quote and does not know actual rolling-30-day usage,
does not model the separately documented conditional Hungarian migration transaction fee, and
cannot promise the app's executable rounding or total. Persistence is not yet connected to the
quote request path.

## Project context

Read `AGENTS.md` before changing code. Architecture, decisions, sequencing and provider rules live
in `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, and `docs/PROVIDER_INTEGRATIONS.md`.
