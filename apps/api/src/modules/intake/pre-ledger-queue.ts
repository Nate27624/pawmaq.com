import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { basename } from "node:path";

export type PreLedgerQueueKind = "ledger_post" | "media_upload";

interface QueueLimitPolicy {
  maxPerWindow: number;
  windowMs: number;
}

interface PreLedgerQueueConfig {
  maxPending: number;
  limits: Record<PreLedgerQueueKind, QueueLimitPolicy>;
}

interface RateCounter {
  windowStartMs: number;
  count: number;
  windowMs: number;
}

export class PreLedgerQueueRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "PreLedgerQueueRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

export class PreLedgerQueueBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreLedgerQueueBusyError";
  }
}

export class PreLedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreLedgerValidationError";
  }
}

export class PreLedgerQueueService {
  private static readonly MAX_COUNTER_KEYS = 20_000;

  private readonly maxPending: number;

  private readonly limits: Record<PreLedgerQueueKind, QueueLimitPolicy>;

  private readonly counters = new Map<string, RateCounter>();

  private tail: Promise<void> = Promise.resolve();

  private pending = 0;

  constructor(config: PreLedgerQueueConfig) {
    this.maxPending = Math.max(1, Math.floor(config.maxPending));
    this.limits = config.limits;
  }

  async enqueue<T>(input: {
    actorKey: string;
    kind: PreLedgerQueueKind;
    validate?: () => void | Promise<void>;
    process: () => Promise<T>;
  }): Promise<T> {
    const actorKey = normalizeActorKey(input.actorKey);
    this.assertRateLimit(input.kind, actorKey);
    if (this.pending >= this.maxPending) {
      throw new PreLedgerQueueBusyError("Pre-ledger queue is full. Please retry shortly.");
    }

    this.pending += 1;
    const run = async () => {
      if (input.validate) {
        await input.validate();
      }
      return input.process();
    };

    const current = this.tail.then(run, run);
    this.tail = current.then(
      () => undefined,
      () => undefined
    );

    try {
      return await current;
    } finally {
      this.pending = Math.max(0, this.pending - 1);
    }
  }

  private assertRateLimit(kind: PreLedgerQueueKind, actorKey: string): void {
    const policy = this.limits[kind];
    const nowMs = Date.now();
    this.pruneCounters(nowMs);
    const bucketKey = `${kind}:${actorKey}`;
    const current = this.counters.get(bucketKey);

    if (!current || nowMs - current.windowStartMs >= policy.windowMs) {
      this.counters.set(bucketKey, {
        windowStartMs: nowMs,
        count: 1,
        windowMs: policy.windowMs
      });
      return;
    }

    if (current.count >= policy.maxPerWindow) {
      const retryAfterMs = Math.max(1, policy.windowMs - (nowMs - current.windowStartMs));
      throw new PreLedgerQueueRateLimitError(
        "Pre-ledger rate limit reached. Please wait before trying again.",
        retryAfterMs
      );
    }

    current.count += 1;
  }

  private pruneCounters(nowMs: number): void {
    if (this.counters.size === 0) {
      return;
    }
    for (const [bucketKey, counter] of this.counters.entries()) {
      if (nowMs - counter.windowStartMs >= counter.windowMs) {
        this.counters.delete(bucketKey);
      }
    }
    if (this.counters.size <= PreLedgerQueueService.MAX_COUNTER_KEYS) {
      return;
    }
    const overflow = this.counters.size - PreLedgerQueueService.MAX_COUNTER_KEYS;
    let removed = 0;
    for (const bucketKey of this.counters.keys()) {
      this.counters.delete(bucketKey);
      removed += 1;
      if (removed >= overflow) {
        break;
      }
    }
  }
}

export function validateCaptionLinks(text: string, maxLinks = 8): string[] {
  const urls = extractHttpUrls(text);
  if (urls.length > maxLinks) {
    throw new PreLedgerValidationError(`Post contains too many links (max ${maxLinks}).`);
  }
  for (const url of urls) {
    validatePublicHttpUrl(url, "caption link");
  }
  return urls;
}

