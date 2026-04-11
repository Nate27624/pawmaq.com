import { createHash } from "node:crypto";
import type { PostLedgerClientPayload } from "../ledger/types.js";
import type { PostPopularityLedgerService } from "../ledger/service.js";
import type { ProfileLedgerService } from "../profiles/service.js";

const FETCH_TIMEOUT_MS = 12_000;
const MAX_CAPTION_CHARS = 20_000;
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface BotLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

interface ParsedRssItem {
  stableId: string;
  link: string;
  title: string;
  bodyText: string;
  createdAtMs: number;
  mediaUrl?: string;
  mediaType?: "video" | "gif" | "png";
}

export interface RssBotFeedConfig {
  feedUrl: string;
  handle: string;
  name: string;
  countryCode: string;
  countryName: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
}

export interface RssBotIngestionServiceOptions {
  enabled: boolean;
  intervalMinutes: number;
  maxItemsPerFeedPerRun: number;
  userAgent: string;
  feedsRaw: string;
  postLedger: PostPopularityLedgerService;
  profileLedger: ProfileLedgerService;
  logger: BotLogger;
}

function trimTo(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function stripHtmlToText(raw: string): string {
  const withBreaks = raw
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\/\s*div\s*>/gi, "\n")
    .replace(/<\/\s*li\s*>/gi, "\n");
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeXmlEntities(withoutTags);
  return decoded.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
}

function normalizeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseTagAttributes(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(raw);
  while (match) {
    const key = (match[1] ?? "").trim().toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (key) {
      result[key] = decodeXmlEntities(value).trim();
    }
    match = pattern.exec(raw);
  }
  return result;
}

function extractTagBody(block: string, tagNames: string[]): string {
  for (const tag of tagNames) {
    const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const match = pattern.exec(block);
    const value = match?.[1] ?? "";
    if (value.trim().length > 0) {
      return decodeXmlEntities(value).trim();
    }
  }
  return "";
}

function extractTagAttributes(block: string, tagNames: string[]): Record<string, string> | null {
  for (const tag of tagNames) {
    const pattern = new RegExp(`<${tag}\\b([^>]*)\\/?>`, "i");
    const match = pattern.exec(block);
    if (!match) {
      continue;
    }
    return parseTagAttributes(match[1] ?? "");
  }
  return null;
}

function extractBlocks(xml: string, tagName: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match = pattern.exec(xml);
  while (match) {
    const body = match[1] ?? "";
    if (body.trim().length > 0) {
      blocks.push(body);
    }
    match = pattern.exec(xml);
  }
  return blocks;
}

function inferMediaType(url: string, mimeType?: string): "video" | "gif" | "png" | null {
  const normalizedMime = (mimeType ?? "").trim().toLowerCase();
  if (normalizedMime.startsWith("video/")) {
    return "video";
  }
  if (normalizedMime === "image/gif") {
    return "gif";
  }
  if (normalizedMime === "image/png") {
    return "png";
  }
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (path.endsWith(".gif")) {
    return "gif";
  }
  if (path.endsWith(".png")) {
    return "png";
  }
  if (path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".mov") || path.endsWith(".m4v")) {
    return "video";
  }
  return null;
}

function buildCaption(item: ParsedRssItem): string {
  const parts: string[] = [];
  const title = trimTo(item.title, 240);
  const body = item.bodyText;
  if (title.length > 0) {
    parts.push(title);
  }
  if (body.length > 0) {
    parts.push(body);
  }
  if (item.link.length > 0) {
    parts.push(item.link);
  }
  const caption = parts.join("\n\n").trim();
  return caption.slice(0, MAX_CAPTION_CHARS);
}

function parseDateMs(raw: string): number {
  if (!raw.trim()) {
    return Date.now();
  }
  const candidate = new Date(raw).getTime();
  return Number.isFinite(candidate) ? candidate : Date.now();
}

function parseFeedItems(xml: string): ParsedRssItem[] {
  const itemBlocks = extractBlocks(xml, "item");
  const entryBlocks = itemBlocks.length > 0 ? [] : extractBlocks(xml, "entry");
  const blocks = itemBlocks.length > 0 ? itemBlocks : entryBlocks;
  const items: ParsedRssItem[] = [];

  for (const block of blocks) {
    const title = stripHtmlToText(extractTagBody(block, ["title"]));
    const guid = trimTo(extractTagBody(block, ["guid", "id"]), 500);
    const pubDate = trimTo(extractTagBody(block, ["pubDate", "published", "updated"]), 120);
    const description = extractTagBody(block, ["content:encoded", "description", "summary", "content"]);
    const bodyText = stripHtmlToText(description);

    let link = normalizeHttpUrl(extractTagBody(block, ["link"])) ?? "";
    if (!link) {
      const linkTagAttrs = extractTagAttributes(block, ["link"]);
      link = normalizeHttpUrl(linkTagAttrs?.href ?? "") ?? "";
    }

    let mediaUrl = "";
    let mediaType: "video" | "gif" | "png" | undefined;
    for (const mediaTag of ["enclosure", "media:content"]) {
      const attrs = extractTagAttributes(block, [mediaTag]);
      const candidateUrl = normalizeHttpUrl(attrs?.url ?? attrs?.href ?? "");
      if (!candidateUrl) {
        continue;
      }
      const candidateType = inferMediaType(candidateUrl, attrs?.type);
      if (!candidateType) {
        continue;
      }
      mediaUrl = candidateUrl;
      mediaType = candidateType;
      break;
    }

    const stableId = trimTo(guid || link || `${title}:${pubDate}`, 500);
    if (!stableId) {
      continue;
    }

    items.push({
      stableId,
      link,
      title,
      bodyText,
      createdAtMs: parseDateMs(pubDate),
      mediaUrl: mediaUrl || undefined,
      mediaType
    });
  }

  return items;
}

