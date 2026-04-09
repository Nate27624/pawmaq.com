import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  MODERATION_MODEL_RUNTIME: z.enum(["ollama", "vllm", "tgi"]).default("ollama"),
  DATABASE_URL: z.string().default("postgresql://pawmaq:pawmaq@postgres:5432/pawmaq"),
  REDIS_URL: z.string().default("redis://redis:6379"),
  OLLAMA_BASE_URL: z.string().url().default("http://ollama:11434")
});

export type AppEnv = z.infer<typeof envSchema>;

export function readEnv(): AppEnv {
  return envSchema.parse(process.env);
}
