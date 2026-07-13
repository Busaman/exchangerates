import { NextResponse } from "next/server";
import { z } from "zod";
import {
  quoteApiErrorResponseSchema,
  quoteApiRequestSchema,
  type QuoteApiErrorResponse,
} from "@/domain/quote-api";
import { logger } from "@/lib/logger";
import { getQuotes } from "@/services/quote-service";

export const dynamic = "force-dynamic";

function errorResponse(body: QuoteApiErrorResponse, status: 400 | 500) {
  return NextResponse.json(quoteApiErrorResponseSchema.parse(body), {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } },
      400,
    );
  }

  const parsedRequest = quoteApiRequestSchema.safeParse(payload);
  if (!parsedRequest.success) {
    return errorResponse(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          fields: z.flattenError(parsedRequest.error).fieldErrors,
        },
      },
      400,
    );
  }

  try {
    const response = await getQuotes(parsedRequest.data);
    return NextResponse.json(response, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    logger.error("Quote API failed", error);
    return errorResponse(
      { error: { code: "INTERNAL_ERROR", message: "The quote request could not be completed." } },
      500,
    );
  }
}
