import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FintechShell } from "@/components/fintech-shell";
import { ComingSoonSection } from "@/components/coming-soon-section";
import { activeComparisonProviderIds } from "@/components/comparison-request";
import { providerIdentifierSchema } from "@/domain/quote";

describe("Fintech v2 shell", () => {
  it("exposes accessible language, theme and plan controls", () => {
    const html = renderToStaticMarkup(<FintechShell />);
    expect(html).toContain('role="group" aria-label="Language"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>HU/);
    expect(html).toContain('aria-label="Sötét téma"');
    expect(html).toContain('aria-label="Csomagok megjelenítése"');
    expect(html).toContain("Ne hagyd a pénzed");
  });

  it("keeps exactly Revolut, ZEN and Wise in the operational comparison request", () => {
    expect(activeComparisonProviderIds).toEqual(["REVOLUT", "ZEN", "WISE"]);
  });

  it("renders coming-soon providers without numeric quotes or ranking controls", () => {
    const html = renderToStaticMarkup(<ComingSoonSection language="hu" />);
    for (const provider of ["N26", "Lightyear", "PayPal", "OTP Bank", "Erste", "Raiffeisen"]) {
      expect(html).toContain(provider);
    }
    expect(html).toContain("Még nincs élő adatforrás");
    expect(html).not.toContain("Kapott összeg");
    expect(providerIdentifierSchema.safeParse("N26").success).toBe(false);
    expect(providerIdentifierSchema.safeParse("PAYPAL").success).toBe(false);
  });
});
