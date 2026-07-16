import { decimal, decimalPattern, decimalToPlainString } from "@/domain/decimal";

export const revolutApiAmountUnit = "ONE_HUNDREDTH_MAJOR_UNIT" as const;
export const revolutApiAmountScale = "100";

export class RevolutMoneyCodecError extends Error {
  constructor(
    readonly code: "INVALID_MAJOR_AMOUNT" | "INVALID_API_AMOUNT" | "UNREPRESENTABLE_MAJOR_AMOUNT",
  ) {
    super(`Revolut money codec failed: ${code}`);
    this.name = "RevolutMoneyCodecError";
  }
}

export function toRevolutApiAmount(majorAmount: string): string {
  if (!decimalPattern.test(majorAmount)) {
    throw new RevolutMoneyCodecError("INVALID_MAJOR_AMOUNT");
  }
  const scaled = decimal(majorAmount).times(revolutApiAmountScale);
  if (!scaled.isInteger() || scaled.greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new RevolutMoneyCodecError("UNREPRESENTABLE_MAJOR_AMOUNT");
  }
  return scaled.toFixed(0);
}

export function fromRevolutApiAmount(apiAmount: number | string): string {
  const text = String(apiAmount);
  if (!/^\d+$/.test(text)) throw new RevolutMoneyCodecError("INVALID_API_AMOUNT");
  if (typeof apiAmount === "number" && !Number.isSafeInteger(apiAmount)) {
    throw new RevolutMoneyCodecError("INVALID_API_AMOUNT");
  }
  return decimalToPlainString(decimal(text).dividedBy(revolutApiAmountScale));
}

export function revolutQuoteAmountCacheKey(majorAmount: string): string {
  return `hundredth-v1:${toRevolutApiAmount(majorAmount)}`;
}
