# NeoRate

NeoRate compares the amount a customer would actually receive when exchanging money through
neobanks, fintech providers and selected banks, using fees returned by the selected provider source. The first
supported directions are EUR/HUF and HUF/EUR; the domain and adapter boundaries are designed for
more currencies and providers.

> **Current status:** NeoRate includes disabled-by-default experimental Hungarian personal Revolut
> and ZEN plan adapters, one deterministic mock and one intentionally unavailable provider. Enable a
> real adapter only in controlled staging with its exact feature flag. Validated public-web-source
> data is `LIVE_UNOFFICIAL`, indicative—not executable—and endpoint or validation failure produces
> no numeric quote. Always confirm the final rate and fees in the provider app. NeoRate currently
> covers personal-provider pricing only.

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

Select `REVOLUT` to request Hungarian personal pricing. The top-level and global-ranking quote is
always the live `STANDARD` endpoint result; its fee and recipient are preserved exactly once.
Provider-detail `planQuotes` expose paid-plan estimates only where a common base rate is proven. It
is not proven by current evidence, so Plus/Premium/Metal/Ultra are numeric-field-free unavailable;
they never receive a global rank. Their monthly fee and official policy metadata remain visible but
are not allocated to one exchange.

Select `ZEN` for the Free default plan. The live public calculator supplies the ZEN Pro base rate in
`data.exchangeRate`; official markup policy derives Free, Gold and Platinum. Free alone represents
ZEN in the global ranking; Pro remains the unchanged live rate. Competitor `alternatives` are
ignored. When the exact ZEN gate is off, the request is numeric-field-free unavailable without
outbound traffic.

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
`fxFee`, `totalFee`, `feePercentage`, fee currency, total source-side cost, the endpoint and selected-plan tooltip
text, the decoded endpoint recipient, `targetAmountCalculation: ENDPOINT_HUNDREDTH_UNIT_DECODED`,
and `allowanceAssumption: FULL_ALLOWANCE_ASSUMED`. For HUF→EUR the UI also shows the same-direction
HUF cost per 1 EUR so it is not confused with the independent EUR→HUF payout rate. Responses include
`REVOLUT_INDICATIVE`; the final quote must be checked in-app.

Every successful quote also exposes `rankingEffectiveRate`. It equals `targetAmount /
providerDetails.totalSourceCost` when a valid source-currency total cost exists, otherwise
`targetAmount / sourceAmount`. Quotes sort descending by this cost-normalized decimal.js value; exact
ties use ascending provider ID. Malformed provider-supplied cost data fails closed instead of using
the fallback silently. A winning `FULL_ALLOWANCE_ASSUMED` Revolut quote is labeled as an indicative
best-case result, not an exact executable best quote.

Correctly decoded endpoint fees are rankable on weekdays; NeoRate does not calculate or insert a
replacement Revolut fee. All plans are excluded from ranking during Friday 17:00 ET through Sunday
18:00 ET until endpoint weekend-fee
coverage is verified. The interval uses `America/New_York`, including DST transitions. When all
visible quotes are excluded or stale, the API returns `NO_RANKABLE_QUOTES`.

The server fetches only:

- `GET https://www.revolut.com/api/exchange/quote`
- query: `amount`, `country=HU`, `fromCurrency`, `isRecipientAmount=false`, `toCurrency`

The endpoint is publicly accessible and used by Revolut's own converter, but is not a documented or
supported external personal API. NeoRate sends `Accept: application/json`, `Accept-Language: hu`,
and an identifying User-Agent only—no `localeCode` query parameter, cookies, authorization, Referer,
browser identifiers, Sentry/Cloudflare/analytics headers, Business APIs, private app endpoints,
reciprocal rates, HTML parsing, browser automation, or market fallback.

### ZEN plan quote fields

