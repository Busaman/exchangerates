import Decimal from "decimal.js";

export const decimalPattern = /^(0|[1-9]\d*)(\.\d+)?$/;
export const maximumSourceAmount = "1000000000000";

const ExactDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100,
});

export const currencyFractionDigits = {
  EUR: 2,
  HUF: 0,
} as const;

export type SupportedCurrency = keyof typeof currencyFractionDigits;

export function decimal(value: Decimal.Value): Decimal {
  return new ExactDecimal(value);
}

export function roundDecimal(value: Decimal.Value, fractionDigits: number): string {
  return decimal(value)
    .toDecimalPlaces(fractionDigits, Decimal.ROUND_HALF_UP)
    .toFixed(fractionDigits);
}

export function compareDecimalStrings(left: string, right: string): number {
  if (!decimalPattern.test(left) || !decimalPattern.test(right)) {
    throw new TypeError("Expected non-negative plain decimal strings");
  }

  return decimal(left).comparedTo(decimal(right));
}

export function isAllowedSourceAmount(value: string): boolean {
  if (!decimalPattern.test(value)) return false;
  const amount = decimal(value);
  return amount.isPositive() && amount.lessThanOrEqualTo(maximumSourceAmount);
}
