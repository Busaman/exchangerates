import { quoteRequestSchema, type QuoteRequest, type QuoteResult } from "@/domain/quote";
import type { ProviderAdapter } from "@/providers/provider-adapter";

export async function compareQuotes(
  request: Omit<QuoteRequest, "providerId">,
  adapters: readonly ProviderAdapter[],
): Promise<QuoteResult[]> {
  const results = await Promise.all(
    adapters.map((adapter) =>
      adapter.getQuote(quoteRequestSchema.parse({ ...request, providerId: adapter.provider.id })),
    ),
  );

  return results.toSorted((left, right) => {
    if (left.kind === "unavailable") return 1;
    if (right.kind === "unavailable") return -1;
    return Number(right.targetAmount.amount) - Number(left.targetAmount.amount);
  });
}
