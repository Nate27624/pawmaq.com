import type { FastifyInstance } from "fastify";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { readAuthenticatedIdentity } from "./guards.js";
import type { PasskeyService } from "./passkey-service.js";
import { AUTH_SESSION_COOKIE_NAME, type AuthSessionIdentity, AuthSessionService } from "./service.js";
import type { ProfileLedgerService } from "../profiles/service.js";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/types";

type HumanChallengePurpose = "passkey_register" | "passkey_auth";

const passkeyBeginRegistrationSchema = z.object({
  humanProof: z.object({
    challengeId: z.string().min(12).max(240),
    counter: z.number().int().min(0).max(50_000_000),
    digestHex: z.string().regex(/^[a-f0-9]{64}$/i)
  })
});

const passkeyCompleteRegistrationSchema = z.object({
  challengeToken: z.string().min(12).max(240),
  response: z.unknown(),
  guest: z.boolean().optional()
});

const passkeyBeginAuthenticationSchema = z.object({
  humanProof: z.object({
    challengeId: z.string().min(12).max(240),
    counter: z.number().int().min(0).max(50_000_000),
    digestHex: z.string().regex(/^[a-f0-9]{64}$/i)
  })
});

const passkeyCompleteAuthenticationSchema = z.object({
  challengeToken: z.string().min(12).max(240),
  response: z.unknown(),
  guest: z.boolean().optional()
});

const HUMAN_CHALLENGE_SCHEMA = z.object({
  purpose: z.enum(["passkey_register", "passkey_auth"]).optional()
});

const DEVICE_PAIRING_START_SCHEMA = z.object({
  intent: z.enum(["sign_in", "link"]).optional()
});

const DEVICE_PAIRING_APPROVE_SCHEMA = z.object({
  pairingId: z.string().min(12).max(240),
  approvalSecret: z.string().min(12).max(240)
});

const DEVICE_PAIRING_STATUS_SCHEMA = z.object({
  pairingId: z.string().min(12).max(240),
  pollSecret: z.string().min(12).max(240)
});

const DEVICE_PAIRING_COMPLETE_SCHEMA = z.object({
  pairingId: z.string().min(12).max(240),
  pollSecret: z.string().min(12).max(240),
  handoffToken: z.string().min(12).max(240)
});

const HUMAN_CHALLENGE_RATE_WINDOW_MS = 60_000;
const HUMAN_CHALLENGE_RATE_MAX_PER_WINDOW = 120;
const HUMAN_CHALLENGE_TRACKED_KEYS_MAX = 10_000;
const HUMAN_CHALLENGE_TTL_MS = 2 * 60_000;
const HUMAN_CHALLENGE_DIFFICULTY_BITS = 12;
const HUMAN_CHALLENGE_STORE_MAX = 20_000;
const DEVICE_PAIRING_TTL_MS = 3 * 60_000;
const DEVICE_PAIRING_STORE_MAX = 20_000;

interface SignInRateCounter {
  windowStartMs: number;
  count: number;
}

interface PendingHumanChallenge {
  challengeId: string;
  nonce: string;
  ipKey: string;
  purpose: HumanChallengePurpose;
  difficultyBits: number;
  expiresAtMs: number;
}

interface DevicePairingSession {
  pairingId: string;
  intent: "sign_in" | "link";
  starterIdentity: AuthSessionIdentity | null;
  approvalSecret: string;
  pollSecret: string;
  handoffToken: string | null;
  approvedIdentity: AuthSessionIdentity | null;
  createdAtMs: number;
  expiresAtMs: number;
  status: "pending" | "approved" | "consumed";
}

interface AuthCookieSettings {
  sameSite: "strict" | "lax" | "none";
  secure: boolean;
  domain?: string;
}

function signInRateKey(raw: string | undefined): string {
  const normalized = (raw ?? "").trim().toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 120) : "unknown";
}