function feedPostId(feedUrl: string, stableId: string): string {
  const digest = createHash("sha256").update(`${feedUrl}::${stableId}`).digest("hex");
  return `rss-${digest.slice(0, 32)}`;
}

function isRefreshableStalePost(existing: {
  created_at?: string;
  engagement?: {
    likes?: number;
    neutral?: number;
    dislikes?: number;
    comments_count?: number;
  };
} | null | undefined): boolean {
  if (!existing) {
    return false;
  }
  const createdAtMs = new Date(existing.created_at ?? "").getTime();
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  const ageMs = Date.now() - createdAtMs;
  if (ageMs <= ONE_YEAR_MS) {
    return false;
  }
  const likes = Number.isFinite(existing.engagement?.likes) ? Math.max(0, Math.floor(existing.engagement?.likes ?? 0)) : 0;
  const neutral = Number.isFinite(existing.engagement?.neutral)
    ? Math.max(0, Math.floor(existing.engagement?.neutral ?? 0))
    : 0;
  const dislikes = Number.isFinite(existing.engagement?.dislikes)
    ? Math.max(0, Math.floor(existing.engagement?.dislikes ?? 0))
    : 0;
  const comments = Number.isFinite(existing.engagement?.comments_count)
    ? Math.max(0, Math.floor(existing.engagement?.comments_count ?? 0))
    : 0;
  return likes === 0 && neutral === 0 && dislikes === 0 && comments === 0;
}

function parseFeedLine(line: string): RssBotFeedConfig | null {
  const chunks = line.split("|").map((value) => value.trim());
  if (chunks.length < 3) {
    return null;
  }
  const [feedUrlRaw, handleRaw, nameRaw, countryCodeRaw, countryNameRaw, bioRaw] = chunks;
  const feedUrl = normalizeHttpUrl(feedUrlRaw ?? "");
  if (!feedUrl) {
    return null;
  }
  const handle = handleRaw?.startsWith("@") ? handleRaw : `@${handleRaw ?? ""}`;
  const normalizedHandle = handle.trim().toLowerCase().replace(/[^@a-z0-9._-]/g, "");
  if (!/^@[a-z0-9._-]{2,32}$/.test(normalizedHandle)) {
    return null;
  }
  return {
    feedUrl,
    handle: normalizedHandle,
    name: trimTo(nameRaw ?? normalizedHandle, 120) || normalizedHandle,
    countryCode: trimTo((countryCodeRaw ?? "WW").toUpperCase(), 8) || "WW",
    countryName: trimTo(countryNameRaw ?? "Worldwide", 120) || "Worldwide",
    bio: trimTo(bioRaw ?? "", 300) || undefined
  };
}

export function parseRssBotFeedConfigs(raw: string): RssBotFeedConfig[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as Array<Record<string, unknown>>;
      const mapped = parsed
        .map((entry) => {
          const line = [
            String(entry.feedUrl ?? entry.url ?? ""),
            String(entry.handle ?? ""),
            String(entry.name ?? ""),
            String(entry.countryCode ?? "WW"),
            String(entry.countryName ?? "Worldwide"),
            String(entry.bio ?? "")
          ].join("|");
          const config = parseFeedLine(line);
          if (!config) {
            return null;
          }
          if (typeof entry.avatarUrl === "string" && entry.avatarUrl.trim().length > 0) {
            config.avatarUrl = entry.avatarUrl.trim();
          }
          if (typeof entry.bannerUrl === "string" && entry.bannerUrl.trim().length > 0) {
            config.bannerUrl = entry.bannerUrl.trim();
          }
          return config;
        })
        .filter((entry): entry is RssBotFeedConfig => entry !== null);
      return mapped;
    } catch {
      return [];
    }
  }

  const lines = trimmed
    .split(/\r?\n|;/g)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && !value.startsWith("#"));
  return lines
    .map((line) => parseFeedLine(line))
    .filter((entry): entry is RssBotFeedConfig => entry !== null);
}

export class RssBotIngestionService {
  private readonly enabled: boolean;

  private readonly intervalMs: number;

  private readonly maxItemsPerFeedPerRun: number;

  private readonly userAgent: string;

  private readonly feeds: RssBotFeedConfig[];

  private readonly postLedger: PostPopularityLedgerService;

  private readonly profileLedger: ProfileLedgerService;

