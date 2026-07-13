import { describe, expect, it } from "vitest";
import { QuoteApiRequestError, quoteApiFieldMessage } from "@/components/quote-api-errors";

describe("quoteApiFieldMessage", () => {
  it("surfaces the provider-context validation message for the Revolut usage field", () => {
    const error = new QuoteApiRequestError("Request validation failed.", {
      providerContexts: ["Expected a non-negative plain decimal string"],
    });

    expect(quoteApiFieldMessage(error, "providerContexts")).toBe(
      "Expected a non-negative plain decimal string",
    );
  });

  it("does not invent a field message for unrelated failures", () => {
    expect(quoteApiFieldMessage(new Error("network"), "providerContexts")).toBeUndefined();
  });
});
