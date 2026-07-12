"use client";

import { useMemo, useState } from "react";
import type { CurrencyCode, QuoteResult } from "@/domain/quote";
import { createMockQuote, mockProvider } from "@/providers/mock-provider";
import { createUnavailableQuote, unavailableProvider } from "@/providers/unavailable-provider";

const currencyNames: Readonly<Record<string, string>> = {
  EUR: "EUR · euró",
  HUF: "HUF · forint",
};

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat("hu-HU", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "HUF" ? 0 : 2,
  }).format(Number(amount));
}

function labelForStatus(result: QuoteResult): string {
  if (result.kind === "unavailable") return "Nem elérhető";
  if (result.status === "STALE") return "Elavult";
  return result.sourceType === "MOCK" ? "Mock adat" : result.status;
}

export function ComparisonTool({ generatedAt }: { generatedAt: string }) {
  const [sourceCurrency, setSourceCurrency] = useState<CurrencyCode>("EUR");
  const [targetCurrency, setTargetCurrency] = useState<CurrencyCode>("HUF");
  const [amount, setAmount] = useState("1000");

  const results = useMemo<QuoteResult[]>(() => {
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return [];

    const baseRequest = {
      sourceCurrency,
      targetCurrency,
      sourceAmount: numericAmount.toFixed(2),
      requestedAt: generatedAt,
    };

    return [
      createMockQuote({ ...baseRequest, providerId: mockProvider.id }),
      createUnavailableQuote({ ...baseRequest, providerId: unavailableProvider.id }),
    ];
  }, [amount, generatedAt, sourceCurrency, targetCurrency]);

  function swapCurrencies() {
    setSourceCurrency(targetCurrency);
    setTargetCurrency(sourceCurrency);
  }

  return (
    <section
      aria-labelledby="comparison-title"
      className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d1b2d]/90 shadow-2xl shadow-black/20"
    >
      <div className="border-b border-white/10 p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="comparison-title" className="text-xl font-semibold">
              Váltási összehasonlítás
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              A kapott összeg szerint rendezve, minden ismert díj levonása után.
            </p>
          </div>
          <span className="rounded-md bg-rose-400/10 px-2.5 py-1 font-mono text-xs font-semibold text-rose-200">
            MOCK · NEM ÉLŐ
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr_1.2fr] md:items-end">
          <label className="grid gap-2 text-sm font-medium text-slate-300">
            Ebből
            <select
              value={sourceCurrency}
              onChange={(event) => {
                const next = event.target.value as CurrencyCode;
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
                const next = event.target.value as CurrencyCode;
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
        </div>
        <p id="amount-help" className="mt-2 min-h-5 text-sm text-rose-300" role="status">
          {results.length === 0 ? "Adj meg nullánál nagyobb, érvényes összeget." : ""}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead className="border-b border-white/10 bg-white/[0.025] text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium sm:px-7">Szolgáltató</th>
              <th className="px-4 py-3 font-medium">Kapott összeg</th>
              <th className="px-4 py-3 font-medium">Effektív árfolyam</th>
              <th className="px-4 py-3 font-medium">Díj</th>
              <th className="px-4 py-3 font-medium">Adatállapot</th>
              <th className="px-5 py-3 font-medium sm:px-7">Frissítve</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {results.map((result, index) => (
              <tr
                key={result.provider.id}
                className={
                  index === 0 && result.kind === "quote" ? "bg-emerald-300/[0.035]" : undefined
                }
              >
                <td className="px-5 py-5 sm:px-7">
                  <div className="font-semibold text-white">{result.provider.name}</div>
                  {index === 0 && result.kind === "quote" && (
                    <span className="mt-1 inline-block text-xs font-medium text-emerald-300">
                      Legjobb elérhető mock eredmény
                    </span>
                  )}
                </td>
                {result.kind === "quote" ? (
                  <>
                    <td className="px-4 py-5 text-lg font-semibold text-white">
                      {formatMoney(result.targetAmount.amount, result.targetAmount.currency)}
                    </td>
                    <td className="px-4 py-5 font-mono text-sm text-slate-300">
                      1 {sourceCurrency} = {result.effectiveRate} {targetCurrency}
                    </td>
                    <td className="px-4 py-5 text-sm text-slate-300">
                      {formatMoney(result.explicitFee.amount, result.explicitFee.currency)}
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="px-4 py-5 text-sm text-slate-500">
                    Nincs megjeleníthető számszerű ajánlat.
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
                  {new Intl.DateTimeFormat("hu-HU", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Europe/Budapest",
                  }).format(new Date(result.retrievedAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-amber-300/15 bg-amber-300/[0.045] px-5 py-4 text-sm leading-6 text-amber-100/80 sm:px-7">
        <strong className="text-amber-100">Figyelem:</strong> a fenti Demo Fintech adatsor
        determinisztikus mock. A Wise sor szándékosan nem elérhető, és nem kap helyettesítő piaci
        középárfolyamot.
      </div>
    </section>
  );
}
