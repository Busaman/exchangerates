import { z } from "zod";

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const databaseEnvSchema = runtimeEnvSchema.extend({
  DATABASE_URL: z.url().startsWith("postgres"),
});

type RuntimeEnv = z.infer<typeof runtimeEnvSchema> & {
  REVOLUT_ADAPTER_ENABLED: boolean;
  REVOLUT_FRESH_CACHE_MS: number;
};
let cachedRuntimeEnv: RuntimeEnv | undefined;

export const defaultRevolutFreshCacheMs = 60_000;
export const minimumRevolutFreshCacheMs = 15_000;
export const maximumRevolutFreshCacheMs = 300_000;

export function resolveRevolutAdapterEnabled(
  value: string | undefined,
  warn: (message: string) => void = console.warn,
): boolean {
  if (value === "true") return true;
  if (value === undefined || value === "" || value === "false") return false;

  warn(
    JSON.stringify({
      level: "warn",
      message: "Ignoring unrecognized REVOLUT_ADAPTER_ENABLED value; Revolut remains disabled.",
      feature: "REVOLUT_ADAPTER_ENABLED",
    }),
  );
  return false;
}

export function resolveRevolutFreshCacheMs(
  value: string | undefined,
  warn: (message: string) => void = console.warn,
): number {
  if (value === undefined || value === "") return defaultRevolutFreshCacheMs;

  const parsed = z.coerce.number().int().safeParse(value);
  if (
    parsed.success &&
    parsed.data >= minimumRevolutFreshCacheMs &&
    parsed.data <= maximumRevolutFreshCacheMs
  ) {
    return parsed.data;
  }

  warn(
    JSON.stringify({
      level: "warn",
      message: "Ignoring invalid REVOLUT_FRESH_CACHE_MS; using the safe default.",
      feature: "REVOLUT_FRESH_CACHE_MS",
      defaultMs: defaultRevolutFreshCacheMs,
      minimumMs: minimumRevolutFreshCacheMs,
      maximumMs: maximumRevolutFreshCacheMs,
    }),
  );
  return defaultRevolutFreshCacheMs;
}

export function getRuntimeEnv(): RuntimeEnv {
  cachedRuntimeEnv ??= {
    ...runtimeEnvSchema.parse(process.env),
    REVOLUT_ADAPTER_ENABLED: resolveRevolutAdapterEnabled(process.env.REVOLUT_ADAPTER_ENABLED),
    REVOLUT_FRESH_CACHE_MS: resolveRevolutFreshCacheMs(process.env.REVOLUT_FRESH_CACHE_MS),
  };
  return cachedRuntimeEnv;
}

export function getDatabaseEnv() {
  return databaseEnvSchema.parse(process.env);
}
