import { z } from "zod";
import type { QuoteApiRequest } from "@/domain/quote-api";
import type { RevolutPersonalPlan, SupportedCurrencyCode } from "@/domain/quote";

export const comparisonProviderSelectionSchema = z.enum(["REVOLUT", "ZEN", "ALL_REGISTERED"]);

export type ComparisonProviderSelection = z.infer<typeof comparisonProviderSelectionSchema>;

type ComparisonRequestInput = {
  sourceCurrency: SupportedCurrencyCode;
  targetCurrency: SupportedCurrencyCode;
  sourceAmount: string;
  providerSelection: ComparisonProviderSelection;
  revolutPlan: RevolutPersonalPlan;
};

export function createComparisonRequest({
  sourceCurrency,
  targetCurrency,
  sourceAmount,
  providerSelection,
  revolutPlan,
}: ComparisonRequestInput): QuoteApiRequest {
  const baseRequest: QuoteApiRequest = {
    sourceCurrency,
    targetCurrency,
    sourceAmount,
    customerPlan: null,
  };

  if (providerSelection === "ZEN") {
    return { ...baseRequest, providers: ["ZEN"] };
  }

  const request: QuoteApiRequest = {
    ...baseRequest,
    providerContexts: { REVOLUT: { plan: revolutPlan } },
  };

  if (providerSelection === "REVOLUT") {
    return { ...request, providers: ["REVOLUT"] };
  }

  return request;
}