A successful ZEN result has top-level plan `Free`, source type `ESTIMATED`, exact source URL,
retrieval timestamp, `providerDetails.type = ZEN_PLANS`, and four provider-independent `planQuotes`.
The Pro plan preserves the validated `data.exchangeRate` as a `LIVE_UNOFFICIAL` base observation.
For markup `m`, Free/Gold/Platinum currently use `calculationRate = proRate / (1 + m)` with
decimal.js. This is NeoRate's documented interpretation of the official “ZEN Rate + X%” wording,
not a validated executable plan quote. Derived payouts are rounded down to the target scale (EUR 2,
HUF 0); their displayed effective rate is recomputed from that rounded payout. The alternative
`proRate × (1 - m)` remains plausible until a real plan-specific quote validates the convention.
The markup is embedded in the estimated rate, so derived rows do not claim a separate zero-valued
monetary fee. The public source supplies no rate timestamp, so retrieval time is labeled explicitly.
Off-market policy is evaluated at request time even for cached observations, and stale Free
observations cannot win the ranking.

The server posts only to `https://www.zen.com/landing_currencies.php` using form fields `action`,
`sourceCurrency`, `targetCurrency`, `amount`, and `endpoint`. It never calls `get_currencies.php` for
quotes and sends no cookies, authorization, Referer, Cloudflare tokens, browser identifiers or
session data. The client has a replaceable transport, strict timeout/size/content-type/schema/rate
checks, and no mock, market, competitor or reciprocal-direction fallback.

### Plan display and ranking

The UI defaults to **Ingyenes csomagok** and retains that choice for the browser session. ZEN and
Revolut expose accessible plan expansion; **Minden csomag** shows all known plans without changing
provider order. Paid plans have no global rank, and their monthly subscription is displayed as
metadata rather than charged to the single exchange. ZEN Free and Revolut Standard are the only
respective top-level ranking quotes.

ZEN pricing policy retrieved 2026-07-17: Free/Gold/Platinum/Pro monthly fees are
0/0.90/6.90/6.90 EUR; base markups are 0.50%/0.20%/0%/0%. The official help wording says CET, so
Friday 21:00 through Sunday 22:00 is evaluated at fixed UTC+1 year-round; Free/Gold/Platinum add
0.40% while Pro adds 0%. Revolut Standard proves fee-on-top
semantics (`recipient ≈ sender × rate`, `cost = sender + fee`), but same-timestamp rates change by
amount and the endpoint returns no paid plan. A common plan-independent base rate is not proven, so
Plus/Premium/Metal/Ultra remain numeric-field-free unavailable in both directions.

## Decimal and rounding rules

All calculations use decimal.js—never JavaScript `number`. Input is preserved as a decimal string.
The deterministic mock rounds fees and target amounts with `ROUND_HALF_UP` to their currency scales
(EUR 2, HUF 0), and effective rates to 8 decimal places. The rounded explicit fee is deducted before
target conversion. This is not a universal provider policy: future real adapters must implement and
test the provider's documented rounding direction. See `DECISIONS.md` for the authoritative policy.

ZEN policy-derived plan payouts use decimal.js `ROUND_DOWN` at the target currency scale (EUR 2,
HUF 0). The stored payout, API value and displayed value are identical; `effectiveRate` is calculated
from that rounded payout rather than retaining arbitrary excess precision.

The Revolut endpoint encodes every monetary request and response value as an integer number of fixed
hundredths of a major unit, including HUF. NeoRate multiplies user-entered source amounts by 100 for
the request and divides `sender`, `recipient`, `fees.fx`, `fees.total`, and `fees.cost` by 100 at the
adapter boundary using decimal.js. Domain/API/UI values always remain normal major units. The
decoded endpoint recipient is the payout; it is checked against `sourceAmount × rawRate` within
0.01 target unit. NeoRate never duplicates the endpoint fee with a manually calculated allowance or
weekend fee. The two
directions remain independent: an EUR→HUF payout rate is not the reciprocal executable price of
buying EUR with HUF.

