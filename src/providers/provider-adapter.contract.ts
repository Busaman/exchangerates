import { describe, expect, it } from "vitest";
import { decimalPattern } from "@/domain/decimal";
import { quoteResultSchema, type QuoteRequest, type QuoteResult } from "@/domain/quote";
import type { ProviderAdapter } from "@/providers/provider-adapter";

export function runProviderAdapterContract({
  adapter,
  request,
  expectedKind,
}: {
  adapter: ProviderAdapter;
  request: QuoteRequest;
  expectedKind: QuoteResult["kind"];
}) {
  describe(`${adapter.provider.id} adapter contract`, () => {
    it("returns the normalized discriminated domain shape", async () => {
      const result = await adapter.getQuote(request, { signal: new AbortController().signal });
      expect(quoteResultSchema.safeParse(result).success).toBe(true);
      expect(result.kind).toBe(expectedKind);
      expect(result.provider.id).toBe(adapter.provider.id);
    });

    it("includes valid timestamps, provenance and decimal strings", async () => {
      const result = await adapter.getQuote(request, { signal: new AbortController().signal });
      expect(Number.isNaN(Date.parse(result.retrievedAt))).toBe(false);

      if (result.kind === "quote") {
        expect(result.sourceType).toBeTruthy();
        expect(result.sourceId).toBeTruthy();
        for (const value of [
          result.sourceAmount.amount,
          result.targetAmount.amount,
          result.effectiveRate,
          result.explicitFee.amount,
          result.totalCost.amount,
          ...(result.providerDetails?.type === "REVOLUT_PERSONAL"
            ? [
                result.providerDetails.displayedBaseRate,
                result.providerDetails.fairUsageFee.amount,
                result.providerDetails.weekendFee.amount,
                result.providerDetails.totalFee.amount,
                result.providerDetails.allowanceUsedBeforeQuoteHuf,
                result.providerDetails.allowanceConsumedByQuoteHuf,
              ]
            : []),
        ]) {
          expect(value).toMatch(decimalPattern);
        }
      } else if (result.kind === "unavailable") {
        expect(result.sourceId).toBeTruthy();
      }
    });

    it("never returns placeholder numeric fields for a non-quote result", async () => {
      const result = await adapter.getQuote(request, { signal: new AbortController().signal });
      if (result.kind !== "quote") {
        expect(result).not.toHaveProperty("sourceAmount");
        expect(result).not.toHaveProperty("targetAmount");
        expect(result).not.toHaveProperty("effectiveRate");
        expect(result).not.toHaveProperty("explicitFee");
        expect(result).not.toHaveProperty("totalCost");
      }
    });
  });
}
