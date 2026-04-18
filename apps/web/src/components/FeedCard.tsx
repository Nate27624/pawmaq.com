import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL } from "../config/api";
import type { FeedPost } from "../types";

interface FeedCardProps {
  post: FeedPost;
  nativeLanguage: string;
  isSaved: boolean;
  onToggleSave: (postId: string) => void;
  onOpenPost?: (postId: string) => void;
  forceCommentsOpen?: boolean;
  disableHeaderOpen?: boolean;
  isFullscreen?: boolean;
  isSignedIn: boolean;
  onSignInWithPasskey: () => Promise<boolean>;
  onCreatePasskeyOnDevice: () => Promise<boolean>;
  passkeySignInEnabled: boolean;
  viewerHandle: string;
  onOpenAuthorProfile: (name: string, handle: string) => void;
  reactionState: ReactionState;
  isReposted: boolean;
  extraComments: number;
  onReactionChange: (postId: string, next: ReactionState) => void;
  onToggleRepost: (postId: string) => void;
  onCommentCountIncrement: (postId: string) => void;
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H10C6 3 3 6 3 10V14C3 18 6 21 10 21H12L16 17H14C11 17 9 15 9 12V10C9 7 11 5 14 5H21V10C21 13 19 15 16 15H13L11 17H16C20 17 23 14 23 10V8C23 5 20 3 16 3H14Z" />
    </svg>
  );
}

function RepostIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 2L22 7L17 12V9H8V7H17V2ZM7 12V15H16V17H7V22L2 17L7 12Z" />
    </svg>
  );
}

function ViewsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 19H21V21H3V19ZM5 10H8V17H5V10ZM10 6H13V17H10V6ZM15 12H18V17H15V12Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3H15L16 4H21V6H3V4H8L9 3ZM6 8H18L17 21H7L6 8ZM10 10V18H12V10H10ZM12 10V18H14V10H12Z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3H18C19.1 3 20 3.9 20 5V21L12 17.2L4 21V5C4 3.9 4.9 3 6 3ZM6 5V17.6L12 14.7L18 17.6V5H6Z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 4V1L23 9L14 17V14C7.5 14 3 16.1 1 21C1.7 13.8 5.7 9 14 9V4Z" />
    </svg>
  );
}

function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 10H6V22H2V10ZM22 11.5C22 10.12 20.88 9 19.5 9H13.22L14.17 4.43L14.2 4.11C14.2 3.7 14.03 3.33 13.76 3.05L12.7 2L6.12 8.59C5.74 8.97 5.5 9.48 5.5 10V20.5C5.5 21.88 6.62 23 8 23H17.5C18.54 23 19.44 22.37 19.82 21.46L22 14.84V11.5Z" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 2H6V14H2V2ZM22 12.5C22 13.88 20.88 15 19.5 15H13.22L14.17 19.57L14.2 19.89C14.2 20.3 14.03 20.67 13.76 20.95L12.7 22L6.12 15.41C5.74 15.03 5.5 14.52 5.5 14V3.5C5.5 2.12 6.62 1 8 1H17.5C18.54 1 19.44 1.63 19.82 2.54L22 9.16V12.5Z" />
    </svg>
  );
}

type ReactionState = "up" | "neutral" | "down" | null;
type CommentReaction = "up" | "down" | null;
type PostLanguageMode = "native" | "original";
type LeftActionState = "comments" | null;
const SIGN_IN_REQUIRED_COMMENT_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to comment. This helps keep the number of bots at a minimum.";
const SIGN_IN_REQUIRED_VOTE_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to vote. This helps keep the number of bots at a minimum.";
const SIGN_IN_REQUIRED_COMMENT_REACTION_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to react to comments. This helps keep the number of bots at a minimum.";
const SCROLL_TARGET_POST_KEY = "pawmaq-scroll-target-post-id";

interface ThreadReply {
  id: string;
  author: string;
  handle: string;
  age: string;
  text: string;
  likes: number;
  dislikes: number;
  reaction: CommentReaction;
}

interface ThreadComment {
  id: string;
  author: string;
  handle: string;
  age: string;
  text: string;
  likes: number;
  dislikes: number;
  reaction: CommentReaction;
  replies: ThreadReply[];
}

interface LedgerReplyRecord {
  reply_id: string;
  author: string;
  handle: string;
  text: string;
  created_at: string;
  likes: number;
  dislikes: number;
  viewer_reaction?: "up" | "down" | null;
}

interface LedgerCommentRecord {
  comment_id: string;
  author: string;
  handle: string;
  text: string;
  created_at: string;
  likes: number;
  dislikes: number;
  viewer_reaction?: "up" | "down" | null;
  replies: LedgerReplyRecord[];
}

interface PostLinkPreview {
  href: string;
  domain: string;
  title: string;
  subtitle: string;
  imageUrl?: string;
  faviconUrl?: string;
  siteName?: string;
  authorName?: string;
  embedUrl?: string;
  embedKind?: "youtube" | "x" | "tiktok" | "instagram";
}

interface LinkPreviewMetadata {
  canonicalUrl: string;
  domain: string;
  title: string;
  description: string;
  imageUrl: string | null;
  faviconUrl: string | null;
  siteName?: string;
  authorName?: string;
}

interface LinkPreviewMetadataResponse {
  ok: boolean;
  preview?: Partial<LinkPreviewMetadata>;
}

const linkPreviewMetadataCache = new Map<string, Promise<LinkPreviewMetadata | null>>();

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function relativeAgeLabel(isoDate: string): string {
  const created = new Date(isoDate).getTime();
  if (!Number.isFinite(created)) {
    return "just now";
  }
  const deltaMs = Math.max(0, Date.now() - created);
  const deltaMinutes = Math.floor(deltaMs / 60000);
  if (deltaMinutes < 1) {
    return "just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${deltaDays}d ago`;
}

function mapLedgerReply(reply: LedgerReplyRecord): ThreadReply {
  return {
    id: reply.reply_id,
    author: reply.author,
    handle: reply.handle,
    age: relativeAgeLabel(reply.created_at),
    text: reply.text,
    likes: Math.max(0, reply.likes),
    dislikes: Math.max(0, reply.dislikes),
    reaction: reply.viewer_reaction === "up" || reply.viewer_reaction === "down" ? reply.viewer_reaction : null
  };
}

function mapLedgerComment(comment: LedgerCommentRecord): ThreadComment {
  return {
    id: comment.comment_id,
    author: comment.author,
    handle: comment.handle,
    age: relativeAgeLabel(comment.created_at),
    text: comment.text,
    likes: Math.max(0, comment.likes),
    dislikes: Math.max(0, comment.dislikes),
    reaction: comment.viewer_reaction === "up" || comment.viewer_reaction === "down" ? comment.viewer_reaction : null,
    replies: Array.isArray(comment.replies) ? comment.replies.map(mapLedgerReply) : []
  };
}

async function fetchPostCommentsFromLedger(postId: string, actorId?: string): Promise<ThreadComment[]> {
  const query = actorId ? `?actorId=${encodeURIComponent(actorId)}` : "";
  const response = await fetch(`${API_BASE_URL}/v1/ledger/posts/${encodeURIComponent(postId)}/comments${query}`, {
    credentials: "include"
  });
  const payload = (await response.json().catch(() => null)) as
    | {
        comments?: LedgerCommentRecord[];
        message?: string;
      }
    | null;
  if (!response.ok) {
    throw new Error(payload?.message ?? "Unable to load comments.");
  }
  const comments = Array.isArray(payload?.comments) ? payload.comments : [];
  return comments.map(mapLedgerComment);
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.?0+$/, "");
}