export function validatePublicHttpUrl(urlText: string, fieldLabel: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    throw new PreLedgerValidationError(`${fieldLabel} must be a valid URL.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PreLedgerValidationError(`${fieldLabel} must use http or https.`);
  }
  if (isBlockedHostname(parsed.hostname)) {
    throw new PreLedgerValidationError(`${fieldLabel} cannot target a local/private host.`);
  }
  return parsed;
}

export function preprocessUploadForStorage(input: {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  maxBytes: number;
}): { normalizedName: string; sha256: string } {
  const normalizedName = normalizeFileName(input.originalName);
  if (!normalizedName) {
    throw new PreLedgerValidationError("Upload file name is invalid.");
  }
  if (input.buffer.byteLength <= 0) {
    throw new PreLedgerValidationError("Upload file is empty.");
  }
  if (input.buffer.byteLength > input.maxBytes) {
    throw new PreLedgerValidationError("Upload exceeds allowed size.");
  }

  assertMimeMatchesSignature(input.mimeType, input.buffer);
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  return { normalizedName, sha256 };
}

function normalizeActorKey(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "anonymous";
  }
  return trimmed.toLowerCase().slice(0, 120);
}

function extractHttpUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  return matches.map((url) => url.replace(/[),.!?;:]+$/g, ""));
}

function isBlockedHostname(hostnameRaw: string): boolean {
  const hostname = hostnameRaw.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname) {
    return true;
  }
  if (hostname.includes("%")) {
    return true;
  }
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "::" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return true;
  }

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    const ipv4 = parseIpv4(hostname);
    if (!ipv4) {
      return true;
    }
    const [a, b] = ipv4;
    if (a === 10 || a === 127 || a === 0) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
  }
  if (ipVersion === 6) {
    const normalized = hostname.toLowerCase();
    if (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb")
    ) {
      return true;
    }
  }

  return false;
}

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const segments = hostname.split(".");
  if (segments.length !== 4) {
    return null;
  }
  const parsed = segments.map((segment) => Number.parseInt(segment, 10));
  if (parsed.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return null;
  }
  return [parsed[0]!, parsed[1]!, parsed[2]!, parsed[3]!];
}

function normalizeFileName(input: string): string {
  const clean = basename(input).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!clean) {
    return "";
  }
  return clean.slice(0, 180);
}

function assertMimeMatchesSignature(mimeType: string, buffer: Buffer): void {
  const lowerMime = mimeType.toLowerCase();
  if (lowerMime === "image/png") {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    if (!buffer.subarray(0, 4).equals(pngMagic)) {
      throw new PreLedgerValidationError("Upload content does not match PNG signature.");
    }
    return;
  }
  if (lowerMime === "image/gif") {
    const gif87 = buffer.subarray(0, 6).toString("ascii") === "GIF87a";
    const gif89 = buffer.subarray(0, 6).toString("ascii") === "GIF89a";
    if (!gif87 && !gif89) {
      throw new PreLedgerValidationError("Upload content does not match GIF signature.");
    }
    return;
  }
  if (lowerMime === "image/jpeg") {
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      throw new PreLedgerValidationError("Upload content does not match JPEG signature.");
    }
    return;
  }
  if (lowerMime === "video/webm") {
    const webmMagic = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
    if (!buffer.subarray(0, 4).equals(webmMagic)) {
      throw new PreLedgerValidationError("Upload content does not match WEBM signature.");
    }
    return;
  }
  if (lowerMime === "video/mp4" || lowerMime === "video/quicktime") {
    const brandChunk = buffer.subarray(4, 12).toString("ascii");
    if (!brandChunk.includes("ftyp")) {
      throw new PreLedgerValidationError("Upload content does not match MP4/MOV signature.");
    }
    return;
  }
}
