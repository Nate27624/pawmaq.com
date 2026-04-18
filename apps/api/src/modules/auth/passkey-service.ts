import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  CredentialDeviceType,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  WebAuthnCredential
} from "@simplewebauthn/types";

interface PasskeyLedgerCredential {
  credential_id: Base64URLString;
  user_subject: string;
  public_key_base64url: Base64URLString;
  counter: number;
  transports: AuthenticatorTransportFuture[];
  device_type: CredentialDeviceType;
  backed_up: boolean;
  created_at: string;
  last_used_at: string;
}

interface PasskeyLedgerUser {
  subject: string;
  display_name: string;
  credential_ids: Base64URLString[];
  created_at: string;
  updated_at: string;
}

interface PasskeyLedger {
  ledger_version: string;
  generated_at: string;
  users: Record<string, PasskeyLedgerUser>;
  credentials: Record<string, PasskeyLedgerCredential>;
}

interface PendingRegistrationChallenge {
  type: "registration";
  challenge: string;
  subject: string;
  displayName: string;
  expiresAtMs: number;
}

interface PendingAuthenticationChallenge {
  type: "authentication";
  challenge: string;
  expiresAtMs: number;
}

type PendingChallenge = PendingRegistrationChallenge | PendingAuthenticationChallenge;

export interface PasskeyServiceOptions {
  ledgerPath: string;
  rpID: string;
  rpName: string;
  expectedOrigins: string[];
  challengeTtlMs?: number;
}

export interface BeginPasskeyRegistrationResult {
  challengeToken: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}

export interface CompletePasskeyRegistrationResult {
  subject: string;
  displayName: string;
}

export interface BeginPasskeyAuthenticationResult {
  challengeToken: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}

export interface CompletePasskeyAuthenticationResult {
  subject: string;
  displayName: string;
}

const DEFAULT_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function normalizeDisplayName(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "Anonymous";
  }
  return trimmed.slice(0, 120);
}

function uniqueBase64UrlToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function uniquePasskeySubject(): string {
  return `pk_${uniqueBase64UrlToken(18)}`;
}

function sanitizeTransports(values: unknown): AuthenticatorTransportFuture[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const allowed = new Set<AuthenticatorTransportFuture>([
    "ble",
    "cable",
    "hybrid",
    "internal",
    "nfc",
    "smart-card",
    "usb"
  ]);
  const deduped = new Set<AuthenticatorTransportFuture>();
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    if (allowed.has(value as AuthenticatorTransportFuture)) {
      deduped.add(value as AuthenticatorTransportFuture);
    }
  }
  return [...deduped];
}

function toStoredCredential(credential: WebAuthnCredential): {
  publicKeyBase64Url: Base64URLString;
  counter: number;
  transports: AuthenticatorTransportFuture[];
} {
  return {
    publicKeyBase64Url: isoBase64URL.fromBuffer(credential.publicKey) as Base64URLString,
    counter: Math.max(0, Math.floor(credential.counter)),
    transports: sanitizeTransports(credential.transports)
  };
}

function toVerificationCredential(stored: PasskeyLedgerCredential): WebAuthnCredential {
  return {
    id: stored.credential_id,
    publicKey: isoBase64URL.toBuffer(stored.public_key_base64url),
    counter: Math.max(0, Math.floor(stored.counter)),
    transports: sanitizeTransports(stored.transports)
  };
}

export class PasskeyService {
  private readonly ledgerPath: string;

  private readonly rpID: string;

  private readonly rpName: string;

  private readonly expectedOrigins: string[];

  private readonly challengeTtlMs: number;

  private readonly challenges = new Map<string, PendingChallenge>();

  private ledgerCache: PasskeyLedger | null = null;

