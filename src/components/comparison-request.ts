import type { QuoteApiRequest } from "@/domain/quote-api";
import type { RevolutPersonalPlan, SupportedCurrencyCode } from "@/domain/quote";

export const activeComparisonProviderIds = ["REVOLUT", "ZEN", "WISE"] as const;

type ComparisonRequestInput = {
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
  sourceAmount: string;
  revolutPlan?: RevolutPersonalPlan;
};

export function createComparisonRequest({
  sourceCurrency,
  targetCurrency,
  sourceAmount,
  revolutPlan = "STANDARD",
}: ComparisonRequestInput): QuoteApiRequest {
  return {
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    customerPlan: null,
    providers: [...activeComparisonProviderIds],
    providerContexts: { REVOLUT: { plan: revolutPlan } },
  };
}
