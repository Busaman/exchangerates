const decimalPattern = /^(0|[1-9]\d*)(\.\d+)?$/;

function normalizedParts(value: string): { integer: string; fraction: string } {
  if (!decimalPattern.test(value)) {
    throw new TypeError(`Invalid non-negative decimal string: ${value}`);
  }

  const [rawInteger, rawFraction = ""] = value.split(".");
  return {
    integer: rawInteger.replace(/^0+(?=\d)/, ""),
    fraction: rawFraction.replace(/0+$/, ""),
  };
}

/** Compares validated, non-negative decimal strings without binary floating-point conversion. */
export function compareDecimalStrings(left: string, right: string): number {
  const leftParts = normalizedParts(left);
  const rightParts = normalizedParts(right);

  if (leftParts.integer.length !== rightParts.integer.length) {
    return leftParts.integer.length > rightParts.integer.length ? 1 : -1;
  }

  if (leftParts.integer !== rightParts.integer) {
    return leftParts.integer > rightParts.integer ? 1 : -1;
  }

  const fractionLength = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftFraction = leftParts.fraction.padEnd(fractionLength, "0");
  const rightFraction = rightParts.fraction.padEnd(fractionLength, "0");

  if (leftFraction === rightFraction) return 0;
  return leftFraction > rightFraction ? 1 : -1;
}

/** Formats deterministic mock calculations while preserving significant integer zeroes. */
export function formatMockDecimal(value: number, fractionDigits: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Mock decimal value must be finite and non-negative");
  }

  const fixed = value.toFixed(fractionDigits);
  if (/[eE]/.test(fixed)) {
    throw new RangeError("Mock decimal value is outside the supported fixed-point range");
  }

  if (fractionDigits === 0) return fixed;
  return fixed.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}
