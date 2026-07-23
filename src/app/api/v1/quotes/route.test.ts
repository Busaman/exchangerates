import { describe, expect, it, vi } from "vitest";
import { createQuotePostHandler } from "@/app/api/v1/quotes/handler";
import { quoteApiErrorResponseSchema, quoteApiResponseSchema } from "@/domain/quote-api";
import { POST, runtime } from "@/app/api/v1/quotes/route";

function postJson(body: unknown): Request {
  return new Request("http://localhost/api/v1/quotes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validRequest = {
  sourceCurrency: "EUR",
  targetCurrency: "HUF",
  sourceAmount: "1000",
  providers: ["MOCK_PROVIDER", "UNAVAILABLE_PROVIDER"],
  customerPlan: null,
};

describe("POST /api/v1/quotes", () => {
  it("is pinned to the Node runtime required by provider transports", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns a validated partial-success response", async () => {
    const response = await POST(postJson(validRequest));
    const payload: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(quoteApiResponseSchema.safeParse(payload).success).toBe(true);
    expect(payload).toMatchObject({
      bestProviderId: "MOCK_PROVIDER",
      sourceStatus: "PARTIAL_SUCCESS",
      warnings: ["MOCK_DATA"],
    });
  });

  it("accepts HUF/EUR requests", async () => {
    const response = await POST(
      postJson({
        ...validRequest,
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "400000",
        providers: ["MOCK_PROVIDER"],
      }),
    );
    const payload = quoteApiResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.quotes[0]?.targetAmount.amount).toBe("993.01");
  });

  it.each(["0", "-1", "1e3", "1.2.3", "1000000000001"])(
    "rejects invalid source amount %s",
    async (sourceAmount) => {
      const response = await POST(postJson({ ...validRequest, sourceAmount }));
      expect(response.status).toBe(400);
      expect(quoteApiErrorResponseSchema.safeParse(await response.json()).success).toBe(true);
    },
  );

  it("rejects an amount that would round to a zero payout", async () => {
    const response = await POST(postJson({ ...validRequest, sourceAmount: "0.001" }));
    const payload = quoteApiErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload.error.fields?.sourceAmount).toContain("Source amount must be at least 0.01 EUR");
  });

  it("applies the HUF source minimum independently", async () => {
    const response = await POST(
      postJson({
        ...validRequest,
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "99",
      }),
    );
    const payload = quoteApiErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload.error.fields?.sourceAmount).toContain("Source amount must be at least 100 HUF");
  });

  it("accepts the exact HUF source minimum with a positive payout", async () => {
    const response = await POST(
      postJson({
        ...validRequest,
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        sourceAmount: "100",
        providers: ["MOCK_PROVIDER"],
      }),
    );
    const payload = quoteApiResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.quotes[0]?.targetAmount.amount).toBe("0.25");
  });

  it("rejects an over-length decimal amount", async () => {
    const sourceAmount = `0.${"0".repeat(28)}1`;
    const response = await POST(postJson({ ...validRequest, sourceAmount }));
    const payload = quoteApiErrorResponseSchema.parse(await response.json());

    expect(sourceAmount).toHaveLength(31);
    expect(response.status).toBe(400);
    expect(payload.error.fields?.sourceAmount).toContain(
      "Source amount must not exceed 30 characters",
    );
  });

  it("rejects identical currencies", async () => {
    const response = await POST(
      postJson({ ...validRequest, sourceCurrency: "EUR", targetCurrency: "EUR" }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an unknown provider", async () => {
    const response = await POST(postJson({ ...validRequest, providers: ["UNKNOWN_PROVIDER"] }));
    expect(response.status).toBe(400);
  });

  it("rejects an unsupported currency", async () => {
    const response = await POST(postJson({ ...validRequest, sourceCurrency: "USD" }));
    expect(response.status).toBe(400);
  });

  it("rejects duplicate providers", async () => {
    const response = await POST(
      postJson({ ...validRequest, providers: ["MOCK_PROVIDER", "MOCK_PROVIDER"] }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an empty customer plan", async () => {
    const response = await POST(postJson({ ...validRequest, customerPlan: "   " }));
    expect(response.status).toBe(400);
  });

  it("rejects unsupported plans and obsolete Revolut usage context", async () => {
    const obsoleteUsage = await POST(
      postJson({
        ...validRequest,
        providers: ["REVOLUT"],
        providerContexts: {
          REVOLUT: { plan: "STANDARD", rollingThirtyDayExchangeUsedHuf: "0" },
        },
      }),
    );
    const unsupportedPlan = await POST(
      postJson({
        ...validRequest,
        providers: ["REVOLUT"],
        providerContexts: { REVOLUT: { plan: "BUSINESS" } },
      }),
    );

    const malformedPayload = quoteApiErrorResponseSchema.parse(await obsoleteUsage.json());

    expect(obsoleteUsage.status).toBe(400);
    expect(malformedPayload.error.fields?.providerContexts).not.toEqual([]);
    expect(unsupportedPlan.status).toBe(400);
  });

  it("returns unavailable rather than numeric values when Revolut context is omitted", async () => {
    const response = await POST(
      postJson({ ...validRequest, providers: ["REVOLUT"], providerContexts: undefined }),
    );
    const payload = quoteApiResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.quotes).toEqual([]);
    expect(payload.issues[0]).toMatchObject({ kind: "unavailable", provider: { id: "REVOLUT" } });
  });

  it("rejects unexpected request fields", async () => {
    const response = await POST(postJson({ ...validRequest, secretOverride: true }));
    expect(response.status).toBe(400);
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(
      new Request("http://localhost/api/v1/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      }),
    );
    const payload = quoteApiErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_JSON");
  });

  it("returns a sanitized 500 response when the quote service fails", async () => {
    const privateMessage = "private service failure";
    const postWithFailure = createQuotePostHandler(async () => {
      throw new Error(privateMessage);
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await postWithFailure(postJson(validRequest));
    const payload = quoteApiErrorResponseSchema.parse(await response.json());

    expect(response.status).toBe(500);
    expect(payload.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(payload)).not.toContain(privateMessage);
    consoleError.mockRestore();
  });
});
