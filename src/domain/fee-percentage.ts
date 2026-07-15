import { decimal, decimalToPlainString } from "@/domain/decimal";

export const sourceSideFeePercentageBasis = "TOTAL_FEE_DIVIDED_BY_SENDER_AMOUNT" as const;

export function calculateSourceSideFeePercentage({
  totalFee,
  senderAmount,
}: {
  totalFee: string;
  senderAmount: string;
}): string {
  const sender = decimal(senderAmount);
  if (!sender.greaterThan(0)) throw new RangeError("Sender amount must be positive");

  const fee = decimal(totalFee);
  if (fee.lessThan(0)) throw new RangeError("Total fee must not be negative");

  return decimalToPlainString(fee.dividedBy(sender).times(100));
}
