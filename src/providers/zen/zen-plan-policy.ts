import {
  currencyFractionDigits,
  decimal,
  decimalToPlainString,
  roundDownDecimal,
} from "@/domain/decimal";
import { planQuoteSchema, type PlanQuote } from "@/domain/plan-quote";
import type { SupportedCurrencyCode } from "@/domain/quote";
import { zenQuoteSourceId } from "@/providers/zen/zen-config";

export const zenPricingPolicyUrl = "https://www.zen.com/files/pricing/individual_pricing.pdf";
export const zenPricingPolicyRetrievedAt = "2026-07-17";
// The official wording names CET explicitly, so this is fixed UTC+1 even during European summer.
export const zenOffMarketTimeZone = "FIXED_CET_UTC_PLUS_1";

export const zenPlanPolicy = [
  { plan: "Free", monthlyFee: "0", baseMarkup: "0.005", isDefaultPlan: true },
  { plan: "Gold", monthlyFee: "0.9", baseMarkup: "0.002", isDefaultPlan: false },
  { plan: "Platinum", monthlyFee: "6.9", baseMarkup: "0", isDefaultPlan: false },
  { plan: "Pro", monthlyFee: "6.9", baseMarkup: "0", isDefaultPlan: false },
] as const;

export type ZenPlan = (typeof zenPlanPolicy)[number]["plan"];

const fixedCetOffsetMilliseconds = 60 * 60 * 1000;

export function isZenOffMarketWindow(at: Date): boolean {
  if (Number.isNaN(at.getTime())) throw new RangeError("Expected a valid ZEN quote timestamp");
  const fixedCetClock = new Date(at.getTime() + fixedCetOffsetMilliseconds);
  const weekday = fixedCetClock.getUTCDay();
  const minutes = fixedCetClock.getUTCHours() * 60 + fixedCetClock.getUTCMinutes();
  return (
    weekday === 6 || (weekday === 5 && minutes >= 21 * 60) || (weekday === 0 && minutes < 22 * 60)
  );
}

export function calculateZenPolicyTargetRate(liveProRate: string, totalMarkup: string): string {
  const proRate = decimal(liveProRate);
  const markup = decimal(totalMarkup);
  if (!proRate.greaterThan(0) || markup.isNegative()) {
    throw new RangeError(
      "ZEN policy-rate calculation requires a positive Pro rate and markup >= 0",
    );
  }
  return decimalToPlainString(proRate.dividedBy(decimal(1).plus(markup)));
}

export function calculateZenPlanQuotes({
  liveProRate,
  sourceAmount,
  endpointTargetAmount,
  sourceCurrency,
  targetCurrency,
  fetchedAt,
  pricingAt = fetchedAt,
  freshness = "FRESH",
}: {
  liveProRate: string;
  sourceAmount: string;
  endpointTargetAmount: string;
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
  fetchedAt: string;
  pricingAt?: string;
  freshness?: "FRESH" | "STALE";
}): PlanQuote[] {
  const proRate = decimal(liveProRate);
  const source = decimal(sourceAmount);
  if (!proRate.greaterThan(0) || !source.greaterThan(0)) {
    throw new RangeError("ZEN plan derivation requires a positive live Pro rate and source amount");
  }
  const offMarket = isZenOffMarketWindow(new Date(pricingAt));

  return zenPlanPolicy.map((policy) => {
    const offMarketMarkup = offMarket && policy.plan !== "Pro" ? decimal("0.004") : decimal(0);
    const totalMarkup = decimal(policy.baseMarkup).plus(offMarketMarkup);
    const calculationRate = decimal(
      calculateZenPolicyTargetRate(liveProRate, totalMarkup.toFixed()),
    );
    const recipientGets =
      policy.plan === "Pro"
        ? decimalToPlainString(endpointTargetAmount)
        : roundDownDecimal(source.times(calculationRate), currencyFractionDigits[targetCurrency]);
    const effectiveRate = decimal(recipientGets).dividedBy(source);
    if (!effectiveRate.greaterThan(0)) {
      throw new RangeError("ZEN plan payout must remain positive after target-currency rounding");
    }
    const inverseRate = decimal(1).dividedBy(effectiveRate);
    const quoteKind = policy.plan === "Pro" ? "live" : "derived";

    return planQuoteSchema.parse({
      provider: "ZEN",
      plan: policy.plan,
      isDefaultPlan: policy.isDefaultPlan,
      isPaidPlan: policy.monthlyFee !== "0",
      monthlyFee: { currency: "EUR", amount: policy.monthlyFee },
      baseMarkup: policy.baseMarkup,
      excessMarkup: "0",
      offMarketMarkup: decimalToPlainString(offMarketMarkup),
      totalMarkup: decimalToPlainString(totalMarkup),
      pricingWindow: offMarket ? "OFF_MARKET" : "WEEKDAY",
      quoteKind,
      ...(quoteKind === "derived"
        ? { calculationRate: decimalToPlainString(calculationRate) }
        : {}),
      liveBaseRate: decimalToPlainString(proRate),
      effectiveRate: decimalToPlainString(effectiveRate),
      inverseRate: decimalToPlainString(inverseRate),
      totalSourceCost: { currency: sourceCurrency, amount: decimalToPlainString(source) },
      recipientGets: { currency: targetCurrency, amount: recipientGets },
      calculationNote:
        policy.plan === "Pro"
          ? "Élő ZEN Pro quote; az exchangeRate változtatás nélkül megőrizve."
          : "Becsült csomagajánlat: NeoRate a ZEN Rate + X% szabályt proRate / (1 + markup) képletként értelmezi, majd a kifizetést a célpénznem skáláján lefelé kerekíti. A havi díj nincs beleszámítva ebbe az egyszeri váltásba.",
      source: {
        sourceType: "LIVE_UNOFFICIAL",
        sourceId: zenQuoteSourceId,
        sourceUrl: "https://www.zen.com/landing_currencies.php",
        policySourceUrl: zenPricingPolicyUrl,
      },
      fetchedAt,
      rankingEligibility: policy.isDefaultPlan
        ? freshness === "STALE"
          ? "EXCLUDED"
          : "DEFAULT_PLAN_ELIGIBLE"
        : "PLAN_DETAIL_ONLY",
      ...(policy.isDefaultPlan && freshness === "STALE"
        ? { rankingExclusionReason: "A stale ZEN alapmegfigyelés nem vehet részt a rangsorban." }
        : {}),
    });
  });
}