  private readonly logger: BotLogger;

  private timer: NodeJS.Timeout | null = null;

  private syncPromise: Promise<void> | null = null;

  constructor(options: RssBotIngestionServiceOptions) {
    this.enabled = options.enabled;
    this.intervalMs = Math.max(1, Math.floor(options.intervalMinutes)) * 60_000;
    this.maxItemsPerFeedPerRun = Math.max(0, Math.floor(options.maxItemsPerFeedPerRun));
    this.userAgent = options.userAgent.trim() || "pawmaq-rss-bot/1.0";
    this.feeds = parseRssBotFeedConfigs(options.feedsRaw);
    this.postLedger = options.postLedger;
    this.profileLedger = options.profileLedger;
    this.logger = options.logger;
    if (this.enabled && options.feedsRaw.trim().length > 0 && this.feeds.length === 0) {
      this.logger.warn("[rss-bots] RSS_BOTS_FEEDS provided but no valid feed entries were parsed");
    }
  }

  get feedCount(): number {
    return this.feeds.length;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      this.logger.info("[rss-bots] disabled");
      return;
    }
    if (this.feeds.length === 0) {
      this.logger.info("[rss-bots] enabled but no feeds configured");
      return;
    }
    this.logger.info(`[rss-bots] starting with ${this.feeds.length} feed(s), interval=${Math.floor(this.intervalMs / 60_000)}m`);
    await this.syncNow("startup");
    this.timer = setInterval(() => {
      void this.syncNow("interval");
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.syncPromise) {
      await this.syncPromise.catch(() => {
        // Keep shutdown resilient.
      });
    }
  }

  async syncNow(trigger: "startup" | "interval" | "manual"): Promise<void> {
    if (!this.enabled || this.feeds.length === 0) {
      return;
    }
    if (this.syncPromise) {
      return this.syncPromise;
    }
    this.syncPromise = this.runSync(trigger).finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  private async runSync(trigger: "startup" | "interval" | "manual"): Promise<void> {
    const startMs = Date.now();
    const snapshot = await this.postLedger.getLedgerSnapshot();
    const knownPostIds = new Set(Object.keys(snapshot.posts));
    let importedTotal = 0;

    for (const feed of this.feeds) {
      try {
        await this.profileLedger.ensureBotProfile({
          handle: feed.handle,
          name: feed.name,
          username: feed.handle.replace(/^@/, ""),
          bio: feed.bio,
          location: feed.countryName,
          avatarUrl: feed.avatarUrl,
          bannerUrl: feed.bannerUrl,
          botSubject: `rss:${feed.feedUrl}:${feed.handle}`
        });

        const xml = await this.fetchFeedXml(feed.feedUrl);
        const items = parseFeedItems(xml).sort((left, right) => left.createdAtMs - right.createdAtMs);
        let importedForFeed = 0;
        const importNowMs = Date.now();
        for (const item of items) {
          if (this.maxItemsPerFeedPerRun > 0 && importedForFeed >= this.maxItemsPerFeedPerRun) {
            break;
          }
          const postId = feedPostId(feed.feedUrl, item.stableId);
          const existingPost = snapshot.posts[postId];
          const shouldRefreshStaleExisting = isRefreshableStalePost(existingPost);
          if (knownPostIds.has(postId) && !shouldRefreshStaleExisting) {
            continue;
          }
          const caption = buildCaption(item);
          if (!caption) {
            continue;
          }

          const ageMs = Math.max(0, importNowMs - item.createdAtMs);
          const createdAtMsForLedger =
            ageMs > ONE_YEAR_MS || !Number.isFinite(item.createdAtMs)
              ? importNowMs - importedForFeed * 1_000
              : item.createdAtMs;

          const payload: PostLedgerClientPayload = {
            id: postId,
            author: feed.name,
            handle: feed.handle,
            caption,
            createdAtMs: createdAtMsForLedger,
            countryCode: feed.countryCode,
            countryName: feed.countryName,
            upvotes: 0,
            neutralVotes: 0,
            downvotes: 0,
            comments: 0
          };
          if (item.mediaType && item.mediaUrl) {
            payload.mediaType = item.mediaType;
            payload.mediaUrl = item.mediaUrl;
          }

          await this.postLedger.upsertPost(payload);
          await this.profileLedger.recordCreatedPostByHandle({
            handle: feed.handle,
            postId
          });
          knownPostIds.add(postId);
          importedForFeed += 1;
          importedTotal += 1;
        }
        if (importedForFeed > 0) {
          this.logger.info(`[rss-bots] imported ${importedForFeed} post(s) from ${feed.feedUrl}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[rss-bots] feed import failed for ${feed.feedUrl}: ${message}`);
      }
    }

    const elapsedMs = Date.now() - startMs;
    this.logger.info(`[rss-bots] sync(${trigger}) complete in ${elapsedMs}ms, imported=${importedTotal}`);
  }

  private async fetchFeedXml(feedUrl: string): Promise<string> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(feedUrl, {
        headers: {
          accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
          "user-agent": this.userAgent
        },
        signal: abortController.signal
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