For a source-driven Revolut quote, `feePercentage = totalFee / senderAmount × 100`. The calculation
uses decimal.js and the API keeps the unrounded decimal string. Fee amounts are rendered from their
original decimal strings, and percentage presentation uses enough precision that a positive small
fee does not appear as zero.

## Environment variables

| Variable                    | Required                       | Purpose                                                                                    |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| `DATABASE_URL`              | For database commands/features | PostgreSQL connection URL; validated lazily before a DB client is created                  |
| `LOG_LEVEL`                 | No                             | `debug`, `info`, `warn`, or `error`; defaults to `info`                                    |
| `REVOLUT_ADAPTER_ENABLED`   | No                             | Only exact lowercase `true` enables Revolut; every other value safely disables it          |
| `REVOLUT_LIVE_TEST_ENABLED` | No                             | Exactly `true` enables the explicit manual endpoint probe; normal tests never call Revolut |
| `ZEN_ADAPTER_ENABLED`       | No                             | Only exact lowercase `true` enables ZEN Pro; default and malformed values disable it       |

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
pnpm investigate:wise # opt-in technical Wise endpoint investigation; never runs in CI
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
The 2026-07-13 local probe sent `Accept-Language: hu` and received `200 OK` for three amounts in each
direction; every response had matching currencies, a positive recipient amount, and a rate timestamp.
All six responses returned only the `STANDARD` plan, so Plus/Premium/Metal/Ultra requests remain
unavailable unless the endpoint actually returns their exact plan objects. The adapter assumes the
public converter's full-allowance plan quote and does not know actual rolling-30-day usage, does not
model the separately documented conditional Hungarian migration transaction fee, and cannot promise
the app's executable rounding or total. Persistence is not yet connected to the quote request path.
The former 2026-07-15 fee-gap conclusion was caused by sending major amounts directly (`972`) where
the endpoint expected fixed hundredths (`97200`) and by reading response integers as major units.
Correctly scaled live requests return the dynamic Standard fee shown by the public converter.
NeoRate does not hard-code a threshold; it uses the exact amount-specific response. The quote remains
`FULL_ALLOWANCE_ASSUMED` because the endpoint has no account-specific rolling-30-day context, and
final app verification remains required.

ZEN Pro is wired for EUR/HUF and HUF/EUR but remains disabled by default and is not operational.
A 2026-07-19 cookie-free local matrix tested minimal Accept, Origin, Referer, descriptive User-Agent,
ordinary AJAX and combined headers in Node, plus a minimal curl control. All eight requests returned
Cloudflare HTTP 403 with HTML; both directions failed and no redirect occurred. No cookie, temporary
token, proxy or browser-impersonation workaround is implemented. A protected Vercel Preview in
`iad1` then returned the same explicit upstream HTTP 403 unavailability for HUF→EUR and EUR→HUF.
The temporary Preview flag was removed after the test; production was never enabled. An explicit ZEN
selection remains safely unavailable without numeric placeholders. See
`docs/ZEN_ENDPOINT_INVESTIGATION.md`.

Wise is not integrated. A 2026-07-16 technical investigation found that Wise's undocumented public
comparison endpoint was reachable from server-side Node without cookies or a frontend token and
returned mathematically consistent HUF/EUR and EUR/HUF comparison quotes for supported amounts.
The smallest tested amount, 100 HUF, returned no Wise provider despite HTTP 200. The isolated parser
and opt-in investigation script are not registered in the quote API or UI. See
[`docs/WISE_ENDPOINT_INVESTIGATION.md`](./docs/WISE_ENDPOINT_INVESTIGATION.md) for the
`PROCEED_WITH_RESTRICTIONS` verdict, evidence, limitations, and legal/product-review gate.

## Project context

Read `AGENTS.md` before changing code. Architecture, decisions, sequencing and provider rules live
in `ARCHITECTURE.md`, `DECISIONS.md`, `ROADMAP.md`, and `docs/PROVIDER_INTEGRATIONS.md`.
