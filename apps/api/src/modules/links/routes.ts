import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const querySchema = z.object({
  url: z.string().url().max(2048)
});

interface LinkPreviewResponse {
  ok: true;
  preview: {
    url: string;
    canonicalUrl: string;
    domain: string;
    title: string;
    description: string;
    imageUrl: string | null;
    faviconUrl: string | null;
    siteName?: string;
    authorName?: string;
  };
}

interface CachedPreviewEntry {
  expiresAtMs: number;
  payload: LinkPreviewResponse;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 7_000;
const MAX_HTML_BYTES = 512 * 1024;
const LINK_PREVIEW_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const previewCache = new Map<string, CachedPreviewEntry>();

const NAMED_HTML_ENTITIES = new Map<string, string>([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", "\""],
  ["apos", "'"],
  ["nbsp", " "],
  ["rsquo", "'"],
  ["lsquo", "'"],
  ["rdquo", "\""],
  ["ldquo", "\""],
  ["ndash", "-"],
  ["mdash", "-"],
  ["hellip", "..."]
]);

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (match, entityRaw) => {
      const entity = String(entityRaw);
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const codepoint = Number.parseInt(entity.slice(2), 16);
        if (Number.isFinite(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff) {
          try {
            return String.fromCodePoint(codepoint);
          } catch {
            return match;
          }
        }
        return match;
      }
      if (entity.startsWith("#")) {
        const codepoint = Number.parseInt(entity.slice(1), 10);
        if (Number.isFinite(codepoint) && codepoint >= 0 && codepoint <= 0x10ffff) {
          try {
            return String.fromCodePoint(codepoint);
          } catch {
            return match;
          }
        }
        return match;
      }
      return NAMED_HTML_ENTITIES.get(entity.toLowerCase()) ?? match;
    })
    .replace(/\u00a0/g, " ");
}

function clampText(value: string, maxLength: number): string {
  const normalized = decodeHtmlEntities(value).trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function domainFromUrl(url: URL): string {
  return url.hostname.replace(/^www\./i, "").toLowerCase();
}

function youtubeVideoIdFromUrl(url: URL): string | null {
  const host = domainFromUrl(url);
  if (host === "youtu.be") {
    const candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return /^[a-zA-Z0-9_-]{6,}$/.test(candidate) ? candidate : null;
  }
  if (!["youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    return null;
  }
  if (url.pathname === "/watch") {
    const candidate = url.searchParams.get("v") ?? "";
    return /^[a-zA-Z0-9_-]{6,}$/.test(candidate) ? candidate : null;
  }
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length >= 2 && (pathParts[0] === "shorts" || pathParts[0] === "embed")) {
    const candidate = pathParts[1] ?? "";
    return /^[a-zA-Z0-9_-]{6,}$/.test(candidate) ? candidate : null;
  }
  return null;
}

function titleFromPath(url: URL): string {
  const host = domainFromUrl(url);
  const path = url.pathname.replace(/\/+$/, "");
  if (!path || path === "/") {
    return `Article on ${host}`;
  }
  const segment = path.split("/").filter(Boolean).at(-1) ?? path;
  try {
    const decoded = decodeURIComponent(segment)
      .replace(/\.(html?|php|asp|aspx|jsp|xml|rss|json)$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (decoded.length < 4) {
      return `Article on ${host}`;
    }
    return clampText(decoded, 120);
  } catch {
    return `Article on ${host}`;
  }
}

function fallbackDescription(url: URL): string {
  const host = domainFromUrl(url);
  if (url.pathname === "/" || !url.pathname) {
    return `Open on ${host}.`;
  }
  return `Open this link on ${host}.`;
}

function defaultFaviconUrl(url: URL): string {
  return `https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(url.origin)}`;
}

function maybeAbsoluteUrl(baseUrl: URL, value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    const resolved = new URL(trimmed, baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

function tagAttributeValue(tag: string, attribute: string): string | null {
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\s${escapedAttribute}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = tag.match(pattern);
  return match?.[1]?.trim() ?? null;
}

function findMetaContent(html: string, attribute: "property" | "name", key: string): string | null {
  const metaTags = html.match(/<meta[^>]*>/gi) ?? [];
  const normalizedKey = key.toLowerCase();
  for (const tag of metaTags) {
    const attributeValue = tagAttributeValue(tag, attribute);
    if (!attributeValue || attributeValue.toLowerCase() !== normalizedKey) {
      continue;
    }
    const content = tagAttributeValue(tag, "content");
    if (content) {
      return content;
    }
  }
  return null;
}

function findLinkHref(html: string, relPattern: RegExp): string | null {
  const linkRegex = /<link[^>]*>/gi;
  const tags = html.match(linkRegex) ?? [];
  for (const tag of tags) {
    const relMatch = tag.match(/\srel\s*=\s*["']([^"']+)["']/i);
    if (!relMatch?.[1] || !relPattern.test(relMatch[1])) {
      continue;
    }
    const hrefMatch = tag.match(/\shref\s*=\s*["']([^"']+)["']/i);
    if (hrefMatch?.[1]) {
      return hrefMatch[1];
    }
  }
  return null;
}

function findTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch?.[1]) {
    return null;
  }
  return titleMatch[1].replace(/\s+/g, " ").trim();
}

function isPrivateIpv4(host: string): boolean {
  const segments = host.split(".").map((segment) => Number.parseInt(segment, 10));
  if (segments.length !== 4 || segments.some((segment) => !Number.isFinite(segment))) {
    return false;
  }
  const [a, b] = segments as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const normalized = host.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80")) return true;
  return false;
}

function isBlockedHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "0.0.0.0"
  ) {
    return true;
  }

  if (isIP(normalized) === 4) {
    return isPrivateIpv4(normalized);
  }
  if (isIP(normalized) === 6) {
    return isPrivateIpv6(normalized);
  }
  return false;
}

