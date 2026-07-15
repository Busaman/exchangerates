"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  quoteApiErrorResponseSchema,
  quoteApiResponseSchema,
  type QuoteApiRequest,
  type QuoteApiResponse,
} from "@/domain/quote-api";
import {
  supportedCurrencyCodeSchema,
  revolutPersonalPlanSchema,
  type RevolutPersonalPlan,
  type QuoteResult,
  type SupportedCurrencyCode,
} from "@/domain/quote";
import {
  bestResultBadgeLabel,
  isFeeCoverageIncompleteQuote,
  isFullAllowanceAssumedQuote,
} from "@/components/comparison-labels";
import { formatExactFeeAmount, formatFeePercentage } from "@/components/comparison-format";
import {
  comparisonProviderSelectionSchema,
  createComparisonRequest,
  type ComparisonProviderSelection,
} from "@/components/comparison-request";

const currencyNames = {
  EUR: "EUR · euró",
  HUF: "HUF · forint",
} as const;

const initialRequest = createComparisonRequest({
  sourceCurrency: "EUR",
  targetCurrency: "HUF",
  sourceAmount: "1000",
  providerSelection: "REVOLUT",
  revolutPlan: "STANDARD",
});

const providerSelectionNames: Readonly<Record<ComparisonProviderSelection, string>> = {
  REVOLUT: "Revolut",
  ALL_REGISTERED: "Összes regisztrált szolgáltató (mockkal)",
};

const revolutPlanNames: Readonly<Record<RevolutPersonalPlan, string>> = {
  STANDARD: "Standard",
  PLUS: "Plus",
  PREMIUM: "Premium",
  METAL: "Metal",
  ULTRA: "Ultra",
};

const genericApiErrorMessage = "A quote szolgáltatás válasza nem feldolgozható.";

type ViewState =
  | { status: "loading" }
  | { status: "success"; data: QuoteApiResponse }
  | { status: "error"; message: string };

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("hu-HU", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "HUF" ? 0 : 2,
  }).format(Number(amount));
}

function labelForStatus(result: QuoteResult): string {
  if (result.kind === "unavailable") return "Nem elérhető";
  if (result.kind === "error")
    return result.errorCode === "PROVIDER_TIMEOUT" ? "Időtúllépés" : "Hiba";
  if (result.rankingStatus === "EXCLUDED_INCOMPLETE_FEES") {
    return `${result.sourceType} · ${result.freshness} · NEM RANGSOROLT`;
  }
  if (result.status === "STALE") return "Elavult · STALE";
  if (result.sourceType === "LIVE_UNOFFICIAL") {
    return `Élő · LIVE_UNOFFICIAL · ${result.freshness}`;
  }
  return result.sourceType === "MOCK" ? `Mock adat · ${result.freshness}` : result.status;
}

function formatRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : rate;
}

function formatTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("hu-HU", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Budapest",
  }).format(new Date(timestamp));
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
    if (parsedError.success) {
      throw new Error(parsedError.data.error.message);
    }
    throw new Error("A kérés sikertelen volt.");
  }

  const parsedResponse = quoteApiResponseSchema.safeParse(payload);
  if (!parsedResponse.success) throw new Error(genericApiErrorMessage);
  return parsedResponse.data;
}

