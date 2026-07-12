import { z } from "zod";

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const databaseEnvSchema = runtimeEnvSchema.extend({
  DATABASE_URL: z.url().startsWith("postgres"),
});

type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
let cachedRuntimeEnv: RuntimeEnv | undefined;

export function getRuntimeEnv(): RuntimeEnv {
  cachedRuntimeEnv ??= runtimeEnvSchema.parse(process.env);
  return cachedRuntimeEnv;
}

export function getDatabaseEnv() {
  return databaseEnvSchema.parse(process.env);
}
