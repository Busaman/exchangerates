import { describe, expect, it } from "vitest";
import { createComparisonRequest } from "@/components/comparison-request";

describe("createComparisonRequest", () => {
  it("sends an explicit Revolut-only HUF to EUR Standard request", () => {
    expect(
      createComparisonRequest({
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "100000",
        providerSelection: "REVOLUT",
        revolutPlan: "STANDARD",
      }),
    ).toEqual({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "100000",
      providers: ["REVOLUT"],
      customerPlan: null,
      providerContexts: {
        REVOLUT: { plan: "STANDARD" },
      },
    });
  });

  it("omits the provider filter only when all registered providers are selected", () => {
    expect(
      createComparisonRequest({
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
        providerSelection: "ALL_REGISTERED",
        revolutPlan: "STANDARD",
      }),
    ).not.toHaveProperty("providers");
  });
});