function formatCompact(value: number, maxFractionDigits = 1): string {
  if (value >= 1000000) {
    return `${trimTrailingZeros((value / 1000000).toFixed(maxFractionDigits))}M`;
  }
  if (value >= 1000) {
    return `${trimTrailingZeros((value / 1000).toFixed(maxFractionDigits))}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

function formatLikeCompact(value: number): string {
  if (value >= 1000000) {
    return `${trimTrailingZeros((value / 1000000).toFixed(1))}M`;
  }
  if (value >= 1000) {
    return `${trimTrailingZeros((value / 1000).toFixed(1))}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function approvalPercentFromVotes(upvotes: number, neutralVotes: number, downvotes: number): number {
  const totalVotes = upvotes + neutralVotes + downvotes;
  if (totalVotes <= 0) {
    return 50;
  }

  const weightedPositive = upvotes + neutralVotes * 0.5;
  return clampPercent((weightedPositive / totalVotes) * 100);
}

function countryFlagFromIso2(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return "";
  }
  return String.fromCodePoint(
    normalized.charCodeAt(0) + 127397,
    normalized.charCodeAt(1) + 127397
  );
}

function countryNameFromIso2(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return null;
  }
  try {
    const display = new Intl.DisplayNames(["en"], { type: "region" }).of(normalized);
    return typeof display === "string" && display.trim().length > 0 ? display : null;
  } catch {
    return null;
  }
}

function parseLocationLabel(label: string): {
  countryCandidate: string | null;
  cityCandidate: string | null;
  regionCandidate: string | null;
} {
  const parts = label
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return {
      countryCandidate: null,
      cityCandidate: null,
      regionCandidate: null
    };
  }
  return {
    countryCandidate: parts[parts.length - 1] ?? null,
    cityCandidate: parts.length >= 2 ? parts[0] ?? null : null,
    regionCandidate: parts.length >= 3 ? parts[1] ?? null : null
  };
}

function isLikelyPlaceName(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    return false;
  }
  if (/\d/.test(trimmed)) {
    return false;
  }
  return /^[\p{L}\p{M} .'\-()]+$/u.test(trimmed);
}

function isLikelyCityName(value: string | null): boolean {
  if (!isLikelyPlaceName(value)) {
    return false;
  }
  const normalized = value!.toLowerCase();
  if (/\b(state|province|region|county|district|territory)\b/.test(normalized)) {
    return false;
  }
  return true;
}

function wikipediaUrlForLocation(post: FeedPost): string | null {
  if (post.countryCode === "ANON") {
    return null;
  }
  const parsed = parseLocationLabel(post.countryName);
  const country =
    countryNameFromIso2(post.countryCode) ??
    parsed.countryCandidate ??
    post.countryName.trim() ??
    "";

  if (!isLikelyPlaceName(country)) {
    return null;
  }

  const city = isLikelyCityName(parsed.cityCandidate) ? parsed.cityCandidate : null;
  const region = isLikelyPlaceName(parsed.regionCandidate) ? parsed.regionCandidate : null;

  if (city) {
    const cityQuery = [city, region, country].filter((part) => part && part.length > 0).join(", ");
    return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(cityQuery)}&go=Go`;
  }

  return `https://en.wikipedia.org/wiki/${encodeURIComponent(country.replace(/\s+/g, "_"))}`;
}

function displayLocationText(post: FeedPost): string {
  if (post.countryCode === "ANON") {
    return post.countryName;
  }
  const parsed = parseLocationLabel(post.countryName);
  const country = countryNameFromIso2(post.countryCode) ?? parsed.countryCandidate ?? post.countryName;
  const city = isLikelyCityName(parsed.cityCandidate) ? parsed.cityCandidate : null;
  if (city) {
    return `${city}, ${country}`;
  }
  return country;
}

function autoResizeTextarea(textarea: HTMLTextAreaElement) {
  const priorHeight = textarea.offsetHeight;
  textarea.style.height = "auto";
  const nextHeight = Math.max(textarea.scrollHeight, priorHeight);
  textarea.style.height = `${nextHeight}px`;
}

function sanitizeDetectedUrl(rawUrl: string): string {
  return rawUrl.replace(/[),.!?;:]+$/g, "");
}

function hasRenderableHostname(parsed: URL): boolean {
  const host = parsed.hostname.trim().toLowerCase();
  if (!host || host.endsWith(".")) {
    return false;
  }
  if (!host.includes(".")) {
    return false;
  }
  const tld = host.split(".").at(-1) ?? "";
  return /^[a-z]{2,63}$/i.test(tld);
}

function extractFirstUrl(text: string): string | null {
  const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  for (const candidate of matches) {
    const sanitized = sanitizeDetectedUrl(candidate);
    try {
      const parsed = new URL(sanitized);
      if (hasRenderableHostname(parsed)) {
        return parsed.href;
      }
    } catch {
      // Continue scanning for the next URL candidate.
    }
  }
  return null;
}