function pruneSignInRateCounters(counters: Map<string, SignInRateCounter>, nowMs: number): void {
  for (const [key, counter] of counters.entries()) {
    if (nowMs - counter.windowStartMs >= HUMAN_CHALLENGE_RATE_WINDOW_MS) {
      counters.delete(key);
    }
  }
  if (counters.size <= HUMAN_CHALLENGE_TRACKED_KEYS_MAX) {
    return;
  }
  const overflow = counters.size - HUMAN_CHALLENGE_TRACKED_KEYS_MAX;
  let removed = 0;
  for (const key of counters.keys()) {
    counters.delete(key);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

function leadingZeroBitsFromHex(hex: string): number {
  let count = 0;
  for (let index = 0; index < hex.length; index += 1) {
    const nibble = Number.parseInt(hex[index] ?? "0", 16);
    if (!Number.isFinite(nibble)) {
      break;
    }
    if (nibble === 0) {
      count += 4;
      continue;
    }
    if ((nibble & 0b1000) === 0) count += 1;
    if ((nibble & 0b0100) === 0) count += 1;
    if ((nibble & 0b0010) === 0) count += 1;
    break;
  }
  return count;
}

function constantTimeHexEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) {
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

function sessionCookieOptions(maxAgeSeconds: number, settings: AuthCookieSettings) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: settings.sameSite,
    secure: settings.secure,
    ...(settings.domain ? { domain: settings.domain } : {}),
    maxAge: maxAgeSeconds
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  profileLedger: ProfileLedgerService,
  authSessions: AuthSessionService,
  passkeys: PasskeyService,
  guestPasskeySessionTtlMinutes: number,
  authCookie: AuthCookieSettings
): Promise<void> {
  const cookieOptions = sessionCookieOptions(authSessions.getSessionMaxAgeSeconds(), authCookie);
  const guestSessionMaxAgeSeconds = Math.max(60, Math.floor(guestPasskeySessionTtlMinutes * 60));
  const guestCookieOptions = sessionCookieOptions(guestSessionMaxAgeSeconds, authCookie);
  const humanChallengeRateCounters = new Map<string, SignInRateCounter>();
  const pendingHumanChallenges = new Map<string, PendingHumanChallenge>();
  const devicePairings = new Map<string, DevicePairingSession>();

  function pruneHumanChallenges(nowMs: number): void {
    for (const [challengeId, challenge] of pendingHumanChallenges.entries()) {
      if (challenge.expiresAtMs <= nowMs) {
        pendingHumanChallenges.delete(challengeId);
      }
    }
    if (pendingHumanChallenges.size <= HUMAN_CHALLENGE_STORE_MAX) {
      return;
    }
    const overflow = pendingHumanChallenges.size - HUMAN_CHALLENGE_STORE_MAX;
    let removed = 0;
    for (const challengeId of pendingHumanChallenges.keys()) {
      pendingHumanChallenges.delete(challengeId);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }

  function pruneDevicePairings(nowMs: number): void {
    for (const [pairingId, pairing] of devicePairings.entries()) {
      if (pairing.expiresAtMs <= nowMs || pairing.status === "consumed") {
        devicePairings.delete(pairingId);
      }
    }
    if (devicePairings.size <= DEVICE_PAIRING_STORE_MAX) {
      return;
    }
    const overflow = devicePairings.size - DEVICE_PAIRING_STORE_MAX;
    let removed = 0;
    for (const pairingId of devicePairings.keys()) {
      devicePairings.delete(pairingId);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }

  function verifyHumanProof(
    ip: string | undefined,
    purpose: HumanChallengePurpose,
    proof: z.infer<typeof passkeyBeginAuthenticationSchema>["humanProof"]
  ): { ok: true } | { ok: false; message: string } {
    const nowMs = Date.now();
    pruneHumanChallenges(nowMs);
    const challenge = pendingHumanChallenges.get(proof.challengeId);
    if (!challenge) {
      return { ok: false, message: "Human verification challenge was not found or expired." };
    }
    pendingHumanChallenges.delete(proof.challengeId);
    if (challenge.expiresAtMs <= nowMs) {
      return { ok: false, message: "Human verification challenge expired. Please retry." };
    }
    if (challenge.purpose !== purpose) {
      return { ok: false, message: "Human verification challenge purpose did not match." };
    }
    if (challenge.ipKey !== signInRateKey(ip)) {
      return { ok: false, message: "Human verification challenge is bound to a different client." };
    }
    const payload = `${challenge.challengeId}:${challenge.nonce}:${proof.counter}`;
    const expectedDigest = createHash("sha256").update(payload).digest("hex");
    if (!constantTimeHexEqual(expectedDigest, proof.digestHex.toLowerCase())) {
      return { ok: false, message: "Human verification digest mismatch." };
    }
    if (leadingZeroBitsFromHex(expectedDigest) < challenge.difficultyBits) {
      return { ok: false, message: "Human verification proof did not satisfy challenge difficulty." };
    }
    return { ok: true };
  }

  app.post("/v1/auth/human-challenge", async (request, reply) => {
    const parsed = HUMAN_CHALLENGE_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid human challenge payload.",
        details: parsed.error.issues
      });
    }

    const purpose: HumanChallengePurpose = parsed.data.purpose ?? "passkey_auth";
    const nowMs = Date.now();
    const rateKey = signInRateKey(request.ip);
    pruneSignInRateCounters(humanChallengeRateCounters, nowMs);
    pruneHumanChallenges(nowMs);

    const counter = humanChallengeRateCounters.get(rateKey);
    if (!counter || nowMs - counter.windowStartMs >= HUMAN_CHALLENGE_RATE_WINDOW_MS) {
      humanChallengeRateCounters.set(rateKey, { windowStartMs: nowMs, count: 1 });
    } else if (counter.count >= HUMAN_CHALLENGE_RATE_MAX_PER_WINDOW) {
      return reply.code(429).send({
        error: "rate_limited",
        message: "Too many verification challenges requested. Please retry shortly.",
        retry_after_ms: Math.max(1, HUMAN_CHALLENGE_RATE_WINDOW_MS - (nowMs - counter.windowStartMs))
      });
    } else {
      counter.count += 1;
    }

    const challengeId = randomBytes(24).toString("base64url");
    const nonce = randomBytes(20).toString("hex");
    pendingHumanChallenges.set(challengeId, {
      challengeId,
      nonce,
      ipKey: rateKey,
      purpose,
      difficultyBits: HUMAN_CHALLENGE_DIFFICULTY_BITS,
      expiresAtMs: nowMs + HUMAN_CHALLENGE_TTL_MS
    });

    return reply.code(200).send({
      challengeId,
      nonce,
      purpose,
      algorithm: "sha256-leading-zero-bits",
      difficultyBits: HUMAN_CHALLENGE_DIFFICULTY_BITS,
      expiresAtMs: new Date(nowMs + HUMAN_CHALLENGE_TTL_MS).toISOString()
    });
  });

  app.post("/v1/auth/pairing/start", async (request, reply) => {
    const parsed = DEVICE_PAIRING_START_SCHEMA.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid pairing start payload.",
        details: parsed.error.issues
      });
    }
    const intent = parsed.data.intent ?? "sign_in";
    let starterIdentity: AuthSessionIdentity | null = null;
    if (intent === "link") {
      const identity = await readAuthenticatedIdentity(request, authSessions);
      if (!identity || identity.guest === true) {
        return reply.code(401).send({
          error: "unauthorized",
          message: "Sign in on this device before starting account linking."
        });
      }
      starterIdentity = {
        provider: identity.provider,
        subject: identity.subject,
        guest: false
      };
    }
    const nowMs = Date.now();
    pruneDevicePairings(nowMs);
    const pairingId = randomBytes(24).toString("base64url");
    const approvalSecret = randomBytes(18).toString("base64url");
    const pollSecret = randomBytes(18).toString("base64url");
    const session: DevicePairingSession = {
      pairingId,
      intent,
      starterIdentity,
      approvalSecret,
      pollSecret,
      handoffToken: null,
      approvedIdentity: null,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + DEVICE_PAIRING_TTL_MS,
      status: "pending"
    };
    devicePairings.set(pairingId, session);
    return reply.code(200).send({
      ok: true,
      intent,
      pairingId,
      approvalSecret,
      pollSecret,
      expiresAtMs: new Date(session.expiresAtMs).toISOString()
    });
  });

  app.post("/v1/auth/pairing/approve", async (request, reply) => {
    const parsed = DEVICE_PAIRING_APPROVE_SCHEMA.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid pairing approval payload.",
        details: parsed.error.issues
      });
    }
    const nowMs = Date.now();
    pruneDevicePairings(nowMs);
    const pairing = devicePairings.get(parsed.data.pairingId);
    if (!pairing || pairing.expiresAtMs <= nowMs) {
      return reply.code(404).send({
        error: "pairing_not_found",
        message: "Pairing request expired or not found."
      });
    }
    if (!constantTimeTextEqual(pairing.approvalSecret, parsed.data.approvalSecret)) {
      return reply.code(401).send({
        error: "pairing_approval_invalid",
        message: "Pairing approval token was invalid."
      });
    }

    const identity = await readAuthenticatedIdentity(request, authSessions);
    if (!identity || identity.guest === true) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Sign in on this device before approving link."
      });
    }

    pairing.approvedIdentity = {
      provider: identity.provider,
      subject: identity.subject,
      guest: false
    };
    pairing.handoffToken = randomBytes(24).toString("base64url");
    pairing.status = "approved";
    return reply.code(200).send({
      ok: true
    });
  });

  app.post("/v1/auth/pairing/status", async (request, reply) => {
    const parsed = DEVICE_PAIRING_STATUS_SCHEMA.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid pairing status payload.",
        details: parsed.error.issues
      });
    }
    const nowMs = Date.now();
    pruneDevicePairings(nowMs);
    const pairing = devicePairings.get(parsed.data.pairingId);
    if (!pairing || pairing.expiresAtMs <= nowMs) {
      return reply.code(200).send({
        status: "expired"
      });
    }
    if (!constantTimeTextEqual(pairing.pollSecret, parsed.data.pollSecret)) {
      return reply.code(401).send({
        error: "pairing_status_invalid",
        message: "Pairing poll token was invalid."
      });
    }
    if (pairing.status !== "approved" || !pairing.handoffToken) {
      return reply.code(200).send({
        status: pairing.status === "consumed" ? "consumed" : "pending"
      });
    }
    return reply.code(200).send({
      status: "approved",
      handoffToken: pairing.handoffToken
    });
  });

  app.post("/v1/auth/pairing/complete", async (request, reply) => {
    const parsed = DEVICE_PAIRING_COMPLETE_SCHEMA.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid pairing completion payload.",
        details: parsed.error.issues
      });
    }
    const nowMs = Date.now();
    pruneDevicePairings(nowMs);
    const pairing = devicePairings.get(parsed.data.pairingId);
    if (!pairing || pairing.expiresAtMs <= nowMs) {
      return reply.code(404).send({
        error: "pairing_not_found",
        message: "Pairing request expired or not found."
      });
    }
    if (!constantTimeTextEqual(pairing.pollSecret, parsed.data.pollSecret)) {
      return reply.code(401).send({
        error: "pairing_complete_invalid",
        message: "Pairing poll token was invalid."
      });
    }
    if (!pairing.handoffToken || !constantTimeTextEqual(pairing.handoffToken, parsed.data.handoffToken)) {
      return reply.code(401).send({
        error: "pairing_complete_invalid",
        message: "Pairing handoff token was invalid."
      });
    }
    if (!pairing.approvedIdentity || pairing.status !== "approved") {
      return reply.code(409).send({
        error: "pairing_not_approved",
        message: "Pairing has not been approved on the trusted device."
      });
    }

    pairing.status = "consumed";

    if (pairing.intent === "link") {
      if (!pairing.starterIdentity) {
        return reply.code(409).send({
          error: "pairing_linking_invalid",
          message: "Linking pairing is missing starter identity."
        });
      }
      try {
        const profile = await profileLedger.linkProviderSubjectToAccount({
          accountProvider: pairing.starterIdentity.provider,
          accountSubject: pairing.starterIdentity.subject,
          identityProvider: pairing.approvedIdentity.provider,
          identitySubject: pairing.approvedIdentity.subject
        });
        const sessionId = await authSessions.createSession({
          provider: pairing.starterIdentity.provider,
          subject: pairing.starterIdentity.subject,
          guest: false
        });
        reply.setCookie(AUTH_SESSION_COOKIE_NAME, sessionId, cookieOptions);
        return reply.code(200).send({
          ok: true,
          profile,
          guest: false,
          linking: true
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to link account identities.";
        return reply.code(409).send({
          error: "pairing_linking_failed",
          message
        });
      }
    }

    const sessionId = await authSessions.createSession({
      provider: pairing.approvedIdentity.provider,
      subject: pairing.approvedIdentity.subject,
      guest: false
    });
    reply.setCookie(AUTH_SESSION_COOKIE_NAME, sessionId, cookieOptions);

    let profile = await profileLedger.getByProviderSubject(
      pairing.approvedIdentity.provider,
      pairing.approvedIdentity.subject
    );
    if (!profile) {
      profile = await profileLedger.syncSession({
        provider: pairing.approvedIdentity.provider,
        subject: pairing.approvedIdentity.subject,
        name: "Anonymous"
      });
    }

    return reply.code(200).send({
      ok: true,
      profile,
      guest: false
    });
  });

  app.post("/v1/auth/passkey/register/options", async (request, reply) => {
    const parsed = passkeyBeginRegistrationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid passkey registration payload.",
        details: parsed.error.issues
      });
    }

    try {
      const humanProofResult = verifyHumanProof(request.ip, "passkey_register", parsed.data.humanProof);
      if (!humanProofResult.ok) {
        return reply.code(403).send({
          error: "human_verification_failed",
          message: humanProofResult.message
        });
      }

      const begin = await passkeys.beginRegistration();
      return reply.code(200).send({
        challengeToken: begin.challengeToken,
        options: begin.options
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start passkey registration.";
      return reply.code(400).send({
        error: "passkey_registration_begin_failed",
        message
      });
    }
  });

  app.post("/v1/auth/passkey/register/verify", async (request, reply) => {
    const parsed = passkeyCompleteRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid passkey registration verification payload.",
        details: parsed.error.issues
      });
    }

    try {
      const verified = await passkeys.completeRegistration(
        parsed.data.challengeToken,
        parsed.data.response as RegistrationResponseJSON
      );
      const profile = await profileLedger.syncSession({
        provider: "passkey",
        subject: verified.subject,
        name: verified.displayName
      });
      const sessionId = await authSessions.createSession(
        {
          provider: "passkey",
          subject: verified.subject,
          guest: parsed.data.guest === true
        },
        parsed.data.guest === true ? guestSessionMaxAgeSeconds * 1000 : undefined
      );
      reply.setCookie(
        AUTH_SESSION_COOKIE_NAME,
        sessionId,
        parsed.data.guest === true ? guestCookieOptions : cookieOptions
      );
      return reply.code(200).send({
        ok: true,
        profile,
        guest: parsed.data.guest === true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify passkey registration.";
      return reply.code(401).send({
        error: "passkey_registration_verify_failed",
        message
      });
    }
  });

  app.post("/v1/auth/passkey/authenticate/options", async (request, reply) => {
    const parsed = passkeyBeginAuthenticationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid passkey authentication payload.",
        details: parsed.error.issues
      });
    }
    try {
      const humanProofResult = verifyHumanProof(request.ip, "passkey_auth", parsed.data.humanProof);
      if (!humanProofResult.ok) {
        return reply.code(403).send({
          error: "human_verification_failed",
          message: humanProofResult.message
        });
      }

      const begin = await passkeys.beginAuthentication();
      return reply.code(200).send({
        challengeToken: begin.challengeToken,
        options: begin.options
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start passkey authentication.";
      return reply.code(400).send({
        error: "passkey_authentication_begin_failed",
        message
      });
    }
  });

  app.post("/v1/auth/passkey/authenticate/verify", async (request, reply) => {
    const parsed = passkeyCompleteAuthenticationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid passkey authentication verification payload.",
        details: parsed.error.issues
      });
    }

    try {
      const verified = await passkeys.completeAuthentication(
        parsed.data.challengeToken,
        parsed.data.response as AuthenticationResponseJSON
      );
      const displayName = (await passkeys.getDisplayNameBySubject(verified.subject)) ?? verified.displayName;
      const profile = await profileLedger.syncSession({
        provider: "passkey",
        subject: verified.subject,
        name: displayName
      });
      const sessionId = await authSessions.createSession(
        {
          provider: "passkey",
          subject: verified.subject,
          guest: parsed.data.guest === true
        },
        parsed.data.guest === true ? guestSessionMaxAgeSeconds * 1000 : undefined
      );
      reply.setCookie(
        AUTH_SESSION_COOKIE_NAME,
        sessionId,
        parsed.data.guest === true ? guestCookieOptions : cookieOptions
      );
      return reply.code(200).send({
        ok: true,
        profile,
        guest: parsed.data.guest === true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to verify passkey authentication.";
      return reply.code(401).send({
        error: "passkey_authentication_verify_failed",
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
      profile,
      guest: identity.guest === true
    });
  });

  app.post("/v1/auth/sign-out", async (request, reply) => {
    const sessionId = request.cookies[AUTH_SESSION_COOKIE_NAME] ?? "";
    await authSessions.revokeSession(sessionId);
    reply.clearCookie(AUTH_SESSION_COOKIE_NAME, cookieOptions);
    return reply.code(200).send({ ok: true });
  });
}
