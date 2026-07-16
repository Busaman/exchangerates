import { describe, expect, it } from "vitest";
import { classifyWiseExpectation } from "./wise-investigation-expectation.mjs";

describe("classifyWiseExpectation", () => {
  it("passes when Wise is expected and present", () => {
    expect(classifyWiseExpectation({ expectWise: true, wisePresent: true })).toEqual({
      failureCount: 0,
      validationResult: "PASS",
    });
  });

  it("fails when Wise is expected but absent", () => {
    expect(classifyWiseExpectation({ expectWise: true, wisePresent: false })).toEqual({
      failureCount: 1,
      failureCode: "WISE_PROVIDER_MISSING",
      validationResult: "FAIL",
    });
  });

  it("records an expected absence when Wise is not expected and absent", () => {
    expect(classifyWiseExpectation({ expectWise: false, wisePresent: false })).toEqual({
      failureCount: 0,
      validationResult: "EXPECTED_WISE_ABSENT",
    });
  });

  it("fails and contributes to the failure count when Wise is unexpectedly present", () => {
    const result = classifyWiseExpectation({ expectWise: false, wisePresent: true });

    expect(result).toEqual({
      failureCount: 1,
      failureCode: "UNEXPECTED_WISE_PRESENT",
      validationResult: "FAIL",
    });
    expect(result.failureCount).toBe(1);
  });
});
