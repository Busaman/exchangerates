import Decimal from "decimal.js";
import {
  currencyFractionDigits,
  decimal,
  decimalToPlainString,
  roundDownDecimal,
} from "@/domain/decimal";
import type {
  RevolutPersonalContext,
  RevolutPersonalPlan,
  SupportedCurrencyCode,
} from "@/domain/quote";

export const revolutPersonalFeePolicy = {
  STANDARD: { allowanceHuf: "350000", fairUsageFeeRate: "0.01" },
  PLUS: { allowanceHuf: "1050000", fairUsageFeeRate: "0.005" },
  PREMIUM: { allowanceHuf: null, fairUsageFeeRate: "0" },
  METAL: { allowanceHuf: null, fairUsageFeeRate: "0" },
  ULTRA: { allowanceHuf: null, fairUsageFeeRate: "0" },
  weekendFeeRate: "0.01",
  weekendTimeZone: "America/New_York",
} as const satisfies Record<RevolutPersonalPlan, unknown> & {
  weekendFeeRate: string;
  weekendTimeZone: string;
};

export type RevolutMarketSession = "WEEKDAY" | "WEEKEND";

export type RevolutFeeCalculation = Readonly<{
  plan: RevolutPersonalPlan;
  marketSession: RevolutMarketSession;
  displayedBaseRate: string;
  fairUsageFee: string;
  weekendFee: string;
  totalFee: string;
  targetAmount: string;
  effectiveRate: string;
  feeCurrency: SupportedCurrencyCode;
  fairUsageAllowanceHuf: string | null;
  allowanceUsedBeforeQuoteHuf: string;
  allowanceConsumedByQuoteHuf: string;
  remainingAllowanceAfterQuoteHuf: string | null;
}>;

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: revolutPersonalFeePolicy.weekendTimeZone,
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function classifyRevolutMarketSession(at: Date): RevolutMarketSession {
  const parts = Object.fromEntries(
    etFormatter.formatToParts(at).map((part) => [part.type, part.value]),
  );
  const weekday = parts.weekday;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const isWeekend =
    (weekday === "Fri" && minutes >= 17 * 60) ||
    weekday === "Sat" ||
    (weekday === "Sun" && minutes < 18 * 60);
  return isWeekend ? "WEEKEND" : "WEEKDAY";
}

function maximum(value: Decimal, floor: Decimal.Value): Decimal {
  return value.greaterThan(floor) ? value : decimal(floor);
}

export function calculateRevolutPersonalQuote({
  sourceCurrency,
  targetCurrency,
  sourceAmount: sourceAmountInput,
  displayedBaseRate: displayedBaseRateInput,
  personalContext,
  at,
}: {
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
  sourceAmount: string;
  displayedBaseRate: string;
  personalContext: RevolutPersonalContext;
  at: Date;
}): RevolutFeeCalculation {
  const sourceAmount = decimal(sourceAmountInput);
  const displayedBaseRate = decimal(displayedBaseRateInput);
  const allowanceUsedBefore = decimal(personalContext.monthlyExchangeUsedHuf);
  const planPolicy = revolutPersonalFeePolicy[personalContext.plan];
  const allowanceConsumed =
    sourceCurrency === "HUF" ? sourceAmount : sourceAmount.times(displayedBaseRate);
  const marketSession = classifyRevolutMarketSession(at);

  let fairUsageFee = decimal(0);
  let remainingAllowanceAfter: Decimal | null = null;
  if (planPolicy.allowanceHuf !== null) {
    const allowance = decimal(planPolicy.allowanceHuf);
    const remainingBefore = maximum(allowance.minus(allowanceUsedBefore), 0);
    const overAllowanceHuf = maximum(allowanceConsumed.minus(remainingBefore), 0);
    const overAllowanceInSource =
      sourceCurrency === "HUF" ? overAllowanceHuf : overAllowanceHuf.dividedBy(displayedBaseRate);
    fairUsageFee = overAllowanceInSource.times(planPolicy.fairUsageFeeRate);
    remainingAllowanceAfter = maximum(
      allowance.minus(allowanceUsedBefore).minus(allowanceConsumed),
      0,
    );
  }

  const weekendFee =
    marketSession === "WEEKEND"
      ? sourceAmount.times(revolutPersonalFeePolicy.weekendFeeRate)
      : decimal(0);
  const totalFee = fairUsageFee.plus(weekendFee);
  const unroundedTarget = sourceAmount.minus(totalFee).times(displayedBaseRate);
  const targetAmount = roundDownDecimal(unroundedTarget, currencyFractionDigits[targetCurrency]);
  const effectiveRate = decimal(targetAmount).dividedBy(sourceAmount);

  if (
    !sourceAmount.isPositive() ||
    !displayedBaseRate.isPositive() ||
    !effectiveRate.isPositive()
  ) {
    throw new Error("Revolut quote calculation did not produce a positive result");
  }

  return {
    plan: personalContext.plan,
    marketSession,
    displayedBaseRate: decimalToPlainString(displayedBaseRate),
    fairUsageFee: decimalToPlainString(fairUsageFee),
    weekendFee: decimalToPlainString(weekendFee),
    totalFee: decimalToPlainString(totalFee),
    targetAmount,
    effectiveRate: decimalToPlainString(effectiveRate),
    feeCurrency: sourceCurrency,
    fairUsageAllowanceHuf: planPolicy.allowanceHuf,
    allowanceUsedBeforeQuoteHuf: decimalToPlainString(allowanceUsedBefore),
    allowanceConsumedByQuoteHuf: decimalToPlainString(allowanceConsumed),
    remainingAllowanceAfterQuoteHuf:
      remainingAllowanceAfter === null ? null : decimalToPlainString(remainingAllowanceAfter),
  };
}
