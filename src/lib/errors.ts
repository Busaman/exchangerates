export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 500,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function toErrorDetails(error: unknown): { message: string; name: string } {
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: "Unknown error", name: "UnknownError" };
}
