export const unverifiedWeekendFeeWarning =
  'Figyelem: a Revolut nyilvános végpontjának hétvégi díjlefedettsége még nincs igazolva. A megjelenített díj ezért hiányos lehet, az ajánlat nem vesz részt a „legjobb" rangsorolásban. A tényleges díjat mindig a Revolut appban ellenőrizd.';

const newYorkClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

export type RevolutFeeCoverageAssessment = Readonly<{
  sessionClassification: "WEEKDAY" | "WEEKEND";
  feeCoverage: "ENDPOINT_REPORTED_BEST_CASE" | "UNVERIFIED_WEEKEND";
  rankingStatus: "ELIGIBLE" | "EXCLUDED_INCOMPLETE_FEES";
  rankingExclusionReason?: "WEEKEND_FEE_UNVERIFIED";
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

export function evaluateRevolutFeeCoverage({ at }: { at: Date }): RevolutFeeCoverageAssessment {
  if (isRevolutWeekend(at)) {
    return {
      sessionClassification: "WEEKEND",
      feeCoverage: "UNVERIFIED_WEEKEND",
      rankingStatus: "EXCLUDED_INCOMPLETE_FEES",
      rankingExclusionReason: "WEEKEND_FEE_UNVERIFIED",
      feeCoverageWarning: unverifiedWeekendFeeWarning,
    };
  }

  return {
    sessionClassification: "WEEKDAY",
    feeCoverage: "ENDPOINT_REPORTED_BEST_CASE",
    rankingStatus: "ELIGIBLE",
  };
}
