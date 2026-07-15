import type { ProviderIdentifier, QuoteResult } from "@/domain/quote";

export function isFullAllowanceAssumedQuote(result: QuoteResult): boolean {
  return (
    result.kind === "quote" &&
    result.providerDetails?.allowanceAssumption === "FULL_ALLOWANCE_ASSUMED"
  );
}

export function bestResultBadgeLabel(
  result: QuoteResult,
  bestProviderId: ProviderIdentifier | null | undefined,
): string | null {
  if (result.provider.id !== bestProviderId || result.kind !== "quote") return null;
  if (isFullAllowanceAssumedQuote(result)) {
    return "Legjobb indikatív best-case eredmény · teljes keret feltételezve";
  }
  return result.sourceType === "MOCK"
    ? "Legjobb elérhető mock eredmény"
    : "Legjobb elérhető indikatív eredmény";
}
