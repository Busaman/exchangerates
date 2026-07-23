import type { Language } from "@/components/fintech-shell";
import { formatExactFeeAmount } from "@/components/comparison-format";
import type { PlanQuote } from "@/domain/plan-quote";

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

export function PlanCards({
  plans,
  language = "hu",
}: {
  plans: readonly PlanQuote[];
  language?: Language;
}) {
  return (
    <div className="plan-grid">
      {plans.map((plan) => (
        <article className="plan-card" key={plan.plan}>
          <div className="plan-card-heading">
            <div>
              <h4>{plan.plan}</h4>
              <span>
                {plan.isDefaultPlan ? (language === "hu" ? "Alapcsomag" : "Default") : ""}
              </span>
            </div>
            <span className={`quote-kind ${plan.quoteKind}`}>{plan.quoteKind}</span>
          </div>
          <dl>
            <div>
              <dt>{language === "hu" ? "Havi díj" : "Monthly fee"}</dt>
              <dd>{formatMoney(plan.monthlyFee.amount, plan.monthlyFee.currency, language)}</dd>
            </div>
            <div>
              <dt>{language === "hu" ? "Teljes felár" : "Total markup"}</dt>
              <dd>{formatRate(plan.totalMarkup)}</dd>
            </div>
            {plan.quoteKind !== "unavailable" ? (
              <>
                <div>
                  <dt>{language === "hu" ? "Kapott összeg" : "Amount received"}</dt>
                  <dd>
                    {formatMoney(plan.recipientGets.amount, plan.recipientGets.currency, language)}
                  </dd>
                </div>
                <div>
                  <dt>{language === "hu" ? "Effektív ráta" : "Effective rate"}</dt>
                  <dd>{formatRate(plan.effectiveRate)}</dd>
                </div>
                <div>
                  <dt>{language === "hu" ? "Díj" : "Fee"}</dt>
                  <dd>
                    {plan.feeAmount
                      ? formatExactFeeAmount(plan.feeAmount.amount, plan.feeAmount.currency)
                      : language === "hu"
                        ? "Árfolyamba épített"
                        : "Embedded in rate"}
                  </dd>
                </div>
              </>
            ) : (
              <div className="plan-unavailable">
                {language === "hu"
                  ? "Nincs biztonságosan megjeleníthető élő szám."
                  : "No safely displayable live numeric quote."}
              </div>
            )}
          </dl>
          <p>{plan.calculationNote}</p>
        </article>
      ))}
    </div>
  );
}
