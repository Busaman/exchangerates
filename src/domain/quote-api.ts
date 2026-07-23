import { z } from "zod";
import {
  isAllowedSourceAmount,
  maximumSourceAmount,
  maximumSourceAmountLength,
  meetsMinimumSourceAmount,
  minimumSourceAmount,
} from "@/domain/decimal";
import {
  availableQuoteSchema,
  providerErrorResultSchema,
  providerIdentifierSchema,
  providerContextsSchema,
  supportedCurrencyCodeSchema,
  unavailableQuoteSchema,
  positiveDecimalStringSchema,
} from "@/domain/quote";

export const quoteApiRequestSchema = z
  .object({
    sourceCurrency: supportedCurrencyCodeSchema,
    targetCurrency: supportedCurrencyCodeSchema,
    sourceAmount: z
      .string()
      .max(
        maximumSourceAmountLength,
        `Source amount must not exceed ${maximumSourceAmountLength} characters`,
      )
      .pipe(positiveDecimalStringSchema)
      .refine(isAllowedSourceAmount, `Source amount must not exceed ${maximumSourceAmount}`),
    providers: z.array(providerIdentifierSchema).min(1).max(20).optional(),
    customerPlan: z.string().trim().min(1).max(100).nullable().optional(),
    providerContexts: providerContextsSchema.optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sourceCurrency === request.targetCurrency) {
      context.addIssue({
        code: "custom",
        message: "Source and target currency must differ",
        path: ["targetCurrency"],
      });
    }

    if (!meetsMinimumSourceAmount(request.sourceAmount, request.sourceCurrency)) {
      context.addIssue({
        code: "custom",
        message: `Source amount must be at least ${minimumSourceAmount[request.sourceCurrency]} ${request.sourceCurrency}`,
        path: ["sourceAmount"],
      });
    }

    if (
      request.providers !== undefined &&
      new Set(request.providers).size !== request.providers.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Provider identifiers must be unique",
        path: ["providers"],
      });
    }
  });

export const quoteSourceStatusSchema = z.enum([
  "SUCCESS",
  "PARTIAL_SUCCESS",
  "NO_AVAILABLE_QUOTES",
  "NO_RANKABLE_QUOTES",
]);
export const quoteWarningSchema = z.enum([
  "MOCK_DATA",
  "REVOLUT_INDICATIVE",
  "REVOLUT_FEE_INCOMPLETE",
  "ZEN_INDICATIVE",
]);

export const quoteApiResponseSchema = z
  .object({
    request: z.object({
      id: z.uuid(),
      sourceCurrency: supportedCurrencyCodeSchema,
      targetCurrency: supportedCurrencyCodeSchema,
      sourceAmount: positiveDecimalStringSchema,
      providers: z.array(providerIdentifierSchema),
      customerPlan: z.string().nullable(),
      providerContexts: providerContextsSchema.optional(),
    }),
    quotes: z.array(availableQuoteSchema),
    issues: z.array(
      z.discriminatedUnion("kind", [unavailableQuoteSchema, providerErrorResultSchema]),
    ),
    bestProviderId: providerIdentifierSchema.nullable(),
    generatedAt: z.iso.datetime(),
    sourceStatus: quoteSourceStatusSchema,
    warnings: z.array(quoteWarningSchema),
  })
  .strict();

export const quoteApiErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum(["INVALID_JSON", "VALIDATION_ERROR", "INTERNAL_ERROR"]),
      message: z.string(),
      fields: z.record(z.string(), z.array(z.string())).optional(),
    }),
  })
  .strict();

export type QuoteApiRequest = z.infer<typeof quoteApiRequestSchema>;
export type QuoteApiResponse = z.infer<typeof quoteApiResponseSchema>;
export type QuoteApiErrorResponse = z.infer<typeof quoteApiErrorResponseSchema>;
