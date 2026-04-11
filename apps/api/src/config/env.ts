import { z } from "zod";

const DEFAULT_RSS_BOT_FEEDS = JSON.stringify([
  {
    feedUrl: "https://mastodon.social/@TechCrunch.rss",
    handle: "@techcrunch_rss",
    name: "TechCrunch RSS",
    countryCode: "US",
    countryName: "United States"
  },
  {
    feedUrl: "https://mastodon.social/tags/news.rss",
    handle: "@mastodon_news_rss",
    name: "Mastodon #news",
    countryCode: "WW",
    countryName: "Worldwide"
  }
]);

function parseBoolean(value: unknown): boolean | unknown {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  MODERATION_MODEL_RUNTIME: z.enum(["ollama", "vllm", "tgi"]).default("ollama"),
  PROFILE_LEDGER_PATH: z.string().default(".context/profile-ledger.json"),
  POST_LEDGER_PATH: z.string().default(".context/post-popularity-ledger.json"),
  MEDIA_INDEX_PATH: z.string().default(".context/media-index.json"),
  MEDIA_STORAGE_DIR: z.string().default(".context/media-uploads"),
  MEDIA_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000"),
  PRE_LEDGER_QUEUE_MAX_PENDING: z.coerce.number().int().positive().default(80),
  PRE_LEDGER_POSTS_PER_MINUTE_PER_IP: z.coerce.number().int().positive().default(90),
  PRE_LEDGER_MEDIA_UPLOADS_PER_10M_PER_IP: z.coerce.number().int().positive().default(20),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  AUTH_SESSION_STORE: z.enum(["auto", "memory", "redis"]).default("memory"),
  AUTH_SESSION_REDIS_PREFIX: z.string().default("pawmaq:session:"),
  GOOGLE_OAUTH_CLIENT_IDS: z.string().default(""),
  RSS_BOTS_ENABLED: z.preprocess(parseBoolean, z.boolean()).default(true),
  RSS_BOTS_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  RSS_BOTS_MAX_ITEMS_PER_FEED_PER_RUN: z.coerce.number().int().nonnegative().default(0),
  RSS_BOTS_USER_AGENT: z.string().default("pawmaq-rss-bot/1.0 (+https://pawmaq.com)"),
  RSS_BOTS_FEEDS: z.string().default(DEFAULT_RSS_BOT_FEEDS),
  TEST_LAB_ENABLED: z.preprocess(parseBoolean, z.boolean()).default(false),
  DATABASE_URL: z.string().default("postgresql://pawmaq:pawmaq@postgres:5432/pawmaq"),
  REDIS_URL: z.string().default(""),
  OLLAMA_BASE_URL: z.string().url().default("http://ollama:11434")
});

export type AppEnv = z.infer<typeof envSchema>;

export function readEnv(): AppEnv {
  return envSchema.parse(process.env);
}
