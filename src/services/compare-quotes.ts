import { quoteRequestSchema, type QuoteRequest, type QuoteResult } from "@/domain/quote";
import { compareDecimalStrings } from "@/domain/decimal";
import { logger } from "@/lib/logger";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { createProviderUnavailableResult } from "@/providers/unavailable-result";

export async function compareQuotes(
  request: Omit<QuoteRequest, "providerId">,
  adapters: readonly ProviderAdapter[],
): Promise<QuoteResult[]> {
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      const providerRequest = quoteRequestSchema.parse({
        ...request,
        providerId: adapter.provider.id,
      });

      try {
        return await adapter.getQuote(providerRequest);
      } catch (error) {
        logger.error("Provider adapter failed", error, { providerId: adapter.provider.id });
        return createProviderUnavailableResult({
          provider: adapter.provider,
          request: providerRequest,
          reason: "The provider quote could not be retrieved.",
          sourceId: "adapter-failure",
        });
      }
    }),
  );

  return results.toSorted((left, right) => {
    if (left.kind === "unavailable" && right.kind === "unavailable") return 0;
    if (left.kind === "unavailable") return 1;
    if (right.kind === "unavailable") return -1;
    return compareDecimalStrings(right.targetAmount.amount, left.targetAmount.amount);
  });
}
