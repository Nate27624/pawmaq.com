import { randomBytes } from "node:crypto";
import { createClient } from "redis";
import type { ProfileProvider } from "../profiles/types.js";

const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";
const GOOGLE_VERIFY_TIMEOUT_MS = 6_000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_REDIS_SESSION_PREFIX = "pawmaq:session:";

export const AUTH_SESSION_COOKIE_NAME = "pawmaq_session";

export type AuthSessionStoreMode = "auto" | "memory" | "redis";

export interface AuthSessionIdentity {
  provider: ProfileProvider;
  subject: string;
}

interface AuthSessionRecord extends AuthSessionIdentity {
  sessionId: string;
  createdAtMs: number;
  expiresAtMs: number;
}

interface GoogleUserInfoResponse {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

interface GoogleTokenInfoResponse {
  aud?: string;
  azp?: string;
  sub?: string;
  expires_in?: string;
}

export interface VerifiedGoogleIdentity extends AuthSessionIdentity {
  name: string;
  email?: string;
  picture?: string;
}

interface AuthSessionServiceOptions {
  sessionTtlMs?: number;
  googleOauthClientIdsRaw?: string;
  redisUrl?: string;
  storeMode?: AuthSessionStoreMode;
  redisKeyPrefix?: string;
  warn?: (message: string) => void;
}

export class AuthSessionService {
  private readonly sessions = new Map<string, AuthSessionRecord>();

  private readonly sessionTtlMs: number;

  private readonly allowedGoogleClientIds: Set<string>;

  private readonly redisUrl: string;

  private readonly storeMode: AuthSessionStoreMode;

  private readonly redisKeyPrefix: string;

  private readonly warn: (message: string) => void;

  private redisClient: ReturnType<typeof createClient> | null = null;

