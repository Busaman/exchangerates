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

## Project context

Read `AGENTS.md` before changing code. Architecture, decisions, sequencing and provider rules live
in `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, and `docs/PROVIDER_INTEGRATIONS.md`.
