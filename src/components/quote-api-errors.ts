export class QuoteApiRequestError extends Error {
  constructor(
    message: string,
    readonly fields: Readonly<Record<string, readonly string[]>>,
  ) {
    super(message);
    this.name = "QuoteApiRequestError";
  }
}

export function quoteApiFieldMessage(error: unknown, field: string): string | undefined {
  return error instanceof QuoteApiRequestError ? error.fields[field]?.[0] : undefined;
}
