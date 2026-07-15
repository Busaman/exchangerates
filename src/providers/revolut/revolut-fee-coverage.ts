import { decimal, decimalToPlainString } from "@/domain/decimal";
import type { RevolutPersonalPlan } from "@/domain/quote";
import { revolutQuoteClientConfig, type RevolutPairKey } from "@/providers/revolut/revolut-config";

export const revolutFairUsageAllowanceHuf = revolutQuoteClientConfig.fairUsageAllowanceHuf;

export const missingFairUsageFeeWarning =
  'Figyelem: a Revolut nyilvános végpontja ennél az összegnél nem adja vissza a méltányos használati díjat, amelyet a hivatalos Revolut konverter ugyanerre az összegre felszámít. A megjelenített díj ezért hiányos, az ajánlat nem vesz részt a „legjobb" rangsorolásban. A tényleges díjat mindig a Revolut appban ellenőrizd.';

export const unverifiedWeekendFeeWarning =
  'Figyelem: a Revolut nyilvános végpontjának hétvégi díjlefedettsége még nincs igazolva. A megjelenített díj ezért hiányos lehet, az ajánlat nem vesz részt a „legjobb" rangsorolásban. A tényleges díjat mindig a Revolut appban ellenőrizd.';

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export type RevolutFeeCoverageAssessment = Readonly<{
  allowanceConsumptionHuf: string;
  fairUsageAllowanceHuf?: string;
  sessionClassification: "WEEKDAY" | "WEEKEND";
  feeCoverage: "ENDPOINT_REPORTED_BEST_CASE" | "INCOMPLETE_FAIR_USAGE" | "UNVERIFIED_WEEKEND";
  rankingStatus: "ELIGIBLE" | "EXCLUDED_INCOMPLETE_FEES";
  rankingExclusionReason?: "FAIR_USAGE_FEE_NOT_RETURNED" | "WEEKEND_FEE_UNVERIFIED";
  feeCoverageWarning?: string;
}>;

export function isRevolutWeekend(at: Date): boolean {
  if (Number.isNaN(at.getTime())) throw new RangeError("Expected a valid quote timestamp");
  const parts = newYorkClock.formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hourText = parts.find((part) => part.type === "hour")?.value;
  if (weekday === undefined || hourText === undefined) {
    throw new Error("Could not classify the Revolut fee window");
  }
  const hour = Number(hourText);
  return weekday === "Sat" || (weekday === "Fri" && hour >= 17) || (weekday === "Sun" && hour < 18);
}

export function evaluateRevolutFeeCoverage({
  plan,
  pair,
  sourceAmount,
  rate,
  at,
}: {
  plan: RevolutPersonalPlan;
  pair: RevolutPairKey;
  sourceAmount: string;
  rate: string;
  at: Date;
}): RevolutFeeCoverageAssessment {
  const allowanceConsumptionHuf = decimalToPlainString(
    pair === "EUR-HUF" ? decimal(sourceAmount).times(rate) : decimal(sourceAmount),
  );
  const fairUsageAllowanceHuf =
    plan === "STANDARD" || plan === "PLUS" ? revolutFairUsageAllowanceHuf[plan] : undefined;

  if (isRevolutWeekend(at)) {
    return {
      allowanceConsumptionHuf,
      ...(fairUsageAllowanceHuf === undefined ? {} : { fairUsageAllowanceHuf }),
      sessionClassification: "WEEKEND",
      feeCoverage: "UNVERIFIED_WEEKEND",
      rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
      rankingExclusionReason: "WEEKEND_FEE_UNVERIFIED",
      feeCoverageWarning: unverifiedWeekendFeeWarning,
    };
  }

  if (
    fairUsageAllowanceHuf !== undefined &&
    decimal(allowanceConsumptionHuf).greaterThan(fairUsageAllowanceHuf)
  ) {
    return {
      allowanceConsumptionHuf,
      fairUsageAllowanceHuf,
      sessionClassification: "WEEKDAY",
      feeCoverage: "INCOMPLETE_FAIR_USAGE",
      rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
      rankingExclusionReason: "FAIR_USAGE_FEE_NOT_RETURNED",
      feeCoverageWarning: missingFairUsageFeeWarning,
    };
  }

  return {
    allowanceConsumptionHuf,
    ...(fairUsageAllowanceHuf === undefined ? {} : { fairUsageAllowanceHuf }),
    sessionClassification: "WEEKDAY",
    feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
    rankingStatus: "ELIGIBLE",
  };
}
