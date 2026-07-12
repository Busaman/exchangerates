import { z } from "zod";

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const databaseEnvSchema = runtimeEnvSchema.extend({
  DATABASE_URL: z.string().url().startsWith("postgres"),
});

export function getRuntimeEnv() {
  return runtimeEnvSchema.parse(process.env);
}

export function getDatabaseEnv() {
  return databaseEnvSchema.parse(process.env);
}
