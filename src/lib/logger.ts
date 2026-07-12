import { getRuntimeEnv } from "@/lib/env";
import { toErrorDetails } from "@/lib/errors";

type LogLevel = "debug" | "info" | "warn" | "error";
type LogContext = Readonly<Record<string, string | number | boolean | null | undefined>>;

const rank: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

function write(level: LogLevel, message: string, context: LogContext = {}, error?: unknown) {
  if (rank[level] < rank[getRuntimeEnv().LOG_LEVEL]) return;

  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
    ...(error === undefined ? {} : { error: toErrorDetails(error) }),
  });

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  debug: (message: string, context?: LogContext) => write("debug", message, context),
  info: (message: string, context?: LogContext) => write("info", message, context),
  warn: (message: string, context?: LogContext) => write("warn", message, context),
  error: (message: string, error: unknown, context?: LogContext) =>
    write("error", message, context, error),
};
