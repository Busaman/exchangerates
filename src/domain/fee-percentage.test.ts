import { describe, expect, it } from "vitest";
import { calculateSourceSideFeePercentage } from "@/domain/fee-percentage";

describe("calculateSourceSideFeePercentage", () => {
  it("uses total fee divided by the exact sender amount", () => {
    expect(calculateSourceSideFeePercentage({ totalFee: "0", senderAmount: "980" })).toBe("0");
    expect(calculateSourceSideFeePercentage({ totalFee: "0.01", senderAmount: "981" })).toBe(
      "0.001019367991845056065239551478083588175331",
    );
  });
});
