import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComparisonTool, PlanCards } from "@/components/comparison-tool";
import { planQuoteSchema } from "@/domain/plan-quote";

const common = {
  provider: "ZEN",
  isDefaultPlan: false,
  isPaidPlan: true,
  monthlyFee: { currency: "EUR", amount: "0.9" },
  baseMarkup: "0.002",
  excessMarkup: "0",
  offMarketMarkup: "0",
  totalMarkup: "0.002",
  pricingWindow: "WEEKDAY" as const,
  calculationNote: "Tesztelt csomagszámítás. A havi díj nincs beszámítva.",
  source: {
    sourceType: "OFFICIAL_POLICY" as const,
    sourceId: "test-policy",
    sourceUrl: "https://example.com/source",
  },
  fetchedAt: "2026-07-17T10:00:00.000Z",
};

describe("provider plan UI", () => {
  it("defaults to the accessible free-plan segmented view", () => {
    const html = renderToStaticMarkup(<ComparisonTool />);
    expect(html).toContain("Csomagok megjelenítése");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Ingyenes csomagok/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Minden csomag/);
    expect(html).toContain("a fizetős csomagok nem kapnak külön globális rangot");
  });

  it("renders numeric derived plans and numeric-field-free unavailable plans truthfully", () => {
    const derived = planQuoteSchema.parse({
      ...common,
      plan: "Gold",
      quoteKind: "derived",
      liveBaseRate: "0.002749",
      effectiveRate: "0.0027435",
      inverseRate: "364.497",
      totalSourceCost: { currency: "HUF", amount: "100000" },
      recipientGets: { currency: "EUR", amount: "274.35" },
      rankingEligibility: "PLAN_DETAIL_ONLY",
    });
    const unavailable = planQuoteSchema.parse({
      ...common,
      provider: "REVOLUT",
      plan: "Plus",
      monthlyFee: { currency: "HUF", amount: "1600" },
      quoteKind: "unavailable",
      rankingEligibility: "EXCLUDED",
      rankingExclusionReason: "A hétvégi csomagár nem számítható biztonságosan.",
    });
    const html = renderToStaticMarkup(<PlanCards plans={[derived, unavailable]} />);
    expect(html).toContain("Gold");
    expect(html).toContain("274,35");
    expect(html).toContain("Plus");
    expect(html).toContain("UNAVAILABLE");
    expect(html).toContain("Élő csomagárfolyam nem számítható biztonságosan");
    expect(html).toContain("A havi díj nincs beleszámítva");
    expect(html).toContain("Nincs külön pénzbeli díj (árfolyamba épített felár)");
  });
});