function removeUrlsFromCaption(text: string): string {
  const withoutUrls = text.replace(/https?:\/\/[^\s<>"'`]+/gi, "");
  return normalizeCaptionForDisplay(withoutUrls);
}

function normalizeCaptionForDisplay(value: string): string {
  return value
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\u00A0\u2007\u202F]*\n[ \t\u00A0\u2007\u202F]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t\u00A0\u2007\u202F]{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .trim();
}

function youtubeVideoIdFromUrl(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
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

function xPostIdFromUrl(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }
  if (parts[1] !== "status") {
    return null;
  }
  const postId = parts[2] ?? "";
  return /^\d+$/.test(postId) ? postId : null;
}

function tiktokVideoIdFromUrl(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!host.endsWith("tiktok.com")) {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const videoIndex = parts.indexOf("video");
  if (videoIndex === -1 || videoIndex + 1 >= parts.length) {
    return null;
  }
  const id = parts[videoIndex + 1] ?? "";
  return /^\d+$/.test(id) ? id : null;
}

function instagramMediaFromUrl(url: URL): { kind: "reel" | "p" | "tv"; code: string } | null {
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (!host.endsWith("instagram.com")) {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const kind = parts[0];
  const code = parts[1] ?? "";
  if ((kind === "reel" || kind === "p" || kind === "tv") && code.length > 3) {
    return { kind, code };
  }
  return null;
}

function titleFromUrlPath(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  const host = url.hostname.replace(/^www\./, "");
  if (!path || path === "/") {
    return `Article on ${host}`;
  }
  try {
    const segments = decodeURIComponent(path)
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    const rawSegment = segments[segments.length - 1] ?? "";
    const cleanedSegment = rawSegment
      .replace(/\.(html?|php|asp|aspx|jsp|json|xml|rss)$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (cleanedSegment.length < 4 || /^https?:\/\//i.test(cleanedSegment)) {
      return `Article on ${host}`;
    }
    const candidate =
      cleanedSegment.length > 72 ? `${cleanedSegment.slice(0, 69).trim()}...` : cleanedSegment;
    return candidate;
  } catch {
    return `Article on ${host}`;
  }
}

function fallbackPreviewImage(urlText: string): string {
  return `https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(urlText)}`;
}

function defaultPreviewSubtitle(url: URL): string {
  const host = url.hostname.replace(/^www\./i, "");
  return `Open on ${host}`;
}

function isLowInformationPreviewText(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim();
  if (normalized.length < 8) {
    return true;
  }
  if (/^https?:\/\//i.test(normalized)) {
    return true;
  }
  if (/^\/[^ ]+/.test(normalized)) {
    return true;
  }
  if (/\.(html?|xml|rss|php|aspx?|json)$/i.test(normalized)) {
    return true;
  }
  if (!/\s/.test(normalized) && normalized.length > 24) {
    return true;
  }
  if (!/[a-z]/i.test(normalized)) {
    return true;
  }
  return false;
}

function displayUrlFromHref(href: string): string {
  try {
    const parsed = new URL(href);
    const host = parsed.hostname.replace(/^www\./i, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const preview = `${host}${path}`.replace(/\/{2,}/g, "/");
    if (preview.length <= 90) {
      return preview;
    }
    return `${preview.slice(0, 87)}...`;
  } catch {
    return href;
  }
}

async function fetchLinkPreviewMetadata(url: string): Promise<LinkPreviewMetadata | null> {
  const cached = linkPreviewMetadataCache.get(url);
  if (cached) {
    return cached;
  }

  const promise = (async () => {
    const response = await fetch(`${API_BASE_URL}/v1/links/preview?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json().catch(() => null)) as LinkPreviewMetadataResponse | null;
    const preview = payload?.preview;
    if (!payload?.ok || !preview || typeof preview !== "object") {
      return null;
    }
    if (
      typeof preview.canonicalUrl !== "string" ||
      typeof preview.domain !== "string" ||
      typeof preview.title !== "string" ||
      typeof preview.description !== "string"
    ) {
      return null;
    }
    return {
      canonicalUrl: preview.canonicalUrl,
      domain: preview.domain,
      title: preview.title,
      description: preview.description,
      imageUrl: typeof preview.imageUrl === "string" ? preview.imageUrl : null,
      faviconUrl: typeof preview.faviconUrl === "string" ? preview.faviconUrl : null,
      siteName: typeof preview.siteName === "string" ? preview.siteName : undefined,
      authorName: typeof preview.authorName === "string" ? preview.authorName : undefined
    };
  })().catch(() => null);

  linkPreviewMetadataCache.set(url, promise);
  return promise;
}

async function hydratePostLinkPreview(basePreview: PostLinkPreview): Promise<PostLinkPreview> {
  const metadata = await fetchLinkPreviewMetadata(basePreview.href);
  if (!metadata) {
    return {
      ...basePreview,
      imageUrl: basePreview.imageUrl ?? fallbackPreviewImage(basePreview.href)
    };
  }
  return {
    ...basePreview,
    href: metadata.canonicalUrl || basePreview.href,
    domain: metadata.domain || basePreview.domain,
    title: !isLowInformationPreviewText(metadata.title) ? metadata.title : basePreview.title,
    subtitle: !isLowInformationPreviewText(metadata.description) ? metadata.description : basePreview.subtitle,
    imageUrl: metadata.imageUrl ?? basePreview.imageUrl ?? metadata.faviconUrl ?? fallbackPreviewImage(basePreview.href),
    faviconUrl: metadata.faviconUrl ?? basePreview.faviconUrl,
    siteName: metadata.siteName ?? basePreview.siteName,
    authorName: metadata.authorName ?? basePreview.authorName
  };
}

function buildPostLinkPreview(urlText: string): PostLinkPreview | null {
  try {
    const parsed = new URL(urlText);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const domain = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const youtubeId = youtubeVideoIdFromUrl(parsed);
    if (youtubeId) {
      return {
        href: parsed.href,
        domain: "youtube.com",
        title: "YouTube video",
        subtitle: "Watch on YouTube",
        imageUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
        faviconUrl: fallbackPreviewImage(parsed.href),
        siteName: "YouTube",
        embedUrl: `https://www.youtube.com/embed/${youtubeId}`,
        embedKind: "youtube"
      };
    }

    const xPostId = xPostIdFromUrl(parsed);
    if (xPostId) {
      const canonicalUrl = `https://x.com${parsed.pathname}`;
      return {
        href: parsed.href,
        domain: "x.com",
        title: "X post",
        subtitle: displayUrlFromHref(parsed.href),
        imageUrl: fallbackPreviewImage(parsed.href),
        faviconUrl: fallbackPreviewImage(parsed.href),
        embedUrl: `https://twitframe.com/show?url=${encodeURIComponent(canonicalUrl)}`,
        embedKind: "x"
      };
    }

    const tiktokVideoId = tiktokVideoIdFromUrl(parsed);
    if (tiktokVideoId) {
      return {
        href: parsed.href,
        domain: "tiktok.com",
        title: "TikTok video",
        subtitle: displayUrlFromHref(parsed.href),
        imageUrl: fallbackPreviewImage(parsed.href),
        faviconUrl: fallbackPreviewImage(parsed.href),
        embedUrl: `https://www.tiktok.com/embed/v2/${tiktokVideoId}`,
        embedKind: "tiktok"
      };
    }

    const instagramMedia = instagramMediaFromUrl(parsed);
    if (instagramMedia) {
      return {
        href: parsed.href,
        domain: "instagram.com",
        title: "Instagram post",
        subtitle: displayUrlFromHref(parsed.href),
        imageUrl: fallbackPreviewImage(parsed.href),
        faviconUrl: fallbackPreviewImage(parsed.href),
        embedUrl: `https://www.instagram.com/${instagramMedia.kind}/${instagramMedia.code}/embed/`,
        embedKind: "instagram"
      };
    }

    return {
      href: parsed.href,
      domain,
      title: titleFromUrlPath(parsed),
      subtitle: defaultPreviewSubtitle(parsed),
      imageUrl: fallbackPreviewImage(parsed.href),
      faviconUrl: fallbackPreviewImage(parsed.href)
    };
  } catch {
    return null;
  }
}

export function FeedCard({
  post,
  nativeLanguage,
  isSaved,
  onToggleSave,
  onOpenPost,
  forceCommentsOpen = false,
  disableHeaderOpen = false,
  isFullscreen = false,
  isSignedIn,
  onSignInWithPasskey,
  onCreatePasskeyOnDevice,
  passkeySignInEnabled,
  viewerHandle,
  onOpenAuthorProfile,
  reactionState,
  isReposted,
  extraComments,
  onReactionChange,
  onToggleRepost,
  onCommentCountIncrement
}: FeedCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [languageMode, setLanguageMode] = useState<PostLanguageMode>("native");
  const [activeLeftAction, setActiveLeftAction] = useState<LeftActionState>(forceCommentsOpen ? "comments" : null);
  const [commentInput, setCommentInput] = useState("");
  const [commentAuthModalMessage, setCommentAuthModalMessage] = useState<string | null>(null);
  const [authModalTab, setAuthModalTab] = useState<"signin" | "signup">("signin");
  const [signInBusyProvider, setSignInBusyProvider] = useState<"passkey" | null>(null);
  const [threadComments, setThreadComments] = useState<ThreadComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadedPostId, setCommentsLoadedPostId] = useState<string | null>(null);
  const [commentsLoadError, setCommentsLoadError] = useState<string | null>(null);
  const [repliesOpenByComment, setRepliesOpenByComment] = useState<Record<string, boolean>>({});
  const [replyComposerOpenByComment, setReplyComposerOpenByComment] = useState<Record<string, boolean>>({});
  const [replyDraftByComment, setReplyDraftByComment] = useState<Record<string, string>>({});
  const [shareStatusMessage, setShareStatusMessage] = useState<string | null>(null);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const replyInputRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const commentsOpen = activeLeftAction === "comments";
  const reposted = isReposted;
  const commentCount =
    commentsLoadedPostId === post.id ? threadComments.length : Math.max(0, post.comments + extraComments);
  const repostCount = post.reposts + (reposted ? 1 : 0);
  const upvoteCount = post.upvotes + (reactionState === "up" ? 1 : 0);
  const neutralCount = post.neutralVotes + (reactionState === "neutral" ? 1 : 0);
  const downvoteCount = post.downvotes + (reactionState === "down" ? 1 : 0);
  const approvalPercent = approvalPercentFromVotes(upvoteCount, neutralCount, downvoteCount);
  const wikipediaLocationUrl = wikipediaUrlForLocation(post);
  const locationDisplayText = displayLocationText(post);
  const isAnonymousPost = post.isAnonymous === true;
  const visibleAuthor = isAnonymousPost ? "Anonymous" : post.author;
  const visibleHandle = isAnonymousPost ? "@anonymous" : post.handle;
  const canOpenAuthorProfile = !isAnonymousPost;
  const translatedCaption = post.translatedCaptions?.[nativeLanguage];
  const originalMatchesNative =
    nativeLanguage.trim().toLowerCase() === post.originalLanguage.trim().toLowerCase();
  const translatedMatchesOriginal =
    translatedCaption?.trim().toLowerCase() === post.caption.trim().toLowerCase();
  const hasTranslationForNative = Boolean(
    translatedCaption && !translatedMatchesOriginal && !originalMatchesNative
  );
  const effectiveLanguageMode: PostLanguageMode = hasTranslationForNative ? languageMode : "original";
  const displayCaption = normalizeCaptionForDisplay(
    effectiveLanguageMode === "native" ? translatedCaption ?? post.caption : post.caption
  );
  const previewUrl = extractFirstUrl(displayCaption) ?? extractFirstUrl(post.caption);
  const baseLinkPreview = useMemo(() => (previewUrl ? buildPostLinkPreview(previewUrl) : null), [previewUrl]);
  const [linkPreview, setLinkPreview] = useState<PostLinkPreview | null>(baseLinkPreview);
  const visibleCaption = normalizeCaptionForDisplay(
    linkPreview ? removeUrlsFromCaption(displayCaption) : displayCaption
  );
  const linkPreviewUrlLabel = linkPreview ? displayUrlFromHref(linkPreview.href) : "";
  const postDeepLinkPath = `/?postId=${encodeURIComponent(post.id)}#post-${post.id}`;
  const shareUrl =
    typeof window === "undefined"
      ? postDeepLinkPath
      : new URL(postDeepLinkPath, window.location.origin).toString();

  useEffect(() => {
    setLinkPreview(baseLinkPreview);
  }, [baseLinkPreview?.href]);

  useEffect(() => {
    if (forceCommentsOpen) {
      setActiveLeftAction("comments");
    }
  }, [forceCommentsOpen]);

  useEffect(() => {
    if (!baseLinkPreview) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const hydrated = await hydratePostLinkPreview(baseLinkPreview);
      if (!cancelled) {
        setLinkPreview(hydrated);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [baseLinkPreview?.href]);

  useEffect(() => {
    if (!commentAuthModalMessage) {
      return;
    }
    setAuthModalTab("signin");

    function closeWhenCardLeavesViewport() {
      const card = cardRef.current;
      if (!card) {
        setCommentAuthModalMessage(null);
        return;
      }
      const rect = card.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const isVisible = rect.bottom > 0 && rect.top < viewportHeight;
      if (!isVisible) {
        setCommentAuthModalMessage(null);
      }
    }

    closeWhenCardLeavesViewport();
    window.addEventListener("scroll", closeWhenCardLeavesViewport, { passive: true });
    window.addEventListener("resize", closeWhenCardLeavesViewport);
    return () => {
      window.removeEventListener("scroll", closeWhenCardLeavesViewport);
      window.removeEventListener("resize", closeWhenCardLeavesViewport);
    };
  }, [commentAuthModalMessage]);

  async function handleModalPasskeySignIn() {
    if (signInBusyProvider || !passkeySignInEnabled) {
      return;
    }
    setSignInBusyProvider("passkey");
    const success = await onSignInWithPasskey();
    setSignInBusyProvider(null);
    if (success) {
      setCommentAuthModalMessage(null);
    }
  }

  async function handleModalCreatePasskeyOnDevice() {
    if (signInBusyProvider || !passkeySignInEnabled) {
      return;
    }
    setSignInBusyProvider("passkey");
    const success = await onCreatePasskeyOnDevice();
    setSignInBusyProvider(null);
    if (success) {
      setCommentAuthModalMessage(null);
    }
  }

  useEffect(() => {
    if (commentInputRef.current) {
      autoResizeTextarea(commentInputRef.current);
    }
  }, [commentInput]);

  useEffect(() => {
    setThreadComments([]);
    setCommentsLoadedPostId(null);
    setCommentsLoadError(null);
    setRepliesOpenByComment({});
    setReplyComposerOpenByComment({});
    setReplyDraftByComment({});
  }, [post.id]);

  useEffect(() => {
    const entries = Object.entries(replyInputRefs.current);
    for (const [commentId, textarea] of entries) {
      if (!textarea) {
        continue;
      }
      if (!replyComposerOpenByComment[commentId]) {
        continue;
      }
      autoResizeTextarea(textarea);
    }
  }, [replyDraftByComment, replyComposerOpenByComment]);

  useEffect(() => {
    if (!commentsOpen) {
      return;
    }
    if (commentsLoadedPostId === post.id) {
      return;
    }
    let cancelled = false;
    setCommentsLoading(true);
    setCommentsLoadError(null);
    void (async () => {
      try {
        const comments = await fetchPostCommentsFromLedger(post.id, isSignedIn ? viewerHandle : undefined);
        if (cancelled) {
          return;
        }
        setThreadComments(comments);
        setCommentsLoadedPostId(post.id);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Unable to load comments.";
        setCommentsLoadError(message);
      } finally {
        if (!cancelled) {
          setCommentsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commentsOpen, commentsLoadedPostId, isSignedIn, post.id, viewerHandle]);

  useEffect(() => {
    if (!shareStatusMessage) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShareStatusMessage(null);
    }, 2200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [shareStatusMessage]);

  function viewerDisplayName(): string {
    const fallback = viewerHandle.replace(/^@+/, "").trim();
    return fallback ? fallback : "You";
  }

  async function ensurePostLedgerRecord() {
    const response = await fetch(`${API_BASE_URL}/v1/ledger/posts`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: post.id,
        author: post.author,
        handle: post.handle,
        isAnonymous: post.isAnonymous === true,
        anonymousKey: post.anonymousKey,
        caption: post.caption,
        createdAtMs: post.createdAtMs,
        countryCode: post.countryCode,
        countryName: post.countryName,
        mediaType: post.mediaType,
        mediaUrl: post.videoUrl ?? post.posterUrl,
        upvotes: post.upvotes,
        neutralVotes: post.neutralVotes,
        downvotes: post.downvotes,
        comments: threadComments.length
      })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(payload?.message ?? "Unable to sync post record.");
    }
  }

  async function createLedgerComment(text: string): Promise<ThreadComment> {
    await ensurePostLedgerRecord();
    const response = await fetch(`${API_BASE_URL}/v1/ledger/posts/${encodeURIComponent(post.id)}/comments`, {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text
      })
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          comment?: LedgerCommentRecord;
          message?: string;
        }
      | null;
    if (!response.ok || !payload?.comment) {
      throw new Error(payload?.message ?? "Unable to add comment.");
    }
    return mapLedgerComment(payload.comment);
  }

  async function createLedgerReply(commentId: string, text: string): Promise<ThreadReply> {
    const response = await fetch(
      `${API_BASE_URL}/v1/ledger/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}/replies`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          text
        })
      }
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          reply?: LedgerReplyRecord;
          message?: string;
        }
      | null;
    if (!response.ok || !payload?.reply) {
      throw new Error(payload?.message ?? "Unable to add reply.");
    }
    return mapLedgerReply(payload.reply);
  }

  async function setLedgerCommentReaction(
    commentId: string,
    reaction: "up" | "down" | "none"
  ): Promise<ThreadComment> {
    const response = await fetch(
      `${API_BASE_URL}/v1/ledger/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}/reaction`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          reaction
        })
      }
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          comment?: LedgerCommentRecord;
          message?: string;
        }
      | null;
    if (!response.ok || !payload?.comment) {
      throw new Error(payload?.message ?? "Unable to update comment reaction.");
    }
    return mapLedgerComment(payload.comment);
  }

  async function setLedgerReplyReaction(
    commentId: string,
    replyId: string,
    reaction: "up" | "down" | "none"
  ): Promise<ThreadReply> {
    const response = await fetch(
      `${API_BASE_URL}/v1/ledger/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}/replies/${encodeURIComponent(replyId)}/reaction`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          reaction
        })
      }
    );
    const payload = (await response.json().catch(() => null)) as
      | {
          reply?: LedgerReplyRecord;
          message?: string;
        }
      | null;
    if (!response.ok || !payload?.reply) {
      throw new Error(payload?.message ?? "Unable to update reply reaction.");
    }
    return mapLedgerReply(payload.reply);
  }

  async function submitComment() {
    if (!isSignedIn) {
      setCommentAuthModalMessage(SIGN_IN_REQUIRED_COMMENT_MESSAGE);
      return;
    }

    const trimmed = commentInput.trim();
    if (!trimmed) {
      return;
    }
    try {
      const created = await createLedgerComment(trimmed);
      setThreadComments((prev) => [created, ...prev.filter((comment) => comment.id !== created.id)]);
      setCommentsLoadedPostId(post.id);
      onCommentCountIncrement(post.id);
      setCommentInput("");
      setCommentsLoadError(null);
      setCommentAuthModalMessage(null);
      setActiveLeftAction("comments");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add comment.";
      setCommentsLoadError(message);
    }
  }

  function toggleLeftAction(next: Exclude<LeftActionState, null>) {
    setActiveLeftAction((current) => (current === next ? null : next));
  }

  function openShareablePostLink() {
    if (typeof window === "undefined") {
      return;
    }
    if (onOpenPost) {
      onOpenPost(post.id);
      return;
    }
    window.sessionStorage.setItem(SCROLL_TARGET_POST_KEY, post.id);
    window.history.replaceState({ postId: post.id }, "", postDeepLinkPath);
  }

  async function sharePostLink() {
    try {
      const nav = typeof navigator !== "undefined" ? navigator : null;
      if (nav && typeof nav.share === "function") {
        await nav.share({
          title: "Pawmaq post",
          text: "Check out this post on pawmaq.com",
          url: shareUrl
        });
        setShareStatusMessage("Post shared.");
        return;
      }
      if (nav?.clipboard && typeof nav.clipboard.writeText === "function") {
        await nav.clipboard.writeText(shareUrl);
        setShareStatusMessage("Post link copied.");
        return;
      }
      setShareStatusMessage("Copy the link from the opened post.");
    } catch {
      setShareStatusMessage("Share canceled.");
    }
  }

  function toggleReaction(next: Exclude<ReactionState, null>) {
    if (!isSignedIn) {
      setCommentAuthModalMessage(SIGN_IN_REQUIRED_VOTE_MESSAGE);
      return;
    }
    onReactionChange(post.id, reactionState === next ? null : next);
  }

  async function toggleCommentReaction(commentId: string, next: CommentReaction) {
    if (!isSignedIn) {
      setCommentAuthModalMessage(SIGN_IN_REQUIRED_COMMENT_REACTION_MESSAGE);
      return;
    }
    const current = threadComments.find((comment) => comment.id === commentId)?.reaction ?? null;
    const target = current === next ? "none" : (next ?? "none");
    try {
      const updated = await setLedgerCommentReaction(commentId, target);
      setThreadComments((prev) => prev.map((comment) => (comment.id === commentId ? updated : comment)));
      setCommentsLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update comment reaction.";
      setCommentsLoadError(message);
    }
  }

  function toggleReplies(commentId: string) {
    setRepliesOpenByComment((prev) => ({
      ...prev,
      [commentId]: !prev[commentId]
    }));
  }

  function replyEffectiveLikes(reply: ThreadReply): number {
    return reply.likes;
  }

  async function toggleReplyReaction(commentId: string, replyId: string, next: CommentReaction) {
    if (!isSignedIn) {
      setCommentAuthModalMessage(SIGN_IN_REQUIRED_COMMENT_REACTION_MESSAGE);
      return;
    }
    const current =
      threadComments.find((comment) => comment.id === commentId)?.replies.find((reply) => reply.id === replyId)
        ?.reaction ?? null;
    const target = current === next ? "none" : (next ?? "none");
    try {
      const updated = await setLedgerReplyReaction(commentId, replyId, target);
      setThreadComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                replies: comment.replies.map((reply) => (reply.id === replyId ? updated : reply))
              }
            : comment
        )
      );
      setCommentsLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update reply reaction.";
      setCommentsLoadError(message);
    }
  }

  function toggleReplyComposer(commentId: string) {
    setReplyComposerOpenByComment((prev) => ({
      ...prev,
      [commentId]: !prev[commentId]
    }));
  }

  async function submitReply(commentId: string) {
    if (!isSignedIn) {
      setCommentAuthModalMessage(SIGN_IN_REQUIRED_COMMENT_MESSAGE);
      return;
    }

    const draft = replyDraftByComment[commentId] ?? "";
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    try {
      const createdReply = await createLedgerReply(commentId, trimmed);
      setThreadComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId
            ? {
                ...comment,
                replies: [createdReply, ...comment.replies.filter((reply) => reply.id !== createdReply.id)]
              }
            : comment
        )
      );
      setReplyDraftByComment((prev) => ({
        ...prev,
        [commentId]: ""
      }));
      setRepliesOpenByComment((prev) => ({
        ...prev,
        [commentId]: true
      }));
      setReplyComposerOpenByComment((prev) => ({
        ...prev,
        [commentId]: false
      }));
      setCommentAuthModalMessage(null);
      setCommentsLoadError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add reply.";
      setCommentsLoadError(message);
    }
  }

  return (
    <article
      id={`post-${post.id}`}
      ref={cardRef}
      className={`panel feed-card ${isFullscreen ? "feed-card--fullscreen" : "reveal"}`}
    >
      <header
        className={disableHeaderOpen ? "feed-card__header" : "feed-card__header feed-card__header--shareable"}
        role={disableHeaderOpen ? undefined : "link"}
        tabIndex={disableHeaderOpen ? undefined : 0}
        aria-label={disableHeaderOpen ? undefined : "Open shareable post link"}
        onClick={disableHeaderOpen ? undefined : openShareablePostLink}
        onKeyDown={
          disableHeaderOpen
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openShareablePostLink();
                }
              }
        }
      >
        <div className="feed-card__author">
          {canOpenAuthorProfile ? (
            <button
              type="button"
              className="feed-card__author-link"
              onClick={(event) => {
                event.stopPropagation();
                onOpenAuthorProfile(post.author, post.handle);
              }}
              aria-label={`Open profile for ${post.author}`}
            >
              <p className="feed-card__author-line">
                <span className="feed-card__author-name">{visibleAuthor}</span>
                <span className="feed-card__meta">
                  {visibleHandle} • {post.createdAt}
                </span>
              </p>
            </button>
          ) : (
            <p className="feed-card__author-line">
              <span className="feed-card__author-name">{visibleAuthor}</span>
              <span className="feed-card__meta">
                {visibleHandle} • {post.createdAt}
              </span>
            </p>
          )}
        </div>
        <div className="feed-card__meta-actions">
          <button
            type="button"
            className={shareStatusMessage ? "share-post-button is-shared" : "share-post-button"}
            onClick={(event) => {
              event.stopPropagation();
              void sharePostLink();
            }}
            aria-label="Share post"
            title="Share post"
          >
            <ShareIcon />
          </button>
          <button
            type="button"
            className={isSaved ? "save-post-button is-saved" : "save-post-button"}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSave(post.id);
            }}
            aria-label={isSaved ? "Unsave post" : "Save post"}
            title={isSaved ? "Unsave" : "Save"}
          >
            <SaveIcon />
          </button>
        </div>
      </header>
      {shareStatusMessage ? <p className="feed-card__share-status">{shareStatusMessage}</p> : null}
      {visibleCaption ? <p className="feed-card__caption">{visibleCaption}</p> : null}
      {linkPreview?.embedUrl ? (
        <div
          className={
            linkPreview.embedKind === "instagram" || linkPreview.embedKind === "tiktok"
              ? "feed-card__link-embed feed-card__link-embed--vertical"
              : "feed-card__link-embed"
          }
        >
          <iframe
            src={linkPreview.embedUrl}
            title={`${linkPreview.title} embed`}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}
      {linkPreview ? (
        <a
          className={
            linkPreview.embedKind === "youtube"
              ? "feed-card__link-preview feed-card__link-preview--youtube"
              : "feed-card__link-preview"
          }
          href={linkPreview.href}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open link preview for ${linkPreview.domain}`}
        >
          <div className="feed-card__link-preview-media">
            <img
              src={linkPreview.imageUrl ?? fallbackPreviewImage(linkPreview.href)}
              alt={linkPreview.title}
              loading="lazy"
            />
          </div>
          <div className="feed-card__link-preview-body">
            <div className="feed-card__link-preview-meta">
              {linkPreview.faviconUrl ? (
                <img
                  className="feed-card__link-preview-favicon"
                  src={linkPreview.faviconUrl}
                  alt=""
                  loading="lazy"
                  aria-hidden="true"
                />
              ) : null}
              <span className="feed-card__link-preview-domain">{linkPreview.siteName ?? linkPreview.domain}</span>
            </div>
            <strong className="feed-card__link-preview-title">{linkPreview.title}</strong>
            <span className="feed-card__link-preview-description">
              {linkPreview.embedKind === "youtube" && linkPreview.authorName
                ? `Channel: ${linkPreview.authorName}`
                : linkPreview.subtitle}
            </span>
            <span className="feed-card__link-preview-url">{linkPreviewUrlLabel}</span>
          </div>
        </a>
      ) : null}
      {hasTranslationForNative ? (
        <div className="feed-card__pre-media-controls">
          <div className="post-language-inline">
            <div className="post-language-slider" role="group" aria-label="Post language mode">
              <button
                type="button"
                className={
                  effectiveLanguageMode === "native"
                    ? "post-language-slider__option is-active"
                    : "post-language-slider__option"
                }
                onClick={() => setLanguageMode("native")}
                title={`Translate to ${nativeLanguage}`}
              >
                {nativeLanguage}
              </button>
              <button
                type="button"
                className={
                  effectiveLanguageMode === "original"
                    ? "post-language-slider__option is-active"
                    : "post-language-slider__option"
                }
                onClick={() => setLanguageMode("original")}
                title="Show original"
              >
                Original
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {post.videoUrl || post.posterUrl ? (
        <div className="feed-card__media">
          {post.videoUrl && (post.mediaType === "gif" || post.mediaType === "png") ? (
            <img src={post.videoUrl} alt={post.caption} loading="lazy" />
          ) : post.videoUrl ? (
            <video src={post.videoUrl} controls playsInline />
          ) : (
            <img src={post.posterUrl} alt={post.caption} loading="lazy" />
          )}
        </div>
      ) : null}

      <nav className="feed-card__actions" aria-label="Post actions">
        <div className="feed-actions__left">
          <button
            className={`action-stat action-stat--button ${commentsOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleLeftAction("comments")}
            aria-label="Open comments"
          >
            <span className="action-stat__icon">
              <ReplyIcon />
            </span>
            <strong>{formatCompact(commentCount)}</strong>
          </button>
          <button
            className={`action-stat action-stat--button ${reposted ? "is-active" : ""}`}
            type="button"
            onClick={() => onToggleRepost(post.id)}
            aria-label="Toggle repost"
          >
            <span className="action-stat__icon">
              <RepostIcon />
            </span>
            <strong>{formatCompact(repostCount)}</strong>
          </button>
          <div className="action-stat action-stat--static action-stat--quiet" aria-label="Views count">
            <span className="action-stat__icon">
              <ViewsIcon />
            </span>
            <strong>{formatCompact(post.views)}</strong>
          </div>
        </div>

        <div className="reaction-group">
          <button
            className={`reaction-button reaction-button--up ${reactionState === "up" ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleReaction("up")}
            aria-label="Up"
          >
            <span className="reaction-button__icon">▲</span>
            <span className="reaction-button__label">Up</span>
            <span className="reaction-button__count">{formatLikeCompact(upvoteCount)}</span>
          </button>
          <button
            className={`reaction-button reaction-button--neutral ${reactionState === "neutral" ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleReaction("neutral")}
            aria-label="Neutral"
          >
            <span className="reaction-button__icon">•</span>
            <span className="reaction-button__label">Neutral</span>
            <span className="reaction-button__count">{formatLikeCompact(neutralCount)}</span>
          </button>
          <button
            className={`reaction-button reaction-button--down ${reactionState === "down" ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleReaction("down")}
            aria-label="Down"
          >
            <span className="reaction-button__icon">▼</span>
            <span className="reaction-button__label">Down</span>
            <span className="reaction-button__count">{formatLikeCompact(downvoteCount)}</span>
          </button>
        </div>
      </nav>

      {commentsOpen ? (
        <section className="comment-sheet">
          <header className="comment-sheet__header">
            <h4>{formatCompact(commentCount)} Comments</h4>
          </header>
          <div className="yt-compose">
            <div className="yt-avatar yt-avatar--self">{initialsFromName(viewerDisplayName())}</div>
            <div className="yt-compose__main">
              <textarea
                ref={commentInputRef}
                className="yt-compose__input"
                placeholder="Add a comment..."
                value={commentInput}
                onChange={(event) => {
                  autoResizeTextarea(event.target);
                  setCommentInput(event.target.value);
                }}
                rows={1}
              />
              <div className="yt-compose__actions">
                <button
                  type="button"
                  className="yt-button-secondary yt-button-icon"
                  onClick={() => {
                    setCommentInput("");
                    if (commentInputRef.current) {
                      commentInputRef.current.style.height = "";
                    }
                  }}
                  aria-label="Clear comment draft"
                  title="Clear comment"
                >
                  <TrashIcon />
                </button>
                <button type="button" className="yt-button-primary" onClick={() => void submitComment()}>
                  Comment
                </button>
              </div>
            </div>
          </div>
          <div className="yt-comment-list">
            {commentsLoading ? (
              <p className="comment-empty">Loading comments...</p>
            ) : commentsLoadError ? (
              <p className="comment-empty">{commentsLoadError}</p>
            ) : threadComments.length === 0 ? (
              <p className="comment-empty">No comments yet.</p>
            ) : (
              threadComments.map((comment) => (
                <article key={comment.id} className="yt-comment">
                  <div className="yt-avatar">{initialsFromName(comment.author)}</div>
                  <div className="yt-comment__body">
                    <p className="yt-comment__meta">
                      <strong>{comment.author}</strong> {comment.handle} • {comment.age}
                    </p>
                    <p className="yt-comment__text">{comment.text}</p>
                    <div className="yt-comment__actions">
                      <button
                        className={`yt-comment-action ${comment.reaction === "up" ? "is-active" : ""}`}
                        type="button"
                        onClick={() => void toggleCommentReaction(comment.id, "up")}
                      >
                        <ThumbUpIcon />
                        <span>{formatCompact(comment.likes)}</span>
                      </button>
                      <button
                        className={`yt-comment-action ${comment.reaction === "down" ? "is-active" : ""}`}
                        type="button"
                        onClick={() => void toggleCommentReaction(comment.id, "down")}
                      >
                        <ThumbDownIcon />
                        <span>{formatCompact(comment.dislikes)}</span>
                      </button>
                      <button
                        className="yt-comment-action yt-comment-action--text"
                        type="button"
                        onClick={() => toggleReplyComposer(comment.id)}
                      >
                        Reply
                      </button>
                    </div>
                    {replyComposerOpenByComment[comment.id] ? (
                      <div className="yt-reply-compose">
                        <textarea
                          className="yt-reply-compose__input"
                          ref={(node) => {
                            replyInputRefs.current[comment.id] = node;
                          }}
                          placeholder="Write a reply..."
                          value={replyDraftByComment[comment.id] ?? ""}
                          onChange={(event) =>
                            {
                              autoResizeTextarea(event.target);
                              setReplyDraftByComment((prev) => ({
                                ...prev,
                                [comment.id]: event.target.value
                              }));
                            }
                          }
                          rows={1}
                        />
                        <button type="button" onClick={() => void submitReply(comment.id)}>
                          Reply
                        </button>
                      </div>
                    ) : null}
                    {comment.replies.length > 0 ? (
                      <>
                        <button className="yt-replies-toggle" type="button" onClick={() => toggleReplies(comment.id)}>
                          {repliesOpenByComment[comment.id] ? "Hide" : "View"} {comment.replies.length} replies
                        </button>
                        {repliesOpenByComment[comment.id] ? (
                          <div className="yt-replies">
                            {[...comment.replies]
                              .sort((a, b) => replyEffectiveLikes(b) - replyEffectiveLikes(a))
                              .map((reply) => (
                              <article key={reply.id} className="yt-reply">
                                <div className="yt-avatar yt-avatar--reply">{initialsFromName(reply.author)}</div>
                                <div className="yt-reply__body">
                                  <p className="yt-comment__meta">
                                    <strong>{reply.author}</strong> {reply.handle} • {reply.age}
                                  </p>
                                  <p className="yt-comment__text">{reply.text}</p>
                                  <div className="yt-reply__actions">
                                    <button
                                      className={`yt-comment-action ${reply.reaction === "up" ? "is-active" : ""}`}
                                      type="button"
                                      onClick={() => void toggleReplyReaction(comment.id, reply.id, "up")}
                                    >
                                      <ThumbUpIcon />
                                      <span>{formatCompact(reply.likes)}</span>
                                    </button>
                                    <button
                                      className={`yt-comment-action ${reply.reaction === "down" ? "is-active" : ""}`}
                                      type="button"
                                      onClick={() => void toggleReplyReaction(comment.id, reply.id, "down")}
                                    >
                                      <ThumbDownIcon />
                                      <span>{formatCompact(reply.dislikes)}</span>
                                    </button>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      {commentAuthModalMessage ? (
        <div
          className="auth-modal-backdrop"
          role="presentation"
          onClick={() => setCommentAuthModalMessage(null)}
        >
          <div
            className="auth-modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Sign in required"
            onClick={(event) => event.stopPropagation()}
          >
            <h4>Sign in required</h4>
            <p>{commentAuthModalMessage}</p>
            <div className="auth-modal__tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={authModalTab === "signin" ? "auth-modal__tab is-active" : "auth-modal__tab"}
                onClick={() => setAuthModalTab("signin")}
                role="tab"
                aria-selected={authModalTab === "signin"}
              >
                Sign in
              </button>
              <button
                type="button"
                className={authModalTab === "signup" ? "auth-modal__tab is-active" : "auth-modal__tab"}
                onClick={() => setAuthModalTab("signup")}
                role="tab"
                aria-selected={authModalTab === "signup"}
              >
                Sign up
              </button>
            </div>
            <p className="auth-modal__note">
              Phone QR sign-in is recommended from the top-right Guest/User menu. This modal supports on-device passkey sign-in.
            </p>
            <div className="auth-modal__actions">
              {authModalTab === "signin" ? (
                <button
                  type="button"
                  className="yt-button-secondary"
                  onClick={() => void handleModalPasskeySignIn()}
                  disabled={!passkeySignInEnabled || signInBusyProvider !== null}
                >
                  {signInBusyProvider === "passkey"
                    ? "Checking device..."
                    : passkeySignInEnabled
                      ? "Sign in on this device"
                      : "Passkey unavailable"}
                </button>
              ) : (
                <button
                  type="button"
                  className="yt-button-secondary"
                  onClick={() => void handleModalCreatePasskeyOnDevice()}
                  disabled={!passkeySignInEnabled || signInBusyProvider !== null}
                >
                  {signInBusyProvider === "passkey"
                    ? "Setting up..."
                    : passkeySignInEnabled
                      ? "Create passkey on this device"
                      : "Passkey unavailable"}
                </button>
              )}
              <button
                type="button"
                className="yt-button-primary"
                onClick={() => setCommentAuthModalMessage(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="feed-card__footer">
        {wikipediaLocationUrl ? (
          <a
            className="country-with-flag country-with-flag--link"
            href={wikipediaLocationUrl}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`Learn more about ${locationDisplayText} on Wikipedia`}
            title={`Learn more about ${locationDisplayText}`}
          >
            <span>{locationDisplayText}</span>
            <span aria-hidden="true">{countryFlagFromIso2(post.countryCode)}</span>
          </a>
        ) : (
          <span className="country-with-flag">
            <span>{locationDisplayText}</span>
            <span aria-hidden="true">{countryFlagFromIso2(post.countryCode)}</span>
          </span>
        )}
        <span className="controversy-indicator">{approvalPercent.toFixed(3)}% approval</span>
      </footer>
    </article>
  );
}