  private constructor(options: AuthSessionServiceOptions) {
    this.sessionTtlMs = options.sessionTtlMs && Number.isFinite(options.sessionTtlMs) && options.sessionTtlMs > 0
      ? Math.floor(options.sessionTtlMs)
      : DEFAULT_SESSION_TTL_MS;
    this.allowedGoogleClientIds = new Set(
      (options.googleOauthClientIdsRaw ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    );
    this.redisUrl = (options.redisUrl ?? "").trim();
    this.storeMode = options.storeMode ?? "auto";
    this.redisKeyPrefix = (options.redisKeyPrefix ?? DEFAULT_REDIS_SESSION_PREFIX).trim() || DEFAULT_REDIS_SESSION_PREFIX;
    this.warn = options.warn ?? (() => undefined);
  }

  static async create(options: AuthSessionServiceOptions = {}): Promise<AuthSessionService> {
    const service = new AuthSessionService(options);
    await service.initializeStore();
    return service;
  }

  getSessionMaxAgeSeconds(): number {
    return Math.max(60, Math.floor(this.sessionTtlMs / 1000));
  }

  async createSession(identity: AuthSessionIdentity): Promise<string> {
    this.purgeExpiredMemorySessions();
    const nowMs = Date.now();
    const sessionId = randomBytes(32).toString("base64url");
    const record: AuthSessionRecord = {
      sessionId,
      provider: identity.provider,
      subject: identity.subject,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + this.sessionTtlMs
    };

    if (this.redisClient) {
      await this.redisClient.set(this.redisSessionKey(sessionId), JSON.stringify(record), {
        EX: this.getSessionMaxAgeSeconds()
      });
      return sessionId;
    }

    this.sessions.set(sessionId, record);
    return sessionId;
  }

  async getIdentityFromSession(sessionId: string): Promise<AuthSessionIdentity | null> {
    if (!sessionId) {
      return null;
    }

    if (this.redisClient) {
      const raw = await this.redisClient.get(this.redisSessionKey(sessionId));
      if (!raw) {
        return null;
      }
      const parsed = this.parseSessionRecord(raw);
      if (!parsed) {
        await this.redisClient.del(this.redisSessionKey(sessionId));
        return null;
      }
      if (parsed.expiresAtMs <= Date.now()) {
        await this.redisClient.del(this.redisSessionKey(sessionId));
        return null;
      }
      return {
        provider: parsed.provider,
        subject: parsed.subject
      };
    }

    const record = this.sessions.get(sessionId);
    if (!record) {
      return null;
    }
    if (record.expiresAtMs <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    return {
      provider: record.provider,
      subject: record.subject
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    if (!sessionId) {
      return;
    }
    if (this.redisClient) {
      await this.redisClient.del(this.redisSessionKey(sessionId));
      return;
    }
    this.sessions.delete(sessionId);
  }

  async close(): Promise<void> {
    if (!this.redisClient) {
      return;
    }
    try {
      if (this.redisClient.isOpen) {
        await this.redisClient.quit();
      }
    } catch {
      // Keep shutdown tolerant if redis is already unavailable.
    } finally {
      this.redisClient = null;
    }
  }

  async verifyGoogleAccessToken(accessToken: string, clientIdHint?: string): Promise<VerifiedGoogleIdentity> {
    const normalizedToken = accessToken.trim();
    if (!normalizedToken) {
      throw new Error("Google access token is required.");
    }

    const normalizedClientIdHint = (clientIdHint ?? "").trim();
    if (normalizedClientIdHint && this.allowedGoogleClientIds.size > 0 && !this.allowedGoogleClientIds.has(normalizedClientIdHint)) {
      throw new Error("Google OAuth client is not allowed.");
    }

    const tokenInfo = await this.fetchGooglePayload<GoogleTokenInfoResponse>(
      `${GOOGLE_TOKENINFO_URL}?${new URLSearchParams({ access_token: normalizedToken }).toString()}`,
      {},
      "Unable to verify Google sign-in."
    );

    const tokenAudience = tokenInfo.aud?.trim() ?? tokenInfo.azp?.trim() ?? "";
    if (this.allowedGoogleClientIds.size > 0 && !this.allowedGoogleClientIds.has(tokenAudience)) {
      throw new Error("Google token audience is not allowed.");
    }
    const tokenSubject = tokenInfo.sub?.trim() ?? "";
    if (!tokenSubject) {
      throw new Error("Google token payload is incomplete.");
    }
    const expiresInSeconds = Number.parseInt(tokenInfo.expires_in ?? "0", 10);
    if (Number.isFinite(expiresInSeconds) && expiresInSeconds <= 0) {
      throw new Error("Google access token expired.");
    }

    const payload = await this.fetchGooglePayload<GoogleUserInfoResponse>(
      GOOGLE_USERINFO_URL,
      {
        headers: {
          Authorization: `Bearer ${normalizedToken}`
        }
      },
      "Unable to verify Google sign-in."
    );

    const subject = payload.sub?.trim();
    const name = payload.name?.trim();
    if (!subject || !name) {
      throw new Error("Google account payload is incomplete.");
    }
    if (subject !== tokenSubject) {
      throw new Error("Google account subject mismatch.");
    }

    return {
      provider: "google",
      subject,
      name,
      email: payload.email?.trim() || undefined,
      picture: payload.picture?.trim() || undefined
    };
  }

  private async initializeStore(): Promise<void> {
    if (this.storeMode === "memory") {
      return;
    }
    if (!this.redisUrl) {
      if (this.storeMode === "redis") {
        throw new Error("AUTH_SESSION_STORE=redis requires REDIS_URL.");
      }
      this.warn("Auth sessions are using in-memory store (REDIS_URL not configured).");
      return;
    }

    const redisClient = createClient({
      url: this.redisUrl
    });
    redisClient.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.warn(`Auth session redis error: ${message}`);
    });

    try {
      await redisClient.connect();
      this.redisClient = redisClient;
    } catch (error) {
      try {
        if (redisClient.isOpen) {
          await redisClient.quit();
        }
      } catch {
        // Ignore cleanup errors after failed connection attempt.
      }
      if (this.storeMode === "redis") {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to connect auth session redis store: ${message}`);
      }
      this.warn("Auth sessions are using in-memory store (redis connection unavailable).");
    }
  }

  private redisSessionKey(sessionId: string): string {
    return `${this.redisKeyPrefix}${sessionId}`;
  }

  private parseSessionRecord(raw: string): AuthSessionRecord | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const candidate = parsed as Partial<AuthSessionRecord>;
    if (
      typeof candidate.sessionId !== "string" ||
      typeof candidate.provider !== "string" ||
      typeof candidate.subject !== "string" ||
      typeof candidate.createdAtMs !== "number" ||
      typeof candidate.expiresAtMs !== "number"
    ) {
      return null;
    }
    if (candidate.provider !== "google") {
      return null;
    }
    return {
      sessionId: candidate.sessionId,
      provider: "google",
      subject: candidate.subject,
      createdAtMs: candidate.createdAtMs,
      expiresAtMs: candidate.expiresAtMs
    };
  }

  private purgeExpiredMemorySessions(): void {
    const nowMs = Date.now();
    for (const [sessionId, record] of this.sessions.entries()) {
      if (record.expiresAtMs <= nowMs) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private async fetchGooglePayload<T>(url: string, init: RequestInit, errorMessage: string): Promise<T> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), GOOGLE_VERIFY_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: abortController.signal
      });
      if (!response.ok) {
        throw new Error(errorMessage);
      }
      const payload = (await response.json().catch(() => null)) as T | null;
      if (!payload) {
        throw new Error(errorMessage);
      }
      return payload;
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new Error("Google sign-in verification timed out.");
      }
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(errorMessage);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
