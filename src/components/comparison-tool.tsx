"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  quoteApiErrorResponseSchema,
  quoteApiResponseSchema,
  type QuoteApiRequest,
  type QuoteApiResponse,
} from "@/domain/quote-api";
import {
  supportedCurrencyCodeSchema,
  type QuoteResult,
  type SupportedCurrencyCode,
} from "@/domain/quote";
import { createComparisonRequest } from "@/components/comparison-request";
import { ProviderResultCard, type PlanView } from "@/components/provider-result-card";
import { ComingSoonSection } from "@/components/coming-soon-section";
import type { Language } from "@/components/fintech-shell";

const activeProviderIds = new Set(["REVOLUT", "ZEN", "WISE"]);
const genericApiErrorMessage = "A quote szolgáltatás válasza nem feldolgozható.";
const initialRequest = createComparisonRequest({
  sourceCurrency: "HUF",
  targetCurrency: "EUR",
  sourceAmount: "100000",
});

const copy = {
  hu: {
    eyebrow: "Valódi szolgáltatói eredmények, egy helyen",
    titleStart: "Ne hagyd a pénzed",
    titleAccent: "az árrésben.",
    intro:
      "A NeoRate megmutatja, mennyit kapsz kézhez a szolgáltató által visszaadott díjak után. Indikatív, átlátható és összehasonlítható.",
    source: "Ebből váltok",
    target: "Ezt szeretném kapni",
    amount: "Összeg",
    compare: "Összehasonlítás",
    loading: "Árfolyamok betöltése…",
    best: "Legjobb indikatív eredmény",
    noBest: "Nincs rangsorolható ajánlat",
    received: "Várhatóan ennyit kapsz",
    activeTitle: "Aktív szolgáltatók",
    activeIntro: "A sorrend a teljes forrásoldali költségre jutó kapott összeg alapján frissül.",
    freePlans: "Ingyenes csomagok",
    allPlans: "Minden csomag",
    directionNote: "A két irány külön szolgáltatói ár. Egyik sem a másik egyszerű reciproka.",
    partial: "Egy vagy több szolgáltató most nem adott érvényes ajánlatot.",
    empty: "Jelenleg nincs elérhető számszerű ajánlat.",
    unrankable: "Van tájékoztató ajánlat, de egyik sem rangsorolható.",
  },
  en: {
    eyebrow: "Real provider results in one place",
    titleStart: "Keep more of your money.",
    titleAccent: "See the real spread.",
    intro:
      "NeoRate shows what you receive after fees returned by each provider source. Indicative, transparent and comparable.",
    source: "You send",
    target: "You receive",
    amount: "Amount",
    compare: "Compare",
    loading: "Loading quotes…",
    best: "Best indicative result",
    noBest: "No rankable quote",
    received: "Estimated amount received",
    activeTitle: "Active providers",
    activeIntro: "Results are ordered by the amount received relative to total source-side cost.",
    freePlans: "Free plans",
    allPlans: "All plans",
    directionNote:
      "Each direction is priced independently; one is not the simple reciprocal of the other.",
    partial: "One or more providers did not return a valid quote.",
    empty: "No numeric quote is currently available.",
    unrankable: "Informational quotes exist, but none can be ranked.",
  },
} as const;

type ViewState =
  | { status: "idle" | "loading" }
  | { status: "success"; data: QuoteApiResponse }
  | { status: "error"; message: string };

function formatMoney(amount: string, currency: string, language: Language): string {
  return new Intl.NumberFormat(language === "hu" ? "hu-HU" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "HUF" ? 0 : 2,
  }).format(Number(amount));
}

async function fetchQuotes(
  request: QuoteApiRequest,
  signal?: AbortSignal,
): Promise<QuoteApiResponse> {
  const response = await fetch("/api/v1/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(genericApiErrorMessage);
  }
  if (!response.ok) {
    const parsedError = quoteApiErrorResponseSchema.safeParse(payload);
    throw new Error(
      parsedError.success ? parsedError.data.error.message : "A kérés sikertelen volt.",
    );
  }
  const parsed = quoteApiResponseSchema.safeParse(payload);
  if (!parsed.success) throw new Error(genericApiErrorMessage);
  return parsed.data;
}

