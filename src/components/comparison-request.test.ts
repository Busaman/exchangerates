import { describe, expect, it } from "vitest";
import { createComparisonRequest } from "@/components/comparison-request";

describe("createComparisonRequest", () => {
  it("sends exactly the three operational providers with Revolut Standard context", () => {
    expect(
      createComparisonRequest({
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "100000",
        revolutPlan: "STANDARD",
      }),
    ).toEqual({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      sourceAmount: "100000",
      providers: ["REVOLUT", "ZEN", "WISE"],
      customerPlan: null,
      providerContexts: {
        REVOLUT: { plan: "STANDARD" },
      },
    });
  });

  it("keeps the selected direction and exact amount in the active-provider request", () => {
    expect(
      createComparisonRequest({
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        sourceAmount: "1000",
      }),
    ).toMatchObject({
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
      providers: ["REVOLUT", "ZEN", "WISE"],
    });
  });
});
