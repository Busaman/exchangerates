import { describe, expect, it } from "vitest";
import { normalizeDemoAmount } from "@/components/comparison-input";

describe("normalizeDemoAmount", () => {
  it("normalizes valid dot and comma decimal input", () => {
    expect(normalizeDemoAmount("1000.02")).toBe("1000.02");
    expect(normalizeDemoAmount("1000,5")).toBe("1000.50");
  });

  it("rejects values that would round to zero", () => {
    expect(normalizeDemoAmount("0.004")).toBeNull();
  });

  it("rejects exponential and out-of-range input", () => {
    expect(normalizeDemoAmount("1e21")).toBeNull();
    expect(normalizeDemoAmount("1000000000001")).toBeNull();
  });
});