export function ComparisonTool({ language }: { language: Language }) {
  const t = copy[language];
  const [sourceCurrency, setSourceCurrency] = useState<SupportedCurrencyCode>("HUF");
  const [targetCurrency, setTargetCurrency] = useState<SupportedCurrencyCode>("EUR");
  const [amount, setAmount] = useState("100000");
  const [planView, setPlanView] = useState<PlanView>("FREE_ONLY");
  const [expandedProviders, setExpandedProviders] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState<ViewState>({ status: "loading" });

  const request = useMemo(
    () =>
      createComparisonRequest({
        sourceCurrency,
        targetCurrency,
        sourceAmount: amount.trim().replace(",", "."),
      }),
    [amount, sourceCurrency, targetCurrency],
  );

  useEffect(() => {
    const saved = window.sessionStorage.getItem("neorate-plan-view");
    if (saved !== "FREE_ONLY" && saved !== "ALL_PLANS") return;
    const timeoutId = window.setTimeout(() => setPlanView(saved), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchQuotes(initialRequest, controller.signal).then(
      (data) => setView({ status: "success", data }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setView({
          status: "error",
          message: error instanceof Error ? error.message : "A kérés sikertelen volt.",
        });
      },
    );
    return () => controller.abort();
  }, []);

  async function submitComparison(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setView({ status: "loading" });
    try {
      const data = await fetchQuotes(request);
      setView({ status: "success", data });
    } catch (error) {
      setView({
        status: "error",
        message: error instanceof Error ? error.message : "A kérés sikertelen volt.",
      });
    }
  }

  function swapCurrencies() {
    setSourceCurrency(targetCurrency);
    setTargetCurrency(sourceCurrency);
  }

  function selectPlanView(next: PlanView) {
    setPlanView(next);
    window.sessionStorage.setItem("neorate-plan-view", next);
  }

  function toggleProvider(providerId: string) {
    setExpandedProviders((current) => {
      const next = new Set(current);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  }

  const data = view.status === "success" ? view.data : undefined;
  const results: QuoteResult[] =
    data === undefined
      ? []
      : [...data.quotes, ...data.issues].filter((result) =>
          activeProviderIds.has(result.provider.id),
        );
  const bestQuote = data?.quotes.find((quote) => quote.provider.id === data.bestProviderId);
  const statusMessage =
    view.status === "error"
      ? view.message
      : data?.sourceStatus === "PARTIAL_SUCCESS"
        ? t.partial
        : data?.sourceStatus === "NO_AVAILABLE_QUOTES"
          ? t.empty
          : data?.sourceStatus === "NO_RANKABLE_QUOTES"
            ? t.unrankable
            : "";

  return (
    <>
      <section className="fintech-hero-grid" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-eyebrow">{t.eyebrow}</p>
          <h1 id="hero-title">
            {t.titleStart} <span>{t.titleAccent}</span>
          </h1>
          <p className="hero-intro">{t.intro}</p>
          <div className="hero-trust-row" aria-label="Adatminőségi alapelvek">
            <span>● LIVE_UNOFFICIAL</span>
            <span>
              ● {language === "hu" ? "Nincs kitalált fallback" : "No fabricated fallback"}
            </span>
          </div>
        </div>

        <form className="converter-card" onSubmit={submitComparison}>
          <div className="converter-heading">
            <div>
              <span className="field-kicker">{t.amount}</span>
              <div className="amount-control">
                <input
                  aria-label={`${t.amount} ${sourceCurrency}`}
                  value={amount}
                  inputMode="decimal"
                  onChange={(event) => setAmount(event.target.value)}
                />
                <select
                  aria-label={t.source}
                  value={sourceCurrency}
                  onChange={(event) => {
                    const next = supportedCurrencyCodeSchema.parse(event.target.value);
                    setSourceCurrency(next);
                    if (next === targetCurrency) setTargetCurrency(next === "EUR" ? "HUF" : "EUR");
                  }}
                >
                  <option value="HUF">🇭🇺 HUF</option>
                  <option value="EUR">🇪🇺 EUR</option>
                </select>
              </div>
            </div>
            <button
              className="swap-button"
              type="button"
              onClick={swapCurrencies}
              aria-label={language === "hu" ? "Pénznemek felcserélése" : "Swap currencies"}
            >
              ⇅
            </button>
            <div className="target-currency">
              <span className="field-kicker">{t.target}</span>
              <select
                aria-label={t.target}
                value={targetCurrency}
                onChange={(event) => {
                  const next = supportedCurrencyCodeSchema.parse(event.target.value);
                  setTargetCurrency(next);
                  if (next === sourceCurrency) setSourceCurrency(next === "EUR" ? "HUF" : "EUR");
                }}
              >
                <option value="EUR">🇪🇺 EUR</option>
                <option value="HUF">🇭🇺 HUF</option>
              </select>
            </div>
          </div>

          <div className="best-result-panel" aria-live="polite">
            <div>
              <span className="field-kicker">{bestQuote ? t.best : t.noBest}</span>
              <strong>
                {bestQuote
                  ? formatMoney(
                      bestQuote.targetAmount.amount,
                      bestQuote.targetAmount.currency,
                      language,
                    )
                  : "—"}
              </strong>
              <small>{t.received}</small>
            </div>
            <span className="best-provider-chip">{bestQuote?.provider.name ?? "NeoRate"}</span>
          </div>

          <button className="primary-action" type="submit" disabled={view.status === "loading"}>
            {view.status === "loading" ? t.loading : t.compare}
            <span aria-hidden="true">→</span>
          </button>
          <p className="converter-note">{t.directionNote}</p>
          <p className="form-status" role="status" aria-live="polite">
            {statusMessage}
          </p>
        </form>
      </section>

      <main className="results-shell" id="results">
        <div className="results-heading">
          <div>
            <p className="section-kicker">NeoRate ranking</p>
            <h2>{t.activeTitle}</h2>
            <p>{t.activeIntro}</p>
          </div>
          <div
            className="plan-toggle"
            role="group"
            aria-label={language === "hu" ? "Csomagok megjelenítése" : "Plan visibility"}
          >
            {(
              [
                ["FREE_ONLY", t.freePlans],
                ["ALL_PLANS", t.allPlans],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={planView === value}
                onClick={() => selectPlanView(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="provider-list" aria-busy={view.status === "loading"}>
          {view.status === "loading" && results.length === 0 ? (
            <div className="loading-card">{t.loading}</div>
          ) : null}
          {results.map((result, index) => (
            <ProviderResultCard
              key={result.provider.id}
              result={result}
              rank={
                result.kind === "quote" && result.rankingStatus === "ELIGIBLE" ? index + 1 : null
              }
              bestProviderId={data?.bestProviderId ?? null}
              planView={planView}
              expanded={expandedProviders.has(result.provider.id)}
              onToggle={() => toggleProvider(result.provider.id)}
              language={language}
            />
          ))}
          {view.status === "error" && results.length === 0 ? (
            <div className="error-card" role="alert">
              {view.message}
            </div>
          ) : null}
        </div>

        <aside className="source-warning">
          <strong>{language === "hu" ? "Fontos:" : "Important:"}</strong>{" "}
          {language === "hu"
            ? "A Revolut, ZEN és Wise nyilvános, nem dokumentált forrásai indikatívak. Az ajánlat végrehajtása előtt mindig ellenőrizd a szolgáltató saját appját."
            : "Revolut, ZEN and Wise use public undocumented sources and remain indicative. Always confirm the executable quote in the provider app."}
          {data ? (
            <span>
              {" "}
              {language === "hu" ? "Frissítve:" : "Updated:"}{" "}
              {new Intl.DateTimeFormat(language === "hu" ? "hu-HU" : "en-GB", {
                dateStyle: "short",
                timeStyle: "medium",
                timeZone: "Europe/Budapest",
              }).format(new Date(data.generatedAt))}
            </span>
          ) : null}
        </aside>

        <ComingSoonSection language={language} />
      </main>
    </>
  );
}

export { PlanCards } from "@/components/plan-cards";
