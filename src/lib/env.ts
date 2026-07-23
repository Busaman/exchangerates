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
  ZEN_ADAPTER_ENABLED: boolean;
  WISE_ADAPTER_ENABLED: boolean;
};
let cachedRuntimeEnv: RuntimeEnv | undefined;

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

export function resolveZenAdapterEnabled(
  value: string | undefined,
  warn: (message: string) => void = console.warn,
): boolean {
  if (value === "true") return true;
  if (value === undefined || value === "" || value === "false") return false;

  warn(
    JSON.stringify({
      level: "warn",
      message: "Ignoring unrecognized ZEN_ADAPTER_ENABLED value; ZEN remains disabled.",
      feature: "ZEN_ADAPTER_ENABLED",
    }),
  );
  return false;
}

export function resolveWiseAdapterEnabled(
  value: string | undefined,
  warn: (message: string) => void = console.warn,
): boolean {
  if (value === "true") return true;
  if (value === undefined || value === "" || value === "false") return false;

  warn(
    JSON.stringify({
      level: "warn",
      message: "Ignoring unrecognized WISE_ADAPTER_ENABLED value; Wise remains disabled.",
      feature: "WISE_ADAPTER_ENABLED",
    }),
  );
  return false;
}

export function getRuntimeEnv(): RuntimeEnv {
  cachedRuntimeEnv ??= {
    ...runtimeEnvSchema.parse(process.env),
    REVOLUT_ADAPTER_ENABLED: resolveRevolutAdapterEnabled(process.env.REVOLUT_ADAPTER_ENABLED),
    ZEN_ADAPTER_ENABLED: resolveZenAdapterEnabled(process.env.ZEN_ADAPTER_ENABLED),
    WISE_ADAPTER_ENABLED: resolveWiseAdapterEnabled(process.env.WISE_ADAPTER_ENABLED),
  };
  return cachedRuntimeEnv;
}

export function getDatabaseEnv() {
  return databaseEnvSchema.parse(process.env);
}
