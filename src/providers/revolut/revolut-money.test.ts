import { describe, expect, it } from "vitest";
import {
  fromRevolutApiAmount,
  revolutApiAmountUnit,
  revolutQuoteAmountCacheKey,
  toRevolutApiAmount,
} from "@/providers/revolut/revolut-money";

describe("Revolut fixed-hundredth money codec", () => {
  it("encodes major-unit EUR and HUF amounts as fixed hundredth integers", () => {
    expect(revolutApiAmountUnit).toBe("ONE_HUNDREDTH_MAJOR_UNIT");
    expect(toRevolutApiAmount("965")).toBe("96500");
    expect(toRevolutApiAmount("965.01")).toBe("96501");
    expect(toRevolutApiAmount("100000")).toBe("10000000");
    expect(toRevolutApiAmount("1000.50")).toBe("100050");
  });

  it("decodes all API money fields to normal major units, including HUF", () => {
    expect(fromRevolutApiAmount(2)).toBe("0.02");
    expect(fromRevolutApiAmount(96502)).toBe("965.02");
    expect(fromRevolutApiAmount(34737505)).toBe("347375.05");
    expect(fromRevolutApiAmount("10000000")).toBe("100000");
  });

  it("rejects fractional API units and major amounts that are not exactly representable", () => {
    expect(() => toRevolutApiAmount("965.001")).toThrow("UNREPRESENTABLE_MAJOR_AMOUNT");
    expect(() => fromRevolutApiAmount("2.5")).toThrow("INVALID_API_AMOUNT");
    expect(() => fromRevolutApiAmount(Number.MAX_SAFE_INTEGER + 1)).toThrow("INVALID_API_AMOUNT");
  });

  it("uses decimal arithmetic without floating-point precision loss", () => {
    expect(toRevolutApiAmount("0.29")).toBe("29");
    expect(fromRevolutApiAmount(toRevolutApiAmount("999999999999.99"))).toBe("999999999999.99");
  });

  it("canonicalizes equivalent amounts and separates adjacent amounts", () => {
    expect(revolutQuoteAmountCacheKey("965")).toBe(revolutQuoteAmountCacheKey("965.00"));
    expect(revolutQuoteAmountCacheKey("971")).not.toBe(revolutQuoteAmountCacheKey("972"));
  });
});
