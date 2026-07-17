import { describe, expect, it } from "vitest";
import { decimal } from "@/domain/decimal";
import { calculateZenPlanQuotes, isZenOffMarketWindow } from "@/providers/zen/zen-plan-policy";

function quotes(fetchedAt: string, sourceCurrency: "HUF" | "EUR" = "HUF") {
  return calculateZenPlanQuotes({
    liveProRate: sourceCurrency === "HUF" ? "0.002749" : "360.25",
    sourceAmount: sourceCurrency === "HUF" ? "100000" : "1000",
    endpointTargetAmount: sourceCurrency === "HUF" ? "274.9" : "360250",
    sourceCurrency,
    targetCurrency: sourceCurrency === "HUF" ? "EUR" : "HUF",
    fetchedAt,
  });
}

describe("ZEN plan policy", () => {
  it("derives weekday Free/Gold/Platinum and preserves Pro exactly", () => {
    const result = quotes("2026-07-15T12:00:00.000Z");
    expect(
      result.map(({ plan, quoteKind, totalMarkup }) => ({ plan, quoteKind, totalMarkup })),
    ).toEqual([
      { plan: "Free", quoteKind: "derived", totalMarkup: "0.005" },
      { plan: "Gold", quoteKind: "derived", totalMarkup: "0.002" },
      { plan: "Platinum", quoteKind: "derived", totalMarkup: "0" },
      { plan: "Pro", quoteKind: "live", totalMarkup: "0" },
    ]);
    expect(result[0]?.isDefaultPlan).toBe(true);
    expect(result[3]).toMatchObject({ liveBaseRate: "0.002749", effectiveRate: "0.002749" });
    const amounts = result.map((quote) =>
      quote.quoteKind === "unavailable" ? decimal(0) : decimal(quote.recipientGets.amount),
    );
    expect(amounts[0]?.lessThan(amounts[1] ?? 0)).toBe(true);
    expect(amounts[1]?.lessThan(amounts[2] ?? 0)).toBe(true);
    expect(amounts[2]?.equals(amounts[3] ?? 0)).toBe(true);
  });

  it.each(["HUF", "EUR"] as const)("keeps weekend monotonicity for %s source", (source) => {
    const result = quotes("2026-07-17T20:00:00.000Z", source);
    const rates = result.map((quote) =>
      quote.quoteKind === "unavailable" ? decimal(0) : decimal(quote.effectiveRate),
    );
    expect(rates[0]?.lessThan(rates[1] ?? 0)).toBe(true);
    expect(rates[1]?.lessThan(rates[2] ?? 0)).toBe(true);
    expect(rates[2]?.lessThan(rates[3] ?? 0)).toBe(true);
    const inverse = result.map((quote) =>
      quote.quoteKind === "unavailable" ? decimal(0) : decimal(quote.inverseRate),
    );
    expect(inverse[0]?.greaterThan(inverse[1] ?? 0)).toBe(true);
    expect(inverse[1]?.greaterThan(inverse[2] ?? 0)).toBe(true);
    expect(inverse[2]?.greaterThan(inverse[3] ?? 0)).toBe(true);
    expect(result.map((quote) => quote.totalMarkup)).toEqual(["0.009", "0.006", "0.004", "0"]);
  });

  it.each(["HUF", "EUR"] as const)(
    "keeps weekday target/inverse monotonicity for %s source",
    (source) => {
      const result = quotes("2026-07-15T12:00:00.000Z", source);
      const rates = result.map((quote) =>
        quote.quoteKind === "unavailable" ? decimal(0) : decimal(quote.effectiveRate),
      );
      const inverse = result.map((quote) =>
        quote.quoteKind === "unavailable" ? decimal(0) : decimal(quote.inverseRate),
      );
      expect(rates[0]?.lessThan(rates[1] ?? 0)).toBe(true);
      expect(rates[1]?.lessThan(rates[2] ?? 0)).toBe(true);
      expect(rates[2]?.equals(rates[3] ?? 0)).toBe(true);
      expect(inverse[0]?.greaterThan(inverse[1] ?? 0)).toBe(true);
      expect(inverse[1]?.greaterThan(inverse[2] ?? 0)).toBe(true);
      expect(inverse[2]?.equals(inverse[3] ?? 0)).toBe(true);
    },
  );

  it("uses DST-aware Europe/Warsaw Friday/Sunday boundaries", () => {
    expect(isZenOffMarketWindow(new Date("2026-07-17T18:59:59.999Z"))).toBe(false);
    expect(isZenOffMarketWindow(new Date("2026-07-17T19:00:00.000Z"))).toBe(true);
    expect(isZenOffMarketWindow(new Date("2026-07-19T19:59:59.999Z"))).toBe(true);
    expect(isZenOffMarketWindow(new Date("2026-07-19T20:00:00.000Z"))).toBe(false);
    expect(isZenOffMarketWindow(new Date("2026-12-04T20:00:00.000Z"))).toBe(true);
  });

  it("uses exchangeRate, not the rounded endpoint target, for derived plans", () => {
    const first = quotes("2026-07-15T12:00:00.000Z");
    const changed = calculateZenPlanQuotes({
      liveProRate: "0.002749",
      sourceAmount: "100000",
      endpointTargetAmount: "274.01",
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      fetchedAt: "2026-07-15T12:00:00.000Z",
    });
    expect(changed[0]).toMatchObject({
      effectiveRate: first[0]?.quoteKind === "derived" ? first[0].effectiveRate : "",
    });
    expect(changed[2]).toMatchObject({
      plan: "Platinum",
      quoteKind: "derived",
      recipientGets: { amount: "274.9", currency: "EUR" },
    });
    expect(changed[3]).toMatchObject({
      plan: "Pro",
      quoteKind: "live",
      recipientGets: { amount: "274.01", currency: "EUR" },
    });
    for (const plan of changed) {
      expect(plan).not.toHaveProperty("feeAmount");
      expect(plan).not.toHaveProperty("feeCurrency");
    }
    expect(() =>
      calculateZenPlanQuotes({
        liveProRate: "0",
        sourceAmount: "100000",
        endpointTargetAmount: "0",
        sourceCurrency: "HUF",
        targetCurrency: "EUR",
        fetchedAt: "2026-07-15T12:00:00.000Z",
      }),
    ).toThrow();
    expect(() => quotes("invalid")).toThrow();
  });

  it("uses request-time pricing window even when a cached observation predates the boundary", () => {
    const result = calculateZenPlanQuotes({
      liveProRate: "0.002749",
      sourceAmount: "100000",
      endpointTargetAmount: "274.9",
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      fetchedAt: "2026-07-17T18:59:30.000Z",
      pricingAt: "2026-07-17T19:00:01.000Z",
    });

    expect(result.map(({ pricingWindow }) => pricingWindow)).toEqual([
      "OFF_MARKET",
      "OFF_MARKET",
      "OFF_MARKET",
      "OFF_MARKET",
    ]);
    expect(result.map(({ totalMarkup }) => totalMarkup)).toEqual(["0.009", "0.006", "0.004", "0"]);
  });

  it("excludes a stale default plan from ranking while retaining transparent plan details", () => {
    const result = calculateZenPlanQuotes({
      liveProRate: "0.002749",
      sourceAmount: "100000",
      endpointTargetAmount: "274.9",
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      fetchedAt: "2026-07-17T10:00:00.000Z",
      pricingAt: "2026-07-17T10:10:00.000Z",
      freshness: "STALE",
    });

    expect(result[0]).toMatchObject({
      plan: "Free",
      rankingEligibility: "EXCLUDED",
      rankingExclusionReason: "A stale ZEN alapmegfigyelés nem vehet részt a rangsorban.",
    });
    expect(result.slice(1).map(({ rankingEligibility }) => rankingEligibility)).toEqual([
      "PLAN_DETAIL_ONLY",
      "PLAN_DETAIL_ONLY",
      "PLAN_DETAIL_ONLY",
    ]);
  });
});
