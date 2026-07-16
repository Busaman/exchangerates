export function classifyWiseExpectation({ expectWise, wisePresent }) {
  if (expectWise) {
    if (wisePresent) {
      return {
        failureCount: 0,
        validationResult: "PASS",
      };
    }

    return {
      failureCount: 1,
      failureCode: "WISE_PROVIDER_MISSING",
      validationResult: "FAIL",
    };
  }

  if (wisePresent) {
    return {
      failureCount: 1,
      failureCode: "UNEXPECTED_WISE_PRESENT",
      validationResult: "FAIL",
    };
  }

  return {
    failureCount: 0,
    validationResult: "EXPECTED_WISE_ABSENT",
  };
}
