import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteApiResponseSchema } from "@/domain/quote-api";
import {
  defaultRevolutFreshCacheMs,
  resolveRevolutAdapterEnabled,
  resolveRevolutFreshCacheMs,
} from "@/lib/env";
import { createProviderRegistry } from "@/providers/provider-registry";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Revolut fresh-cache configuration", () => {
  it.each([
    [undefined, defaultRevolutFreshCacheMs, 0],
    ["", defaultRevolutFreshCacheMs, 0],
    ["60000", 60_000, 0],
    ["30000", 30_000, 0],
    ["15000", 15_000, 0],
    ["14999", defaultRevolutFreshCacheMs, 1],
    ["0", defaultRevolutFreshCacheMs, 1],
    ["-1", defaultRevolutFreshCacheMs, 1],
    ["yes", defaultRevolutFreshCacheMs, 1],
    ["300001", defaultRevolutFreshCacheMs, 1],
  ] as const)("resolves %s safely", (value, expected, warnings) => {
    const warn = vi.fn();

    expect(resolveRevolutFreshCacheMs(value, warn)).toBe(expected);
    expect(warn).toHaveBeenCalledTimes(warnings);
  });
});

describe("Revolut experimental feature gate", () => {
  it.each([
    ["true", true],
    ["false", false],
    [undefined, false],
    ["", false],
    ["yes", false],
    ["1", false],
    ["TRUE", false],
  ] as const)("resolves %s without throwing", (value, expected) => {
    const warn = vi.fn();

    expect(resolveRevolutAdapterEnabled(value, warn)).toBe(expected);
    expect(createProviderRegistry({ revolutEnabled: expected }).get("REVOLUT").status).toBe(
      expected ? "SUPPORTED" : "UNAVAILABLE",
    );
    expect(warn).toHaveBeenCalledTimes(
      value === "yes" || value === "1" || value === "TRUE" ? 1 : 0,
    );
  });

  it("keeps the quotes route operational and makes no Revolut request for a malformed value", async () => {
    vi.stubEnv("REVOLUT_ADAPTER_ENABLED", "yes");
    const fetchSpy = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.resetModules();
    const { POST } = await import("@/app/api/v1/quotes/route");

    const response = await POST(
      new Request("http://localhost/api/v1/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceCurrency: "EUR",
          targetCurrency: "HUF",
          sourceAmount: "1000",
          providers: ["MOCK_PROVIDER", "REVOLUT"],
          providerContexts: { REVOLUT: { plan: "STANDARD" } },
        }),
      }),
    );
    const payload = quoteApiResponseSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(payload.quotes).toHaveLength(1);
    expect(payload.issues[0]).toMatchObject({
      kind: "unavailable",
      provider: { id: "REVOLUT" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
