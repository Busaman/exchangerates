import { describe, expect, it } from "vitest";
import { formatExactFeeAmount, formatFeePercentage } from "@/components/comparison-format";

describe("Revolut fee presentation", () => {
  it("preserves a small positive absolute EUR fee", () => {
    expect(formatExactFeeAmount("0.01", "EUR")).toBe("0,01 EUR");
    expect(formatExactFeeAmount("0.001", "EUR")).toBe("0,001 EUR");
  });

  it("shows enough percentage precision to keep a positive fee visible", () => {
    expect(formatFeePercentage("0")).toBe("0,00%");
    expect(formatFeePercentage("0.001019367991845056065239551478083588175331")).toBe("0,0010%");
    expect(formatFeePercentage("0.01")).toBe("0,0100%");
  });
});
