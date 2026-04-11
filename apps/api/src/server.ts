import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify from "fastify";
import type { AppEnv } from "./config/env.js";
import { registerAuthRoutes } from "./modules/auth/routes.js";
import { AuthSessionService } from "./modules/auth/service.js";
import { registerHealthRoutes } from "./modules/health/routes.js";
import { PreLedgerQueueService } from "./modules/intake/pre-ledger-queue.js";
import { registerLedgerRoutes } from "./modules/ledger/routes.js";
import { registerMediaRoutes } from "./modules/media/routes.js";
import { registerModerationRoutes } from "./modules/moderation/routes.js";
import { registerProfileRoutes } from "./modules/profiles/routes.js";
import { registerTestLabRoutes } from "./modules/test-lab/routes.js";
import { ProfileLedgerService } from "./modules/profiles/service.js";

function parseAllowedOrigins(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  );
}

function isLocalDevOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  } catch {
    return false;
  }
}

export async function buildApp(env: AppEnv) {
  if (env.NODE_ENV === "production" && env.GOOGLE_OAUTH_CLIENT_IDS.trim().length === 0) {
    throw new Error("GOOGLE_OAUTH_CLIENT_IDS is required in production.");
  }
  if (env.NODE_ENV === "production" && env.AUTH_SESSION_STORE !== "redis") {
    throw new Error("AUTH_SESSION_STORE must be 'redis' in production.");
  }
  if (env.NODE_ENV === "production" && !env.REDIS_URL.trim()) {
    throw new Error("REDIS_URL is required in production.");
  }

  const app = Fastify({
    logger: true,
    trustProxy: false
  });

  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      if (env.NODE_ENV !== "production" && isLocalDevOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://accounts.google.com"],
        connectSrc: ["'self'", "https://accounts.google.com", "https://openidconnect.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        mediaSrc: ["'self'", "blob:", "https:"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
        frameSrc: [
          "'self'",
          "https://www.youtube.com",
          "https://youtube.com",
          "https://player.vimeo.com",
          "https://www.instagram.com",
          "https://www.tiktok.com",
          "https://x.com",
          "https://twitter.com"
        ],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"]
      }
    },
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }
  });

  const profileLedgerService = new ProfileLedgerService(env.PROFILE_LEDGER_PATH);
  const authSessions = await AuthSessionService.create({
    sessionTtlMs: env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000,
    googleOauthClientIdsRaw: env.GOOGLE_OAUTH_CLIENT_IDS,
    redisUrl: env.REDIS_URL,
    storeMode: env.AUTH_SESSION_STORE,
    redisKeyPrefix: env.AUTH_SESSION_REDIS_PREFIX,
    warn: (message) => app.log.warn(message)
  });
  app.addHook("onClose", async () => {
    await authSessions.close();
  });
  const preLedgerQueue = new PreLedgerQueueService({
    maxPending: env.PRE_LEDGER_QUEUE_MAX_PENDING,
    limits: {
      ledger_post: {
        maxPerWindow: env.PRE_LEDGER_POSTS_PER_MINUTE_PER_IP,
        windowMs: 60_000
      },
      media_upload: {
        maxPerWindow: env.PRE_LEDGER_MEDIA_UPLOADS_PER_10M_PER_IP,
        windowMs: 10 * 60_000
      }
    }
  });

  await registerHealthRoutes(app);
  await registerModerationRoutes(app, env.MODERATION_MODEL_RUNTIME, authSessions);
  await registerAuthRoutes(app, profileLedgerService, authSessions, env.NODE_ENV);
  await registerMediaRoutes(
    app,
    env.MEDIA_INDEX_PATH,
    env.MEDIA_STORAGE_DIR,
    preLedgerQueue,
    authSessions,
    profileLedgerService,
    env.MEDIA_PUBLIC_BASE_URL
  );
  await registerProfileRoutes(app, profileLedgerService, authSessions);
  await registerLedgerRoutes(app, profileLedgerService, env.POST_LEDGER_PATH, preLedgerQueue, authSessions);
  if (env.TEST_LAB_ENABLED && env.NODE_ENV !== "production") {
    await registerTestLabRoutes(app, env.POST_LEDGER_PATH);
  }

  return app;
}
