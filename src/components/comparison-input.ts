import { z } from "zod";

const normalizedDemoAmountSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,2})?$/)
  .refine((value) => Number(value) >= 0.01)
  .refine((value) => Number(value) <= 1_000_000_000_000);

/** Normalizes the demo UI input into a fixed-point amount or returns null for invalid input. */
export function normalizeDemoAmount(input: string): string | null {
  const normalized = input.trim().replace(",", ".");
  const result = normalizedDemoAmountSchema.safeParse(normalized);
  if (!result.success) return null;
  return Number(result.data).toFixed(2);
}
