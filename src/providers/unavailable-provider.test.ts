import { describe, expect, it } from "vitest";
import { createUnavailableQuote } from "@/providers/unavailable-provider";

describe("createUnavailableQuote", () => {
  it("returns no numeric fields when provider data is unavailable", () => {
    const result = createUnavailableQuote({
      providerId: "wise",
      sourceCurrency: "EUR",
      targetCurrency: "HUF",
      sourceAmount: "1000",
      requestedAt: "2026-01-01T12:00:00.000Z",
    });

    expect(result.status).toBe("UNAVAILABLE");
    expect(result).not.toHaveProperty("targetAmount");
    expect(result).not.toHaveProperty("effectiveRate");
  });
});
