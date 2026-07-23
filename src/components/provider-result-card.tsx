import type { Language } from "@/components/fintech-shell";
import {
  formatComparisonRate,
  formatExactFeeAmount,
  formatFeePercentage,
} from "@/components/comparison-format";
import {
  bestResultBadgeLabel,
  isFeeCoverageIncompleteQuote,
  isFullAllowanceAssumedQuote,
} from "@/components/comparison-labels";
import { PlanCards } from "@/components/plan-cards";
import type { ProviderIdentifier, QuoteResult } from "@/domain/quote";

export type PlanView = "FREE_ONLY" | "ALL_PLANS";

const providerMarks = {
  REVOLUT: { label: "R", className: "provider-mark revolut" },
  ZEN: { label: "Z", className: "provider-mark zen" },
  WISE: { label: "W", className: "provider-mark wise" },
} as const;

function formatMoney(amount: string, currency: string, language: Language): string {
  return new Intl.NumberFormat(language === "hu" ? "hu-HU" : "en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: currency === "HUF" ? 0 : 2,
  }).format(Number(amount));
}

function formatRate(rate: string): string {
  return rate.includes(".") ? rate.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "") : rate;
}

function formatTimestamp(timestamp: string, language: Language): string {
  return new Intl.DateTimeFormat(language === "hu" ? "hu-HU" : "en-GB", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Budapest",
  }).format(new Date(timestamp));
}

function statusLabel(result: QuoteResult): string {
  if (result.kind === "unavailable") return "UNAVAILABLE";
  if (result.kind === "error") return result.errorCode;
  if (result.status === "STALE") return "STALE";
  return `${result.sourceType} · ${result.freshness}`;
}

export function ProviderResultCard({
  result,
  rank,
  bestProviderId,
  planView,
  expanded,
  onToggle,
  language,
}: {
  result: QuoteResult;
  rank: number | null;
  bestProviderId: ProviderIdentifier | null;
  planView: PlanView;
  expanded: boolean;
  onToggle: () => void;
  language: Language;
}) {
  const mark =
    result.provider.id in providerMarks
      ? providerMarks[result.provider.id as keyof typeof providerMarks]
      : { label: result.provider.name.slice(0, 1), className: "provider-mark" };
  const badge = bestResultBadgeLabel(result, bestProviderId);
  const plans =
    result.kind === "quote" && result.planQuotes
      ? planView === "FREE_ONLY"
        ? result.planQuotes.filter((plan) => plan.isDefaultPlan)
        : result.planQuotes
      : [];
  const hasPlans = result.kind === "quote" && result.planQuotes !== undefined;

  return (
    <article className={`provider-card ${result.provider.id === bestProviderId ? "best" : ""}`}>
      <div className="provider-card-main">
        <div className="provider-rank" aria-label={rank === null ? "Unranked" : `Rank ${rank}`}>
          {rank === null ? "—" : String(rank).padStart(2, "0")}
        </div>
        <div className={mark.className} aria-hidden="true">
          {mark.label}
        </div>
        <div className="provider-identity">
          <h3>{result.provider.name}</h3>
          <span>
            {result.kind === "quote"
              ? result.customerPlan
              : language === "hu"
                ? "Most nem elérhető"
                : "Currently unavailable"}
          </span>
          {badge ? <em>{language === "hu" ? badge : "Best available indicative result"}</em> : null}
        </div>

        {result.kind === "quote" ? (
          <>
            <div className="provider-payout">
              <span>{language === "hu" ? "Kapott összeg" : "You receive"}</span>
              <strong>
                {formatMoney(result.targetAmount.amount, result.targetAmount.currency, language)}
              </strong>
              <small>
                1 {result.pair.sourceCurrency} ={" "}
                {formatComparisonRate(result.rankingEffectiveRate, result.pair.targetCurrency)}{" "}
                {result.pair.targetCurrency}
              </small>
            </div>
            <div className="provider-state">
              <span>{statusLabel(result)}</span>
              <small>{formatTimestamp(result.retrievedAt, language)}</small>
            </div>
          </>
        ) : (
          <div className="provider-unavailable">
            <strong>{language === "hu" ? "Nincs élő adat" : "No live data"}</strong>
            <span>{result.reason}</span>
          </div>
        )}

        {hasPlans ? (
          <button
            type="button"
            className="expand-button"
            aria-expanded={expanded}
            aria-controls={`provider-details-${result.provider.id}`}
            onClick={onToggle}
          >
            <span className="sr-only">
              {language === "hu" ? "Csomagrészletek" : "Plan details"}
            </span>
            {expanded ? "−" : "+"}
          </button>
        ) : null}
      </div>

      {result.kind === "quote" && (
        <div className="provider-trust-strip">
          <span>
            {language === "hu" ? "Nyers ráta" : "Raw rate"}:{" "}
            {result.providerDetails?.type === "REVOLUT_PERSONAL"
              ? formatRate(result.providerDetails.displayedBaseRate)
              : result.providerDetails?.type === "ZEN_PLANS"
                ? formatRate(result.providerDetails.liveProRate)
                : result.providerDetails?.type === "WISE_PERSONAL"
                  ? formatRate(result.providerDetails.displayedBaseRate)
                  : formatRate(result.effectiveRate)}
          </span>
          <span>
            {language === "hu" ? "Effektív ráta" : "Effective rate"}:{" "}
            {formatRate(result.effectiveRate)}
          </span>
          <span>
            {language === "hu" ? "Díj" : "Fee"}:{" "}
            {result.providerDetails?.type === "REVOLUT_PERSONAL"
              ? `${formatExactFeeAmount(
                  result.providerDetails.totalFee.amount,
                  result.providerDetails.totalFee.currency,
                )} (${formatFeePercentage(result.providerDetails.feePercentage)})`
              : result.providerDetails?.type === "WISE_PERSONAL"
                ? formatExactFeeAmount(
                    result.providerDetails.endpointFee.amount,
                    result.providerDetails.endpointFee.currency,
                  )
                : language === "hu"
                  ? "árfolyamba épített"
                  : "embedded in rate"}
          </span>
        </div>
      )}

      {result.kind === "quote" && isFullAllowanceAssumedQuote(result) ? (
        <p className="provider-alert">
          FULL_ALLOWANCE_ASSUMED ·{" "}
          {language === "hu"
            ? "best-case, teljes keret feltételezve"
            : "best-case, full allowance assumed"}
        </p>
      ) : null}
      {result.kind === "quote" && result.providerDetails?.type === "WISE_PERSONAL" ? (
        <p className="provider-alert">
          {language === "hu"
            ? "Banki átutalásos összehasonlítás; nem account-specifikus vagy végrehajtható ajánlat."
            : "Bank-transfer comparison; not an account-specific or executable quote."}
        </p>
      ) : null}
      {isFeeCoverageIncompleteQuote(result) ? (
        <p className="provider-alert danger">
          {language === "hu"
            ? "A díjfedezet nem teljesen ellenőrzött; ez a sor nem vesz részt a rangsorban."
            : "Fee coverage is not fully verified; this row is excluded from ranking."}
        </p>
      ) : null}

      {hasPlans && expanded ? (
        <div className="provider-details" id={`provider-details-${result.provider.id}`}>
          <PlanCards plans={plans} language={language} />
        </div>
      ) : null}
    </article>
  );
}
