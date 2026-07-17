import { decimal, decimalToPlainString } from "@/domain/decimal";
import { planQuoteSchema, type PlanQuote } from "@/domain/plan-quote";
import type { SupportedCurrencyCode } from "@/domain/quote";
import { zenQuoteSourceId } from "@/providers/zen/zen-config";

export const zenPricingPolicyUrl = "https://www.zen.com/files/pricing/individual_pricing.pdf";
export const zenPricingPolicyRetrievedAt = "2026-07-17";
export const zenOffMarketTimeZone = "Europe/Warsaw";

export const zenPlanPolicy = [
  { plan: "Free", monthlyFee: "0", baseMarkup: "0.005", isDefaultPlan: true },
  { plan: "Gold", monthlyFee: "0.9", baseMarkup: "0.002", isDefaultPlan: false },
  { plan: "Platinum", monthlyFee: "6.9", baseMarkup: "0", isDefaultPlan: false },
  { plan: "Pro", monthlyFee: "6.9", baseMarkup: "0", isDefaultPlan: false },
] as const;

export type ZenPlan = (typeof zenPlanPolicy)[number]["plan"];

const warsawClock = new Intl.DateTimeFormat("en-US", {
  timeZone: zenOffMarketTimeZone,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function isZenOffMarketWindow(at: Date): boolean {
  if (Number.isNaN(at.getTime())) throw new RangeError("Expected a valid ZEN quote timestamp");
  const parts = warsawClock.formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hourText = parts.find((part) => part.type === "hour")?.value;
  const minuteText = parts.find((part) => part.type === "minute")?.value;
  if (weekday === undefined || hourText === undefined || minuteText === undefined) {
    throw new Error("Could not classify the ZEN off-market window");
  }
  const minutes = Number(hourText) * 60 + Number(minuteText);
  return (
    weekday === "Sat" ||
    (weekday === "Fri" && minutes >= 21 * 60) ||
    (weekday === "Sun" && minutes < 22 * 60)
  );
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
    const effectiveRate = proRate.dividedBy(decimal(1).plus(totalMarkup));
    const inverseRate = decimal(1).dividedBy(effectiveRate);
    const recipientGets =
      policy.plan === "Pro"
        ? decimalToPlainString(endpointTargetAmount)
        : decimalToPlainString(source.times(effectiveRate));
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
      liveBaseRate: decimalToPlainString(proRate),
      effectiveRate: decimalToPlainString(effectiveRate),
      inverseRate: decimalToPlainString(inverseRate),
      totalSourceCost: { currency: sourceCurrency, amount: decimalToPlainString(source) },
      recipientGets: { currency: targetCurrency, amount: recipientGets },
      calculationNote:
        policy.plan === "Pro"
          ? "Élő ZEN Pro quote; az exchangeRate változtatás nélkül megőrizve."
          : "Élő ZEN Pro alapárfolyamból, a hivatalos csomagfelár alapján számítva. A havi díj nincs beleszámítva ebbe az egyszeri váltásba.",
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
