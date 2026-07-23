import { createQuotePostHandler } from "@/app/api/v1/quotes/handler";
import { getQuotes } from "@/services/quote-service";

// ZEN uses node:https; this quote route is intentionally unsupported on the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createQuotePostHandler(getQuotes);
