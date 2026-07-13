import { describe, expect, it } from "vitest";
import { quoteApiErrorResponseSchema, quoteApiResponseSchema } from "@/domain/quote-api";
import { POST } from "@/app/api/v1/quotes/route";

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
});