  private loadingLedgerPromise: Promise<PasskeyLedger> | null = null;

  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: PasskeyServiceOptions) {
    this.ledgerPath = resolve(process.cwd(), options.ledgerPath);
    this.rpID = options.rpID;
    this.rpName = options.rpName;
    this.expectedOrigins = options.expectedOrigins;
    this.challengeTtlMs =
      options.challengeTtlMs && Number.isFinite(options.challengeTtlMs) && options.challengeTtlMs > 0
        ? Math.floor(options.challengeTtlMs)
        : DEFAULT_CHALLENGE_TTL_MS;
  }

  async beginRegistration(displayName?: string): Promise<BeginPasskeyRegistrationResult> {
    const ledger = await this.getLedger();
    const subject = uniquePasskeySubject();
    const normalizedDisplayName = normalizeDisplayName(displayName);
    const options = await generateRegistrationOptions({
      rpID: this.rpID,
      rpName: this.rpName,
      userName: subject,
      userDisplayName: normalizedDisplayName,
      userID: new TextEncoder().encode(subject),
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        userVerification: "required"
      },
      excludeCredentials: []
    });
    const challengeToken = uniqueBase64UrlToken(24);
    this.pruneExpiredChallenges();
    this.challenges.set(challengeToken, {
      type: "registration",
      challenge: options.challenge,
      subject,
      displayName: normalizedDisplayName,
      expiresAtMs: Date.now() + this.challengeTtlMs
    });

    // Touch the ledger to ensure the file exists before first verify.
    if (!ledger.ledger_version) {
      await this.persistLedger(ledger);
    }

    return {
      challengeToken,
      options
    };
  }

  async completeRegistration(
    challengeToken: string,
    response: RegistrationResponseJSON
  ): Promise<CompletePasskeyRegistrationResult> {
    const challenge = this.consumeChallenge(challengeToken, "registration");
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.expectedOrigins,
      expectedRPID: this.rpID,
      requireUserVerification: true
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration could not be verified.");
    }
    const registrationInfo = verification.registrationInfo;

    const credentialId = registrationInfo.credential.id;
    const storedCredential = toStoredCredential(registrationInfo.credential);
    const nowIso = new Date().toISOString();

    let resolvedSubject = challenge.subject;
    await this.mutateLedger((ledger) => {
      const existingCredential = ledger.credentials[credentialId];
      const subject = existingCredential?.user_subject ?? challenge.subject;
      resolvedSubject = subject;
      const existingUser = ledger.users[subject];
      const nextUser: PasskeyLedgerUser = existingUser
        ? {
            ...existingUser,
            display_name: challenge.displayName || existingUser.display_name,
            credential_ids: [...new Set([...existingUser.credential_ids, credentialId])],
            updated_at: nowIso
          }
        : {
            subject,
            display_name: challenge.displayName,
            credential_ids: [credentialId],
            created_at: nowIso,
            updated_at: nowIso
          };

      ledger.users[subject] = nextUser;
      ledger.credentials[credentialId] = {
        credential_id: credentialId,
        user_subject: subject,
        public_key_base64url: storedCredential.publicKeyBase64Url,
        counter: storedCredential.counter,
        transports: storedCredential.transports,
        device_type: registrationInfo.credentialDeviceType,
        backed_up: registrationInfo.credentialBackedUp,
        created_at: existingCredential?.created_at ?? nowIso,
        last_used_at: nowIso
      };
    });

    return {
      subject: resolvedSubject,
      displayName: challenge.displayName
    };
  }

  async beginAuthentication(): Promise<BeginPasskeyAuthenticationResult> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: "required"
    });
    const challengeToken = uniqueBase64UrlToken(24);
    this.pruneExpiredChallenges();
    this.challenges.set(challengeToken, {
      type: "authentication",
      challenge: options.challenge,
      expiresAtMs: Date.now() + this.challengeTtlMs
    });
    return {
      challengeToken,
      options
    };
  }

  async completeAuthentication(
    challengeToken: string,
    response: AuthenticationResponseJSON
  ): Promise<CompletePasskeyAuthenticationResult> {
    const challenge = this.consumeChallenge(challengeToken, "authentication");
    const credentialId = response.id;
    const ledger = await this.getLedger();
    const storedCredential = ledger.credentials[credentialId];
    if (!storedCredential) {
      throw new Error("No registered passkey was found for this device.");
    }
    const verificationCredential = toVerificationCredential(storedCredential);

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: this.expectedOrigins,
      expectedRPID: this.rpID,
      credential: verificationCredential,
      requireUserVerification: true
    });

    if (!verification.verified) {
      throw new Error("Passkey authentication could not be verified.");
    }

    const user = ledger.users[storedCredential.user_subject];
    if (!user) {
      throw new Error("Passkey user record is missing.");
    }

    const nowIso = new Date().toISOString();
    await this.mutateLedger((nextLedger) => {
      const credential = nextLedger.credentials[credentialId];
      if (!credential) {
        return;
      }
      credential.counter = Math.max(0, Math.floor(verification.authenticationInfo.newCounter));
      credential.device_type = verification.authenticationInfo.credentialDeviceType;
      credential.backed_up = verification.authenticationInfo.credentialBackedUp;
      credential.last_used_at = nowIso;
      const record = nextLedger.users[credential.user_subject];
      if (record) {
        record.updated_at = nowIso;
      }
    });

    return {
      subject: user.subject,
      displayName: user.display_name
    };
  }

  async getDisplayNameBySubject(subject: string): Promise<string | null> {
    const ledger = await this.getLedger();
    return ledger.users[subject]?.display_name ?? null;
  }

  private consumeChallenge<T extends PendingChallenge["type"]>(
    challengeToken: string,
    type: T
  ): Extract<PendingChallenge, { type: T }> {
    this.pruneExpiredChallenges();
    const challenge = this.challenges.get(challengeToken);
    if (!challenge || challenge.type !== type || challenge.expiresAtMs <= Date.now()) {
      this.challenges.delete(challengeToken);
      throw new Error("Passkey challenge is invalid or expired.");
    }
    this.challenges.delete(challengeToken);
    return challenge as Extract<PendingChallenge, { type: T }>;
  }

  private pruneExpiredChallenges(): void {
    const nowMs = Date.now();
    for (const [token, challenge] of this.challenges.entries()) {
      if (challenge.expiresAtMs <= nowMs) {
        this.challenges.delete(token);
      }
    }
  }

  private async getLedger(): Promise<PasskeyLedger> {
    if (this.ledgerCache) {
      return this.ledgerCache;
    }
    if (this.loadingLedgerPromise) {
      return this.loadingLedgerPromise;
    }
    this.loadingLedgerPromise = this.loadLedgerFromDisk().finally(() => {
      this.loadingLedgerPromise = null;
    });
    this.ledgerCache = await this.loadingLedgerPromise;
    return this.ledgerCache;
  }

  private async loadLedgerFromDisk(): Promise<PasskeyLedger> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    try {
      const raw = await readFile(this.ledgerPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PasskeyLedger>;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.ledger_version !== "string" ||
        typeof parsed.generated_at !== "string" ||
        typeof parsed.users !== "object" ||
        !parsed.users ||
        typeof parsed.credentials !== "object" ||
        !parsed.credentials
      ) {
        throw new Error("Invalid passkey ledger shape.");
      }
      const users: Record<string, PasskeyLedgerUser> = {};
      for (const [subject, user] of Object.entries(parsed.users as Record<string, Partial<PasskeyLedgerUser>>)) {
        if (!user || typeof user !== "object") {
          continue;
        }
        const normalizedSubject = (user.subject ?? subject).trim();
        if (!normalizedSubject) {
          continue;
        }
        users[normalizedSubject] = {
          subject: normalizedSubject,
          display_name: normalizeDisplayName(user.display_name),
          credential_ids: Array.isArray(user.credential_ids)
            ? [...new Set(user.credential_ids.filter((value): value is Base64URLString => typeof value === "string"))]
            : [],
          created_at:
            typeof user.created_at === "string" && user.created_at.trim().length > 0
              ? user.created_at
              : new Date().toISOString(),
          updated_at:
            typeof user.updated_at === "string" && user.updated_at.trim().length > 0
              ? user.updated_at
              : new Date().toISOString()
        };
      }
      const credentials: Record<string, PasskeyLedgerCredential> = {};
      for (const [credentialId, credential] of Object.entries(
        parsed.credentials as Record<string, Partial<PasskeyLedgerCredential>>
      )) {
        if (!credential || typeof credential !== "object") {
          continue;
        }
        const normalizedId = (credential.credential_id ?? credentialId).trim() as Base64URLString;
        const userSubject = (credential.user_subject ?? "").trim();
        if (!normalizedId || !userSubject || !users[userSubject]) {
          continue;
        }
        const publicKeyBase64Url = (credential.public_key_base64url ?? "").trim() as Base64URLString;
        if (!publicKeyBase64Url) {
          continue;
        }
        credentials[normalizedId] = {
          credential_id: normalizedId,
          user_subject: userSubject,
          public_key_base64url: publicKeyBase64Url,
          counter: Number.isFinite(credential.counter) ? Math.max(0, Math.floor(credential.counter ?? 0)) : 0,
          transports: sanitizeTransports(credential.transports),
          device_type: credential.device_type === "singleDevice" ? "singleDevice" : "multiDevice",
          backed_up: credential.backed_up === true,
          created_at:
            typeof credential.created_at === "string" && credential.created_at.trim().length > 0
              ? credential.created_at
              : new Date().toISOString(),
          last_used_at:
            typeof credential.last_used_at === "string" && credential.last_used_at.trim().length > 0
              ? credential.last_used_at
              : new Date().toISOString()
        };
      }
      return {
        ledger_version: parsed.ledger_version,
        generated_at: parsed.generated_at,
        users,
        credentials
      };
    } catch {
      const initial: PasskeyLedger = {
        ledger_version: "v1.0",
        generated_at: new Date().toISOString(),
        users: {},
        credentials: {}
      };
      await this.persistLedger(initial);
      return initial;
    }
  }

  private async mutateLedger(mutator: (ledger: PasskeyLedger) => void): Promise<void> {
    return this.withMutationLock(async () => {
      const ledger = await this.getLedger();
      mutator(ledger);
      ledger.generated_at = new Date().toISOString();
      await this.persistLedger(ledger);
    });
  }

  private async persistLedger(ledger: PasskeyLedger): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    const tmpPath = `${this.ledgerPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.ledgerPath);
  }

  private async withMutationLock<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
