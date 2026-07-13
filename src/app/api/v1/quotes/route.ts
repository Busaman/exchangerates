import { createQuotePostHandler } from "@/app/api/v1/quotes/handler";
import { getQuotes } from "@/services/quote-service";

export const dynamic = "force-dynamic";
export const POST = createQuotePostHandler(getQuotes);
