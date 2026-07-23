import { currencyFractionDigits, decimal, decimalToPlainString } from "@/domain/decimal";
import { supportedCurrencyCodeSchema } from "@/domain/quote";

function localizedPlainDecimal(value: string, minimumFractionDigits: number): string {
  const normalized = decimalToPlainString(decimal(value));
  const [integerPart, fractionPart = ""] = normalized.split(".");
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const fraction = fractionPart.padEnd(minimumFractionDigits, "0");
  return fraction.length === 0 ? groupedInteger : `${groupedInteger},${fraction}`;
}

export function formatExactFeeAmount(amount: string, currency: string): string {
  const supportedCurrency = supportedCurrencyCodeSchema.parse(currency);
  return `${localizedPlainDecimal(amount, currencyFractionDigits[supportedCurrency])} ${supportedCurrency}`;
}

export function formatFeePercentage(value: string): string {
  const percentage = decimal(value);
  if (percentage.lessThan(0)) throw new RangeError("Fee percentage must not be negative");

  if (percentage.isZero()) return "0,00%";

  let fractionDigits = percentage.lessThan(1) ? 4 : 2;
  while (percentage.toDecimalPlaces(fractionDigits).isZero() && fractionDigits < 10) {
    fractionDigits += 1;
  }

  return `${percentage.toFixed(fractionDigits).replace(".", ",")}%`;
}

export function formatComparisonRate(rate: string, targetCurrency: string): string {
  const supportedCurrency = supportedCurrencyCodeSchema.parse(targetCurrency);
  const maximumFractionDigits = supportedCurrency === "HUF" ? 4 : 8;
  const rounded = decimal(rate)
    .toDecimalPlaces(maximumFractionDigits)
    .toFixed(maximumFractionDigits);

  return rounded.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
