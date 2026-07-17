import { decimal, decimalToPlainString } from "@/domain/decimal";
import { planQuoteSchema, type PlanQuote } from "@/domain/plan-quote";
import type { SupportedCurrencyCode } from "@/domain/quote";
import { isRevolutWeekend } from "@/providers/revolut/revolut-fee-coverage";
import type { RevolutQuoteObservation } from "@/providers/revolut/revolut-quote-client";

export const revolutPricingPolicyUrl = "https://www.revolut.com/hu-HU/legal/standard-fees/";
export const revolutPricingPolicyRetrievedAt = "2026-07-17";

export const revolutPlanPolicy = [
  {
    plan: "STANDARD",
    monthlyFee: "0",
    allowance: "350000",
    excessRate: "0.01",
    isDefaultPlan: true,
  },
  {
    plan: "PLUS",
    monthlyFee: "1600",
    allowance: "1050000",
    excessRate: "0.005",
    isDefaultPlan: false,
  },
  {
    plan: "PREMIUM",
    monthlyFee: "3000",
    allowance: undefined,
    excessRate: "0",
    isDefaultPlan: false,
  },
  {
    plan: "METAL",
    monthlyFee: "4800",
    allowance: undefined,
    excessRate: "0",
    isDefaultPlan: false,
  },
  {
    plan: "ULTRA",
    monthlyFee: "19500",
    allowance: undefined,
    excessRate: "0",
    isDefaultPlan: false,
  },
] as const;

function unavailablePlan({
  policy,
  observation,
  reason,
  pricingWindow,
}: {
  policy: (typeof revolutPlanPolicy)[number];
  observation: RevolutQuoteObservation;
  reason: string;
  pricingWindow: "WEEKDAY" | "WEEKEND_UNVERIFIED";
}): PlanQuote {
  return planQuoteSchema.parse({
    provider: "REVOLUT",
    plan: policy.plan,
    isDefaultPlan: policy.isDefaultPlan,
    isPaidPlan: policy.monthlyFee !== "0",
    monthlyFee: { currency: "HUF", amount: policy.monthlyFee },
    ...(policy.allowance === undefined
      ? {}
      : { monthlyAllowance: { currency: "HUF", amount: policy.allowance } }),
    assumedMonthlyUsage: { currency: "HUF", amount: "0" },
    baseMarkup: "0",
    excessMarkup: policy.excessRate,
    offMarketMarkup: pricingWindow === "WEEKEND_UNVERIFIED" ? "0.01" : "0",
    totalMarkup: policy.excessRate,
    pricingWindow,
    quoteKind: "unavailable",
    calculationNote: reason,
    source: {
      sourceType: "OFFICIAL_POLICY",
      sourceId: "revolut-hungary-personal-plan-policy",
      sourceUrl: revolutPricingPolicyUrl,
      policySourceUrl: revolutPricingPolicyUrl,
    },
    fetchedAt: observation.retrievedAt,
    rankingEligibility: "EXCLUDED",
    rankingExclusionReason: reason,
  });
}

/**
 * Preserves the live Standard quote and fails paid plans closed. Simultaneous live evidence proves
 * fee-on-top semantics inside Standard, but amount-dependent rates and absent paid-plan responses
 * do not prove a common plan-independent base rate.
 */
export function calculateRevolutPlanQuotes({
  observation,
  sourceCurrency,
  targetCurrency,
  requestedAt,
}: {
  observation: RevolutQuoteObservation;
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
  requestedAt: string;
}): PlanQuote[] {
  const weekend = isRevolutWeekend(new Date(requestedAt));
  const pricingWindow = weekend ? "WEEKEND_UNVERIFIED" : "WEEKDAY";

  return revolutPlanPolicy.map((policy) => {
    if (policy.plan !== "STANDARD") {
      return unavailablePlan({
        policy,
        observation,
        pricingWindow,
        reason: weekend
          ? "A hétvégi csomagár nem számítható biztonságosan: az élő endpoint hétvégi base-rate és fee szemantikája az issue #5 lezárásáig nincs validálva."
          : "Élő csomagárfolyam nem számítható biztonságosan: a publikus végpont csak Standard quote-ot ad, és az összegfüggő rate miatt közös csomagfüggetlen base rate nem bizonyított.",
      });
    }

    const effectiveRate = decimalToPlainString(
      decimal(observation.targetAmount).dividedBy(observation.sourceAmount),
    );

    return planQuoteSchema.parse({
      provider: "REVOLUT",
      plan: policy.plan,
      isDefaultPlan: policy.isDefaultPlan,
      isPaidPlan: policy.monthlyFee !== "0",
      monthlyFee: { currency: "HUF", amount: policy.monthlyFee },
      ...(policy.allowance === undefined
        ? {}
        : { monthlyAllowance: { currency: "HUF", amount: policy.allowance } }),
      assumedMonthlyUsage: { currency: "HUF", amount: "0" },
      baseMarkup: "0",
      excessMarkup: policy.excessRate,
      offMarketMarkup: weekend ? "0.01" : "0",
      totalMarkup: policy.excessRate,
      pricingWindow,
      quoteKind: "live",
      liveBaseRate: observation.rate,
      effectiveRate,
      inverseRate: decimalToPlainString(decimal(1).dividedBy(effectiveRate)),
      feeAmount: { currency: sourceCurrency, amount: observation.totalFee.amount },
      feeCurrency: sourceCurrency,
      totalSourceCost: observation.totalSourceCost,
      recipientGets: { currency: targetCurrency, amount: observation.targetAmount },
      calculationNote:
        "Élő, anonim publikus Revolut Standard quote; a live recipient és fee változatlan, nincs kétszer alkalmazott díj.",
      source: {
        sourceType: "LIVE_UNOFFICIAL",
        sourceId: "revolut-public-json-quote",
        sourceUrl: observation.sourceUrl,
        policySourceUrl: revolutPricingPolicyUrl,
      },
      fetchedAt: observation.retrievedAt,
      rankingEligibility: weekend ? "EXCLUDED" : "DEFAULT_PLAN_ELIGIBLE",
      ...(weekend
        ? {
            rankingExclusionReason:
              "A live Standard hétvégi quote megjeleníthető, de a hétvégi endpoint-díjlefedettség még nincs igazolva.",
          }
        : {}),
    });
  });
}
