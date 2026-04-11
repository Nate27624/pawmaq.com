import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { readAuthenticatedIdentity } from "./guards.js";
import { AUTH_SESSION_COOKIE_NAME, AuthSessionService } from "./service.js";
import type { ProfileLedgerService } from "../profiles/service.js";

const googleSessionSchema = z.object({
  accessToken: z.string().min(20).max(8192),
  clientId: z.string().min(10).max(240).optional()
});

const GOOGLE_SIGN_IN_WINDOW_MS = 60_000;
const GOOGLE_SIGN_IN_MAX_PER_WINDOW = 30;
const GOOGLE_SIGN_IN_TRACKED_KEYS_MAX = 10_000;

interface SignInRateCounter {
  windowStartMs: number;
  count: number;
}

function signInRateKey(raw: string | undefined): string {
  const normalized = (raw ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 120) : "unknown";
}

function pruneSignInRateCounters(counters: Map<string, SignInRateCounter>, nowMs: number): void {
  for (const [key, counter] of counters.entries()) {
    if (nowMs - counter.windowStartMs >= GOOGLE_SIGN_IN_WINDOW_MS) {
      counters.delete(key);
    }
  }
  if (counters.size <= GOOGLE_SIGN_IN_TRACKED_KEYS_MAX) {
    return;
  }
  const overflow = counters.size - GOOGLE_SIGN_IN_TRACKED_KEYS_MAX;
  let removed = 0;
  for (const key of counters.keys()) {
    counters.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

function sessionCookieOptions(isProduction: boolean, maxAgeSeconds: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "strict" as const,
    secure: isProduction,
    maxAge: maxAgeSeconds
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  profileLedger: ProfileLedgerService,
  authSessions: AuthSessionService,
  nodeEnv: string
): Promise<void> {
  const isProduction = nodeEnv === "production";
  const cookieOptions = sessionCookieOptions(isProduction, authSessions.getSessionMaxAgeSeconds());
  const signInRateCounters = new Map<string, SignInRateCounter>();

  app.post("/v1/auth/google/session", async (request, reply) => {
    const rateKey = signInRateKey(request.ip);
    const nowMs = Date.now();
    pruneSignInRateCounters(signInRateCounters, nowMs);
    const counter = signInRateCounters.get(rateKey);
    if (!counter || nowMs - counter.windowStartMs >= GOOGLE_SIGN_IN_WINDOW_MS) {
      signInRateCounters.set(rateKey, { windowStartMs: nowMs, count: 1 });
    } else if (counter.count >= GOOGLE_SIGN_IN_MAX_PER_WINDOW) {
      return reply.code(429).send({
        error: "rate_limited",
        message: "Google sign-in rate limit reached. Please retry shortly.",
        retry_after_ms: Math.max(1, GOOGLE_SIGN_IN_WINDOW_MS - (nowMs - counter.windowStartMs))
      });
    } else {
      counter.count += 1;
    }

    const parsed = googleSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid Google session payload.",
        details: parsed.error.issues
      });
    }

    try {
      const verifiedIdentity = await authSessions.verifyGoogleAccessToken(
        parsed.data.accessToken,
        parsed.data.clientId
      );
      const profile = await profileLedger.syncSession({
        provider: verifiedIdentity.provider,
        subject: verifiedIdentity.subject,
        name: verifiedIdentity.name,
        email: verifiedIdentity.email,
        picture: verifiedIdentity.picture
      });
      const sessionId = await authSessions.createSession({
        provider: verifiedIdentity.provider,
        subject: verifiedIdentity.subject
      });
      reply.setCookie(AUTH_SESSION_COOKIE_NAME, sessionId, cookieOptions);
      return reply.code(200).send({
        ok: true,
        profile
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create Google session.";
      const statusCode = /cap/i.test(message) ? 429 : 401;
      return reply.code(statusCode).send({
        error: "google_session_failed",
        message
      });
    }
  });

  app.get("/v1/auth/session", async (request, reply) => {
    const identity = await readAuthenticatedIdentity(request, authSessions);
    if (!identity) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "No active session."
      });
    }

    const profile = await profileLedger.getByProviderSubject(identity.provider, identity.subject);
    if (!profile) {
      const sessionId = request.cookies[AUTH_SESSION_COOKIE_NAME] ?? "";
      await authSessions.revokeSession(sessionId);
      reply.clearCookie(AUTH_SESSION_COOKIE_NAME, cookieOptions);
      return reply.code(401).send({
        error: "unauthorized",
        message: "Session is no longer valid."
      });
    }

    return reply.code(200).send({
      ok: true,
      profile
    });
  });

  app.post("/v1/auth/sign-out", async (request, reply) => {
    const sessionId = request.cookies[AUTH_SESSION_COOKIE_NAME] ?? "";
    await authSessions.revokeSession(sessionId);
    reply.clearCookie(AUTH_SESSION_COOKIE_NAME, cookieOptions);
    return reply.code(200).send({ ok: true });
  });
}