async function assertHostIsPublic(hostname: string): Promise<void> {
  if (isBlockedHost(hostname)) {
    throw new Error("This host is not allowed for link previews.");
  }
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    for (const address of addresses) {
      if (isBlockedHost(address.address)) {
        throw new Error("This host is not allowed for link previews.");
      }
    }
  } catch (error) {
    if (error instanceof Error && /not allowed/i.test(error.message)) {
      throw error;
    }
    throw new Error("Unable to resolve host for preview.");
  }
}

async function readHtmlWithLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

interface YouTubeOEmbedPayload {
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
}

async function fetchYouTubeOEmbed(canonicalUrl: URL): Promise<{
  title?: string;
  authorName?: string;
  siteName?: string;
  imageUrl?: string;
}> {
  const oEmbedUrl = new URL("https://www.youtube.com/oembed");
  oEmbedUrl.searchParams.set("format", "json");
  oEmbedUrl.searchParams.set("url", canonicalUrl.toString());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(oEmbedUrl.toString(), {
      signal: controller.signal,
      headers: {
        "user-agent": LINK_PREVIEW_USER_AGENT,
        accept: "application/json,text/plain;q=0.8,*/*;q=0.5"
      }
    });
    if (!response.ok) {
      return {};
    }
    const payload = (await response.json().catch(() => null)) as YouTubeOEmbedPayload | null;
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return {
      title: typeof payload.title === "string" ? clampText(payload.title, 120) : undefined,
      authorName: typeof payload.author_name === "string" ? clampText(payload.author_name, 90) : undefined,
      siteName: typeof payload.provider_name === "string" ? clampText(payload.provider_name, 40) : undefined,
      imageUrl:
        typeof payload.thumbnail_url === "string"
          ? maybeAbsoluteUrl(canonicalUrl, payload.thumbnail_url) ?? undefined
          : undefined
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchPreviewPayload(rawUrl: string): Promise<LinkPreviewResponse> {
  const url = new URL(rawUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https links are supported.");
  }
  await assertHostIsPublic(url.hostname);
  const directYoutubeVideoId = youtubeVideoIdFromUrl(url);
  if (directYoutubeVideoId) {
    const youtubeCanonical = new URL("https://www.youtube.com/watch");
    youtubeCanonical.searchParams.set("v", directYoutubeVideoId);
    const youtubeOEmbed = await fetchYouTubeOEmbed(youtubeCanonical);
    return {
      ok: true,
      preview: {
        url: url.toString(),
        canonicalUrl: youtubeCanonical.toString(),
        domain: "youtube.com",
        title: youtubeOEmbed.title ?? "YouTube video",
        description: youtubeOEmbed.authorName ? `Channel: ${youtubeOEmbed.authorName}` : "Watch on YouTube.",
        imageUrl: youtubeOEmbed.imageUrl ?? `https://i.ytimg.com/vi/${directYoutubeVideoId}/hqdefault.jpg`,
        faviconUrl: defaultFaviconUrl(youtubeCanonical),
        siteName: youtubeOEmbed.siteName ?? "YouTube",
        authorName: youtubeOEmbed.authorName
      }
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let resolvedUrl = url;
  let html = "";

  try {
    const response = await fetch(url.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": LINK_PREVIEW_USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.6,*/*;q=0.2",
        "accept-language": "en-US,en;q=0.9"
      }
    });
    if (!response.ok) {
      return {
        ok: true,
        preview: {
          url: url.toString(),
          canonicalUrl: url.toString(),
          domain: domainFromUrl(url),
          title: clampText(titleFromPath(url), 120),
          description: clampText(fallbackDescription(url), 220),
          imageUrl: null,
          faviconUrl: defaultFaviconUrl(url)
        }
      };
    }
    resolvedUrl = new URL(response.url);
    await assertHostIsPublic(resolvedUrl.hostname);

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return {
        ok: true,
        preview: {
          url: url.toString(),
          canonicalUrl: resolvedUrl.toString(),
          domain: domainFromUrl(resolvedUrl),
          title: clampText(titleFromPath(resolvedUrl), 120),
          description: clampText(`Open on ${domainFromUrl(resolvedUrl)}.`, 220),
          imageUrl: null,
          faviconUrl: defaultFaviconUrl(resolvedUrl)
        }
      };
    }

    html = await readHtmlWithLimit(response, MAX_HTML_BYTES);
  } finally {
    clearTimeout(timeoutId);
  }

  const canonicalHref =
    maybeAbsoluteUrl(resolvedUrl, findLinkHref(html, /canonical/i) ?? findMetaContent(html, "property", "og:url") ?? "") ??
    resolvedUrl.toString();
  const canonicalUrl = new URL(canonicalHref);
  const domain = domainFromUrl(canonicalUrl);
  const title =
    findMetaContent(html, "property", "og:title") ??
    findMetaContent(html, "name", "twitter:title") ??
    findTitle(html) ??
    titleFromPath(canonicalUrl);
  const description =
    findMetaContent(html, "property", "og:description") ??
    findMetaContent(html, "name", "twitter:description") ??
    findMetaContent(html, "name", "description") ??
    fallbackDescription(canonicalUrl);
  const imageUrl =
    maybeAbsoluteUrl(canonicalUrl, findMetaContent(html, "property", "og:image:secure_url") ?? "") ??
    maybeAbsoluteUrl(canonicalUrl, findMetaContent(html, "property", "og:image") ?? "") ??
    maybeAbsoluteUrl(canonicalUrl, findMetaContent(html, "name", "twitter:image") ?? "") ??
    maybeAbsoluteUrl(canonicalUrl, findLinkHref(html, /image_src/i) ?? "");
  const faviconUrl =
    maybeAbsoluteUrl(canonicalUrl, findLinkHref(html, /(?:^|\s)(?:icon|shortcut icon|apple-touch-icon)(?:\s|$)/i) ?? "") ??
    defaultFaviconUrl(canonicalUrl);
  const siteName =
    findMetaContent(html, "property", "og:site_name") ?? findMetaContent(html, "name", "application-name") ?? undefined;
  const authorName =
    findMetaContent(html, "name", "author") ?? findMetaContent(html, "property", "article:author") ?? undefined;

  let finalTitle = clampText(title, 120);
  let finalImageUrl = imageUrl;
  let finalSiteName = siteName ? clampText(siteName, 40) : undefined;
  let finalAuthorName = authorName ? clampText(authorName, 90) : undefined;
  const youtubeVideoId = youtubeVideoIdFromUrl(canonicalUrl);
  if (youtubeVideoId) {
    const youtubeCanonical = new URL("https://www.youtube.com/watch");
    youtubeCanonical.searchParams.set("v", youtubeVideoId);
    const youtubeOEmbed = await fetchYouTubeOEmbed(youtubeCanonical);
    finalTitle = youtubeOEmbed.title ?? finalTitle;
    finalImageUrl = youtubeOEmbed.imageUrl ?? finalImageUrl;
    finalSiteName = youtubeOEmbed.siteName ?? finalSiteName ?? "YouTube";
    finalAuthorName = youtubeOEmbed.authorName ?? finalAuthorName;
  }

  return {
    ok: true,
    preview: {
      url: url.toString(),
      canonicalUrl: canonicalUrl.toString(),
      domain,
      title: finalTitle,
      description: clampText(description, 220),
      imageUrl: finalImageUrl,
      faviconUrl,
      siteName: finalSiteName,
      authorName: finalAuthorName
    }
  };
}

export async function registerLinkRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/links/preview", async (request, reply) => {
    const parsed = querySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid link preview query.",
        details: parsed.error.issues
      });
    }

    const key = parsed.data.url.trim();
    const nowMs = Date.now();
    const cached = previewCache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
      return reply.code(200).send(cached.payload);
    }

    try {
      const payload = await fetchPreviewPayload(key);
      previewCache.set(key, {
        payload,
        expiresAtMs: nowMs + CACHE_TTL_MS
      });
      if (previewCache.size > 3000) {
        const oldestKey = previewCache.keys().next().value;
        if (typeof oldestKey === "string") {
          previewCache.delete(oldestKey);
        }
      }
      return reply.code(200).send(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate link preview.";
      if (!/not allowed|Only http and https|Invalid/i.test(message)) {
        try {
          const fallbackUrl = new URL(key);
          return reply.code(200).send({
            ok: true,
            preview: {
              url: fallbackUrl.toString(),
              canonicalUrl: fallbackUrl.toString(),
              domain: domainFromUrl(fallbackUrl),
              title: clampText(titleFromPath(fallbackUrl), 120),
              description: clampText(fallbackDescription(fallbackUrl), 220),
              imageUrl: null,
              faviconUrl: defaultFaviconUrl(fallbackUrl)
            }
          });
        } catch {
          // fall through to error response
        }
      }
      return reply.code(400).send({
        error: "link_preview_failed",
        message
      });
    }
  });
}
