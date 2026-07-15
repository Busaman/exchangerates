import { decimal, decimalPattern, decimalToPlainString } from "@/domain/decimal";

type MonetaryValue = Readonly<{ currency: string; amount: string }>;

export function calculateRankingEffectiveRate({
  sourceAmount,
  targetAmount,
  totalSourceCost,
}: {
  sourceAmount: MonetaryValue;
  targetAmount: MonetaryValue;
  totalSourceCost?: MonetaryValue;
}): string {
  const denominator = totalSourceCost ?? sourceAmount;
  if (denominator.currency !== sourceAmount.currency) {
    throw new TypeError("Total source cost currency must match the source currency");
  }
  if (!decimalPattern.test(denominator.amount) || !decimal(denominator.amount).greaterThan(0)) {
    throw new TypeError("Ranking denominator must be a positive decimal string");
  }
  if (!decimalPattern.test(targetAmount.amount) || !decimal(targetAmount.amount).greaterThan(0)) {
    throw new TypeError("Ranking target amount must be a positive decimal string");
  }

  return decimalToPlainString(decimal(targetAmount.amount).dividedBy(denominator.amount));
}