export function ComparisonTool() {
  const [sourceCurrency, setSourceCurrency] = useState<SupportedCurrencyCode>("EUR");
  const [targetCurrency, setTargetCurrency] = useState<SupportedCurrencyCode>("HUF");
  const [amount, setAmount] = useState("1000");
  const [providerSelection, setProviderSelection] =
    useState<ComparisonProviderSelection>("REVOLUT");
  const [revolutPlan, setRevolutPlan] = useState<RevolutPersonalPlan>("STANDARD");
  const [view, setView] = useState<ViewState>({ status: "loading" });

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
      const data = await fetchQuotes(
        createComparisonRequest({
          sourceCurrency,
          targetCurrency,
          sourceAmount: amount.trim().replace(",", "."),
          providerSelection,
          revolutPlan,
        }),
      );
      setView({ status: "success", data });
    } catch (error) {
      setView({
        status: "error",
        message: error instanceof Error ? error.message : "A kérés sikertelen volt.",
      });
    }
  }

  const data = view.status === "success" ? view.data : undefined;
  const results: QuoteResult[] = data === undefined ? [] : [...data.quotes, ...data.issues];

  function swapCurrencies() {
    setSourceCurrency(targetCurrency);
    setTargetCurrency(sourceCurrency);
  }

  return (
    <section
      aria-labelledby="comparison-title"
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1b2d]/90 shadow-2xl shadow-black/20"
    >
      <form onSubmit={submitComparison} className="border-b border-white/10 p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="comparison-title" className="text-xl font-semibold">
              Váltási összehasonlítás
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              A teljes forrásoldali költségre jutó kapott összeg szerint rendezve, a szolgáltatói
              forrás által visszaadott díjakkal.
            </p>
          </div>
          <span className="rounded-md bg-rose-400/10 px-2.5 py-1 font-mono text-xs font-semibold text-rose-200">
            INDIKATÍV · NEM VÉGREHAJTHATÓ
          </span>
        </div>
        <div className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            Szolgáltató
            <select
              value={providerSelection}
              onChange={(event) =>
                setProviderSelection(comparisonProviderSelectionSchema.parse(event.target.value))
              }
              className="h-11 rounded-lg border border-white/10 bg-[#12233a] px-3 text-white"
            >
              {Object.entries(providerSelectionNames).map(([provider, name]) => (
                <option key={provider} value={provider}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            Revolut személyes csomag
            <select
              value={revolutPlan}
              onChange={(event) =>
                setRevolutPlan(revolutPersonalPlanSchema.parse(event.target.value))
              }
              className="h-11 rounded-lg border border-white/10 bg-[#12233a] px-3 text-white"
            >
              {Object.entries(revolutPlanNames).map(([plan, name]) => (
                <option key={plan} value={plan}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5 text-slate-400 sm:col-span-2">
            A nyilvános konverter nem ismeri a fiókod elmúlt 30 napi kerethasználatát. Az API által
            a kiválasztott csomaghoz és pontos összeghez visszaadott díjat mutatjuk egyszer. Ez
            best-case adat: az official webes konverter dinamikus keretdíja eltérhet a publikus
            endpoint válaszától, ezért a személyes végleges ajánlatot ellenőrizd az appban.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_1.2fr_auto] md:items-end">
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            Ebből
            <select
              value={sourceCurrency}
              onChange={(event) => {
                const next = supportedCurrencyCodeSchema.parse(event.target.value);
                setSourceCurrency(next);
                if (next === targetCurrency) setTargetCurrency(next === "EUR" ? "HUF" : "EUR");
              }}
              className="h-12 rounded-lg border border-white/10 bg-[#12233a] px-3 text-white"
            >
              {Object.entries(currencyNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={swapCurrencies}
            aria-label="Pénznemek felcserélése"
            className="mb-0.5 h-11 rounded-lg border border-white/10 px-4 text-lg text-slate-300 hover:bg-white/5 md:w-11 md:px-0"
          >
            ⇄
          </button>
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            Ebbe
            <select
              value={targetCurrency}
              onChange={(event) => {
                const next = supportedCurrencyCodeSchema.parse(event.target.value);
                setTargetCurrency(next);
                if (next === sourceCurrency) setSourceCurrency(next === "EUR" ? "HUF" : "EUR");
              }}
              className="h-12 rounded-lg border border-white/10 bg-[#12233a] px-3 text-white"
            >
              {Object.entries(currencyNames).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            Küldött összeg
            <div className="flex h-12 items-center rounded-lg border border-white/10 bg-[#12233a] focus-within:border-emerald-300">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                aria-describedby="amount-help"
                className="min-w-0 flex-1 bg-transparent px-3 text-lg font-semibold outline-none"
              />
              <span className="pr-3 font-mono text-sm text-slate-400">{sourceCurrency}</span>
            </div>
          </label>
          <button
            type="submit"
            disabled={view.status === "loading"}
            className="h-12 rounded-lg bg-emerald-400 px-5 font-semibold text-slate-950 hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-60"
          >
            {view.status === "loading" ? "Betöltés…" : "Összehasonlítás"}
          </button>
        </div>
        <p
          id="amount-help"
          className="mt-3 min-h-5 text-sm text-rose-300"
          role="status"
          aria-live="polite"
        >
          {view.status === "error" ? view.message : ""}
          {data?.sourceStatus === "PARTIAL_SUCCESS"
            ? "Egy vagy több szolgáltató nem adott elérhető ajánlatot."
            : ""}
          {data?.sourceStatus === "NO_AVAILABLE_QUOTES" ? "Nincs elérhető számszerű ajánlat." : ""}
          {data?.sourceStatus === "NO_RANKABLE_QUOTES"
            ? "Van tájékoztató ajánlat, de hiányos díjadat miatt egyik sem rangsorolható."
            : ""}
        </p>
        <p className="text-xs leading-5 text-slate-400">
          Aktív irány: {sourceCurrency} eladása → {targetCurrency} vétele. A szolgáltatói spread
          miatt a fordított irány árfolyama nem ennek matematikai reciproka.
        </p>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead className="border-b border-white/10 bg-white/[0.025] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium sm:px-7">Szolgáltató</th>
              <th className="px-4 py-3 font-medium">Kapott összeg</th>
              <th className="px-4 py-3 font-medium">Effektív árfolyam</th>
              <th className="px-4 py-3 font-medium">Díj</th>
              <th className="px-4 py-3 font-medium">Adatállapot</th>
              <th className="px-5 py-3 font-medium sm:px-7">Időbélyegek</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {results.map((result) => (
              <tr
                key={result.provider.id}
                className={
                  data?.bestProviderId === result.provider.id ? "bg-emerald-300/[0.035]" : undefined
                }
              >
                <td className="px-5 py-5 sm:px-7">
                  <div className="font-semibold text-white">{result.provider.name}</div>
                  {result.kind === "quote" &&
                  result.providerDetails?.type === "REVOLUT_PERSONAL" ? (
                    <span className="mt-1 block text-xs text-slate-400">
                      Személyes csomag: {revolutPlanNames[result.providerDetails.plan]}
                    </span>
                  ) : null}
                  {isFullAllowanceAssumedQuote(result) ? (
                    <span className="mt-1 block text-xs font-medium text-amber-200">
                      FULL_ALLOWANCE_ASSUMED · best-case · teljes keret feltételezve
                    </span>
                  ) : null}
                  {isFeeCoverageIncompleteQuote(result) &&
                  result.kind === "quote" &&
                  result.providerDetails?.feeCoverageWarning ? (
                    <span className="mt-2 block max-w-md text-xs leading-5 text-rose-200">
                      {result.providerDetails.feeCoverageWarning}
                    </span>
                  ) : null}
                  {bestResultBadgeLabel(result, data?.bestProviderId) !== null && (
                    <span className="mt-1 inline-block text-xs font-medium text-emerald-300">
                      {bestResultBadgeLabel(result, data?.bestProviderId)}
                    </span>
                  )}
                </td>
                {result.kind === "quote" ? (
                  <>
                    <td className="px-4 py-5 text-lg font-semibold text-white">
                      {formatMoney(result.targetAmount.amount, result.targetAmount.currency)}
                    </td>
                    <td className="px-4 py-5 font-mono text-sm text-slate-300">
                      {result.providerDetails?.type === "REVOLUT_PERSONAL" ? (
                        <span className="mb-2 grid gap-1 text-xs text-slate-500">
                          <span>
                            Irány szerinti nyers ráta: 1 {result.pair.sourceCurrency} ={" "}
                            {formatRate(result.providerDetails.displayedBaseRate)}{" "}
                            {result.pair.targetCurrency}
                          </span>
                          {result.providerDetails.sourceCurrencyPerTargetUnit ? (
                            <span className="text-amber-200">
                              Ugyanez a HUF → EUR irány: 1 EUR ≈{" "}
                              {formatRate(result.providerDetails.sourceCurrencyPerTargetUnit)} HUF
                              forrásköltség
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                      <span className="block">
                        Szolgáltatói effektív: 1 {result.pair.sourceCurrency} ={" "}
                        {formatRate(result.effectiveRate)} {result.pair.targetCurrency}
                      </span>
                      <span
                        className={`mt-1 block text-xs ${result.rankingStatus === "ELIGIBLE" ? "text-emerald-200" : "text-rose-200"}`}
                      >
                        {result.rankingStatus === "ELIGIBLE"
                          ? "Költségnormalizált rangsorolási ráta"
                          : "Nem rangsorolt endpoint-költségráta"}
                        : 1 {result.pair.sourceCurrency} = {formatRate(result.rankingEffectiveRate)}{" "}
                        {result.pair.targetCurrency}
                      </span>
                      {result.providerDetails?.type === "REVOLUT_PERSONAL" &&
                      result.providerDetails.endpointRecipientAmount !== undefined ? (
                        <span className="mt-2 grid gap-1 text-xs text-slate-500">
                          <span>
                            Endpoint recipient kijelzés:{" "}
                            {formatMoney(
                              result.providerDetails.endpointRecipientAmount.amount,
                              result.providerDetails.endpointRecipientAmount.currency,
                            )}
                          </span>
                          <span>
                            NeoRate normalizálás: nyers irányráta × forrásösszeg, lefelé kerekítve a
                            célpénznem pontosságára.
                          </span>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-5 text-sm text-slate-300">
                      {result.providerDetails?.type === "REVOLUT_PERSONAL" ? (
                        <span className="grid gap-1 text-xs">
                          <span>
                            FX díj:{" "}
                            {formatExactFeeAmount(
                              result.providerDetails.fxFee.amount,
                              result.providerDetails.feeCurrency,
                            )}
                          </span>
                          <span>
                            Nyilvános endpoint által visszaadott összes díj:{" "}
                            {formatExactFeeAmount(
                              result.providerDetails.totalFee.amount,
                              result.providerDetails.feeCurrency,
                            )}
                          </span>
                          <span>
                            Díj aránya a küldött összeghez:{" "}
                            {result.providerDetails.feePercentage === undefined
                              ? "Nem elérhető"
                              : formatFeePercentage(result.providerDetails.feePercentage)}
                          </span>
                          <strong className="text-slate-200">
                            Teljes forrásoldali költség:{" "}
                            {formatMoney(
                              result.providerDetails.totalSourceCost.amount,
                              result.providerDetails.feeCurrency,
                            )}
                          </strong>
                          {result.providerDetails.fxTooltip ? (
                            <span className="max-w-xs text-slate-400">
                              {result.providerDetails.fxTooltip}
                            </span>
                          ) : null}
                          {result.providerDetails.planTooltipLong ? (
                            <span className="max-w-xs text-slate-400">
                              Endpoint tooltip: {result.providerDetails.planTooltipLong}
                            </span>
                          ) : null}
                        </span>
                      ) : (
                        formatMoney(result.explicitFee.amount, result.explicitFee.currency)
                      )}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-4 py-5 text-sm text-slate-500">
                    {result.reason} Nincs megjeleníthető számszerű ajánlat.
                  </td>
                )}
                <td className="px-4 py-5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${result.kind === "quote" ? "bg-amber-400/10 text-amber-200" : "bg-slate-400/10 text-slate-400"}`}
                  >
                    {labelForStatus(result)}
                  </span>
                </td>
                <td className="px-5 py-5 font-mono text-xs text-slate-500 sm:px-7">
                  {result.kind === "quote" ? (
                    <span className="grid gap-1">
                      <span>Árfolyam: {formatTimestamp(result.rateTimestamp)}</span>
                      <span>Lekérés: {formatTimestamp(result.retrievedAt)}</span>
                    </span>
                  ) : (
                    <span>Lekérés: {formatTimestamp(result.retrievedAt)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-amber-300/15 bg-amber-300/[0.045] px-5 py-4 text-sm leading-6 text-amber-100/80 sm:px-7">
        {data?.warnings.includes("MOCK_DATA") ? (
          <>
            <strong className="text-amber-100">Figyelem:</strong> a megjelenített ajánlat
            determinisztikus mock adat, nem élő vagy végrehajtható árfolyam.{" "}
          </>
        ) : null}
        {data?.warnings.includes("REVOLUT_INDICATIVE") ? (
          <>
            <strong className="text-amber-100">Revolut:</strong> a nyilvános JSON-konverter ajánlata
            LIVE_UNOFFICIAL besorolású, indikatív best-case eredmény, amely teljes rendelkezésre
            álló keretet feltételez. A durván kerekített endpoint-recipient helyett a kifizetést a
            live nyers rátából, a célpénznem pontosságára lefelé kerekítve normalizáljuk. Nem ismeri
            a fiókod tényleges kerethasználatát; a végrehajtható árfolyamot és díjakat mindig
            ellenőrizd a Revolut appban.{" "}
          </>
        ) : null}
        {data?.warnings.includes("REVOLUT_FEE_INCOMPLETE") ? (
          <>
            <strong className="text-rose-200">Hiányos Revolut-díjadat:</strong> legalább egy
            Revolut-sor csak tájékoztató jelleggel látható, és nem vesz részt a legjobb eredmény
            kiválasztásában. A végleges díjat ellenőrizd a Revolut appban.{" "}
          </>
        ) : null}
        {view.status === "loading" ? "A quote API válaszára várunk." : null}
        {view.status === "error" ? "A legutóbbi quote API kérés sikertelen volt." : null}
        {data !== undefined
          ? `Utolsó frissítés: ${new Intl.DateTimeFormat("hu-HU", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Budapest" }).format(new Date(data.generatedAt))}`
          : null}
      </div>
    </section>
  );
}
