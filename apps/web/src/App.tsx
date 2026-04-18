import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { AccountMenu } from "./components/AccountMenu";
import { FeedCard } from "./components/FeedCard";
import { ProfilePage } from "./components/ProfilePage";
import { RightRail } from "./components/RightRail";
import { SideNav } from "./components/SideNav";
import { ThemeToggle } from "./components/ThemeToggle";
import { VideoComposer } from "./components/VideoComposer";
import { WorldSupportMap } from "./components/WorldSupportMap";
import { API_BASE_URL } from "./config/api";
import { worldSupportData } from "./data/mockData";
import type { FeedPost, FeedTab, ThemeMode } from "./types";

const FOLLOWING_HANDLES = new Set<string>();
type TimeWindow = "10m" | "1h" | "12h" | "24h" | "1w" | "1m" | "3m" | "1y";
type FeedSortMode = "likes" | "approval";
type WorldFilterMode = "all" | "globe" | "random" | "anonymous";
type DotTone = "red" | "green" | "blue";

const TIME_WINDOW_MAX_HOURS: Record<TimeWindow, number> = {
  "10m": 10 / 60,
  "1h": 1,
  "12h": 12,
  "24h": 24,
  "1w": 24 * 7,
  "1m": 24 * 30,
  "3m": 24 * 90,
  "1y": 24 * 365
};

const TIME_WINDOW_CHOICES: Array<{ key: TimeWindow; label: string }> = [
  { key: "12h", label: "12 hrs" },
  { key: "24h", label: "24 hrs" },
  { key: "1w", label: "1 week" },
  { key: "1m", label: "1 month" },
  { key: "3m", label: "3 months" },
  { key: "1y", label: "1 year" }
];

const SEEN_POST_HASHES_KEY = "pawmaq-account-seen-post-hashes";
const POSTS_STORAGE_KEY = "pawmaq-feed-posts-v1";
const POST_INTERACTIONS_KEY = "pawmaq-post-interactions-v1";
const OWN_PROFILE_CACHE_KEY = "pawmaq-own-server-profile-v1";
const TIME_WINDOW_STORAGE_KEY = "pawmaq-feed-time-window";
const FEED_TAB_STORAGE_KEY = "pawmaq-feed-active-tab";
const SIGNED_IN_KEY = "pawmaq-account-signed-in";
const SIGNED_IN_PROFILE_KEY = "pawmaq-account-signed-in-profile";
const GUEST_DEVICE_VERIFIED_AT_KEY = "pawmaq-guest-device-verified-at";
const LAST_SELECTED_COUNTRY_KEY = "pawmaq-world-last-country-filter";
const FOLLOWED_HANDLES_KEY = "pawmaq-followed-handles";
const SCROLL_TARGET_POST_KEY = "pawmaq-scroll-target-post-id";
const PRIVATE_KEY_DB_NAME = "pawmaq-crypto-v1";
const PRIVATE_KEY_STORE_NAME = "keys";
const PRIVATE_KEY_RECORD_ID = "account-master-key";
const PRIVATE_CRYPTO_KDF = "PBKDF2-SHA256";
const PRIVATE_CRYPTO_KDF_ITERATIONS = 310_000;
const ANONYMOUS_COUNTRY_FILTER = "ANON";
const INITIAL_POOL_SIZE = 0;
const LOAD_BATCH_SIZE = 12;
const MAX_PERSISTED_POSTS = 400;
const GUEST_PASSKEY_REAUTH_INTERVAL_MS = 15 * 60 * 1000;

isoCountries.registerLocale(enLocale);

interface RandomAuthorProfile {
  author: string;
  handle: string;
  countryCode: string;
  countryName: string;
  originalLanguage: string;
}

interface StoredAuthProfile {
  provider: "passkey";
  name: string;
  email?: string;
}

interface ServerLedgerProfile {
  userId: string;
  provider: "google" | "passkey" | "bot";
  accountId?: string;
  linkedAuthProviders?: Array<"google" | "passkey" | "bot">;
  name: string;
  username: string;
  handle: string;
  bio: string;
  location: string;
  avatarUrl: string;
  bannerUrl: string;
  shareSocialGraph: boolean;
  followingHandles: string[];
  followerCount: number;
  followingCount: number;
  posts: string[];
  createdAt: string;
  updatedAt: string;
}

interface ProfileEditorDraft {
  name: string;
  username: string;
  handle: string;
  bio: string;
  location: string;
  avatarUrl: string;
  bannerUrl: string;
  shareSocialGraph: boolean;
}

interface PendingHandleChangeSave {
  draft: ProfileEditorDraft;
  previousHandle: string;
  previousName: string;
}

interface FollowingProfileSummary {
  handle: string;
  name: string;
  avatarUrl?: string;
}

interface AuthSessionResponse {
  ok: boolean;
  profile: ServerLedgerProfile;
  guest?: boolean;
}

interface PasskeyBeginResponse<TOptions> {
  challengeToken: string;
  options: TOptions;
}

interface HumanChallengeResponse {
  challengeId: string;
  nonce: string;
  purpose: "passkey_register" | "passkey_auth";
  algorithm: "sha256-leading-zero-bits";
  difficultyBits: number;
  expiresAtMs: string;
}

interface HumanProofPayload {
  challengeId: string;
  counter: number;
  digestHex: string;
}

interface DevicePairingStartResponse {
  ok: boolean;
  pairingId: string;
  approvalSecret: string;
  pollSecret: string;
  expiresAtMs: string;
  intent?: "sign_in" | "link";
}

interface DevicePairingStatusResponse {
  status: "pending" | "approved" | "consumed" | "expired";
  handoffToken?: string;
}

interface DevicePairingApprovalRequest {
  pairingId: string;
  approvalSecret: string;
}

type DevicePairingIntent = "sign_in" | "link";
type ProfileSaveMessageTone = "neutral" | "success" | "warning" | "error";

type PasskeyRegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type PasskeyRegistrationResponse = Awaited<ReturnType<typeof startRegistration>>;
type PasskeyAuthenticationOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];
type PasskeyAuthenticationResponse = Awaited<ReturnType<typeof startAuthentication>>;

interface LedgerPostContentBlockText {
  type: "text";
  text: string;
}

interface LedgerPostContentBlockMedia {
  type: "media";
  media_kind: "video" | "gif" | "png";
  url: string;
}

interface LedgerPostRecord {
  post_id: string;
  created_at: string;
  author:
    | {
        mode: "named";
        username: string;
        usertag: string;
      }
    | {
        mode: "anonymous";
      };
  content_blocks: Array<LedgerPostContentBlockText | LedgerPostContentBlockMedia>;
  location: {
    country: string;
    country_code: string;
  };
  engagement: {
    likes: number;
    neutral: number;
    dislikes: number;
    comments_count: number;
  };
}

interface LedgerExportPostsResponse {
  post_popularity_ledger: {
    posts: Record<string, LedgerPostRecord>;
  };
  pagination?: {
    posts?: {
      next_offset?: number | null;
    };
  };
}

interface PrivateCryptoBundlePayload {
  kdf: "PBKDF2-SHA256";
  iterations: number;
  saltBase64: string;
  wrapIvBase64: string;
  wrappedMasterKeyBase64: string;
}

interface PrivateCryptoBundleResponse {
  bundle: PrivateCryptoBundlePayload | null;
}

interface PrivateEncryptedBlockPayload {
  algorithm: string;
  keyFingerprint: string;
  ivBase64: string;
  ciphertextBase64: string;
}

interface PrivateEncryptedBlockResponse {
  block: PrivateEncryptedBlockPayload | null;
}

type RecoveryPassphraseMode = "setup" | "unlock";

interface RecoveryPassphrasePromptRequest {
  mode: RecoveryPassphraseMode;
  defaultValue?: string;
}

type RecoveryPassphrasePromptHandler = (request: RecoveryPassphrasePromptRequest) => Promise<string>;

type PostReactionState = "up" | "neutral" | "down" | null;
type ProfilePostInteractionAction =
  | "seen"
  | "liked"
  | "disliked"
  | "neutral"
  | "saved"
  | "unsaved"
  | "reposted"
  | "unreposted"
  | "commented";

interface PostInteractionSnapshot {
  reaction: PostReactionState;
  reposted: boolean;
  extraComments: number;
}

interface EffectivePostEngagement {
  upvotes: number;
  neutralVotes: number;
  downvotes: number;
  comments: number;
}

let cachedMasterKeyPromise: Promise<CryptoKey> | null = null;
let masterKeySetupPromptSuppressed = false;
let recoveryPassphrasePromptHandler: RecoveryPassphrasePromptHandler | null = null;

const RANDOM_AUTHOR_PROFILES: RandomAuthorProfile[] = [
  { author: "Lina Park", handle: "@linapark", countryCode: "KR", countryName: "South Korea", originalLanguage: "Korean" },
  { author: "Maya Chow", handle: "@mayachow", countryCode: "PH", countryName: "Philippines", originalLanguage: "English" },
  { author: "Nate Silva", handle: "@natesilva", countryCode: "BR", countryName: "Brazil", originalLanguage: "Portuguese" },
  { author: "Ari Singh", handle: "@arisingh", countryCode: "IN", countryName: "India", originalLanguage: "Hindi" },
  { author: "Noa Rivera", handle: "@noariv", countryCode: "MX", countryName: "Mexico", originalLanguage: "Spanish" },
  { author: "Theo Park", handle: "@theop", countryCode: "US", countryName: "United States", originalLanguage: "English" },
  { author: "Ivy Laurent", handle: "@ivyl", countryCode: "FR", countryName: "France", originalLanguage: "French" },
  { author: "Emre Demir", handle: "@emred", countryCode: "DE", countryName: "Germany", originalLanguage: "German" },
  { author: "Yuki Mori", handle: "@yukim", countryCode: "JP", countryName: "Japan", originalLanguage: "Japanese" },
  { author: "Sasha Reed", handle: "@sashareed", countryCode: "GB", countryName: "United Kingdom", originalLanguage: "English" },
  { author: "Cami Ruiz", handle: "@camiruiz", countryCode: "CA", countryName: "Canada", originalLanguage: "English" },
  { author: "Bayo Ade", handle: "@bayoade", countryCode: "NG", countryName: "Nigeria", originalLanguage: "English" }
];

const RANDOM_CAPTIONS = [
  "Street edit breakdown with no cuts hidden.",
  "Creator ops thread in 30 seconds.",
  "Behind the scenes from a one-phone setup.",
  "Regional trend pulse and what changed this week.",
  "Fast compare: old workflow versus current stack.",
  "Clip diary from tonight's creator meetup.",
  "Two-minute narrative cut from one raw take.",
  "Hot take on platform incentives and retention.",
  "Quick field notes from live street interviews.",
  "Compression test: quality versus upload speed."
];

const RANDOM_POSTER_URLS = [
  "https://images.unsplash.com/photo-1470229722913-7c0e2dbbafd3?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1515378960530-7c0da6231fb1?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1520975916090-3105956dac38?auto=format&fit=crop&w=1200&q=80",
  "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80"
];

const RECOVERY_PHRASE_WORDS = [
  "amber", "anchor", "apple", "atlas", "aurora", "beacon", "blossom", "breeze",
  "bridge", "candle", "canyon", "cedar", "circle", "cloud", "coral", "crimson",
  "dawn", "delta", "ember", "field", "flame", "forest", "frost", "garden",
  "globe", "harbor", "horizon", "island", "jungle", "lagoon", "lantern", "leaf",
  "lilac", "meadow", "meridian", "moss", "mountain", "nebula", "oasis", "ocean",
  "olive", "onyx", "orchid", "pearl", "pine", "planet", "prairie", "quartz",
  "rain", "raven", "reef", "river", "sable", "saffron", "sage", "sand",
  "shadow", "shore", "silver", "sky", "spark", "spring", "stone", "storm",
  "summit", "sun", "sunset", "surf", "thunder", "timber", "tundra", "valley",
  "violet", "wave", "willow", "wind", "winter", "zenith"
] as const;

function preferredNativeLanguage(): string {
  if (typeof window === "undefined") {
    return "English";
  }

  const stored = window.localStorage.getItem("pawmaq-native-language");
  if (stored) {
    return stored;
  }

  const locale = window.navigator.language.toLowerCase();
  if (locale.startsWith("es")) return "Spanish";
  if (locale.startsWith("pt")) return "Portuguese";
  if (locale.startsWith("fr")) return "French";
  if (locale.startsWith("de")) return "German";
  if (locale.startsWith("it")) return "Italian";
  if (locale.startsWith("ja")) return "Japanese";
  if (locale.startsWith("ko")) return "Korean";
  if (locale.startsWith("hi")) return "Hindi";
  if (locale.startsWith("zh")) return "Chinese";
  return "English";
}

function preferredTimeWindow(): TimeWindow {
  if (typeof window === "undefined") {
    return "24h";
  }
  const stored = window.localStorage.getItem(TIME_WINDOW_STORAGE_KEY);
  if (
    stored === "10m" ||
    stored === "1h" ||
    stored === "12h" ||
    stored === "24h" ||
    stored === "1w" ||
    stored === "1m" ||
    stored === "3m" ||
    stored === "1y"
  ) {
    return stored;
  }
  return "24h";
}

function preferredLinkedPostId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const fromPostId = params.get("postId");
  const fromLegacyPost = params.get("post");
  const fromHashMatch = window.location.hash.match(/^#post-(.+)$/);
  const fromHash = fromHashMatch?.[1] ?? "";
  const fromSession = window.sessionStorage.getItem(SCROLL_TARGET_POST_KEY) ?? "";
  const value = (fromPostId ?? fromLegacyPost ?? fromHash ?? fromSession ?? "").trim();
  return value.length > 0 ? value : null;
}

function linkedPostIdFromLocation(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const fromPostId = params.get("postId");
  const fromLegacyPost = params.get("post");
  const fromHashMatch = window.location.hash.match(/^#post-(.+)$/);
  const fromHash = fromHashMatch?.[1] ?? "";
  const value = (fromPostId ?? fromLegacyPost ?? fromHash ?? "").trim();
  return value.length > 0 ? value : null;
}

function pairingApprovalFromLocation(): DevicePairingApprovalRequest | null {
  if (typeof window === "undefined") {
    return null;
  }
  const params = new URLSearchParams(window.location.search);
  const linkDevice = params.get("linkDevice");
  const pairingId = (params.get("pairingId") ?? "").trim();
  const approvalSecret = (params.get("approvalSecret") ?? "").trim();
  if (linkDevice !== "1" || pairingId.length === 0 || approvalSecret.length === 0) {
    return null;
  }
  return {
    pairingId,
    approvalSecret
  };
}

function preferredFeedTab(): FeedTab {
  if (typeof window === "undefined") {
    return "following";
  }
  const stored = window.localStorage.getItem(FEED_TAB_STORAGE_KEY);
  if (stored === "saved" || stored === "following" || stored === "world") {
    return stored;
  }
  return "following";
}

function uniquePosts(posts: FeedPost[]): FeedPost[] {
  const seen = new Set<string>();
  const deduped: FeedPost[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    deduped.push(post);
  }
  return deduped;
}

function readSavedPostIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set<string>();
  }
  const raw = window.localStorage.getItem("pawmaq-account-you-saved-post-ids");
  if (!raw) {
    return new Set<string>();
  }
  try {
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed);
  } catch {
    return new Set<string>();
  }
}

function readSeenPostHashes(): Set<string> {
  if (typeof window === "undefined") {
    return new Set<string>();
  }
  const raw = window.localStorage.getItem(SEEN_POST_HASHES_KEY);
  if (!raw) {
    return new Set<string>();
  }
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set<string>();
  }
}

function readPostInteractions(): Record<string, PostInteractionSnapshot> {
  if (typeof window === "undefined") {
    return {};
  }
  const raw = window.localStorage.getItem(POST_INTERACTIONS_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<PostInteractionSnapshot>>;
    const next: Record<string, PostInteractionSnapshot> = {};
    for (const [postId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      const reaction =
        value.reaction === "up" || value.reaction === "neutral" || value.reaction === "down"
          ? value.reaction
          : null;
      next[postId] = {
        reaction,
        reposted: value.reposted === true,
        extraComments:
          typeof value.extraComments === "number" && Number.isFinite(value.extraComments)
            ? Math.max(0, Math.floor(value.extraComments))
            : 0
      };
    }
    return next;
  } catch {
    return {};
  }
}

function readPersistedPosts(): FeedPost[] {
  if (typeof window === "undefined") {
    return generateRandomPosts(INITIAL_POOL_SIZE, TIME_WINDOW_MAX_HOURS["1w"], Date.now());
  }
  const raw = window.localStorage.getItem(POSTS_STORAGE_KEY);
  if (!raw) {
    return generateRandomPosts(INITIAL_POOL_SIZE, TIME_WINDOW_MAX_HOURS["1w"], Date.now());
  }

  const nowMs = Date.now();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    const hydrated = parsed
      .map((entry) => hydrateStoredPost(entry, nowMs))
      .filter((post): post is FeedPost => post !== null);
    return uniquePosts(hydrated).sort((left, right) => right.createdAtMs - left.createdAtMs);
  } catch {
    return [];
  }
}

function readSignedIn(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(SIGNED_IN_KEY) === "1";
}

function readSignedInProfile(): StoredAuthProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SIGNED_IN_PROFILE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuthProfile>;
    if (
      parsed.provider !== "passkey" ||
      typeof parsed.name !== "string"
    ) {
      return null;
    }
    return {
      provider: parsed.provider,
      name: parsed.name,
      email: typeof parsed.email === "string" ? parsed.email : undefined
    };
  } catch {
    return null;
  }
}

function readLastSelectedCountryCode(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(LAST_SELECTED_COUNTRY_KEY);
  if (!stored || stored === "all") {
    return null;
  }
  return stored;
}

function readGuestDeviceVerifiedAtMs(): number {
  if (typeof window === "undefined") {
    return Date.now();
  }
  const raw = window.localStorage.getItem(GUEST_DEVICE_VERIFIED_AT_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const now = Date.now();
    window.localStorage.setItem(GUEST_DEVICE_VERIFIED_AT_KEY, String(now));
    return now;
  }
  return parsed;
}

function writeGuestDeviceVerifiedAtMs(timestampMs: number): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(GUEST_DEVICE_VERIFIED_AT_KEY, String(Math.max(0, Math.floor(timestampMs))));
}

function readFollowedHandles(): Set<string> {
  if (typeof window === "undefined") {
    return new Set<string>();
  }
  const raw = window.localStorage.getItem(FOLLOWED_HANDLES_KEY);
  if (!raw) {
    return new Set<string>();
  }
  try {
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((value) => value.startsWith("@")));
  } catch {
    return new Set<string>();
  }
}

function writeFollowedHandles(handles: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(FOLLOWED_HANDLES_KEY, JSON.stringify([...handles]));
}

function hashFromString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function syntheticCountFromHandle(handle: string, min: number, max: number): number {
  const value = hashFromString(handle);
  const range = Math.max(1, max - min + 1);
  return min + (value % range);
}

function writeSeenPostHashes(hashes: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SEEN_POST_HASHES_KEY, JSON.stringify([...hashes]));
}

function writePostInteractions(interactions: Record<string, PostInteractionSnapshot>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(POST_INTERACTIONS_KEY, JSON.stringify(interactions));
}

function hydrateStoredPost(entry: unknown, nowMs: number): FeedPost | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const candidate = entry as Partial<FeedPost>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.author !== "string" ||
    typeof candidate.handle !== "string" ||
    typeof candidate.caption !== "string" ||
    typeof candidate.countryCode !== "string" ||
    typeof candidate.countryName !== "string"
  ) {
    return null;
  }

  const createdAtMs =
    typeof candidate.createdAtMs === "number" && Number.isFinite(candidate.createdAtMs)
      ? candidate.createdAtMs
      : nowMs;
  const ageHours = Math.max(0, (nowMs - createdAtMs) / (60 * 60 * 1000));
  const mediaType =
    candidate.mediaType === "video" || candidate.mediaType === "gif" || candidate.mediaType === "png"
      ? candidate.mediaType
      : undefined;
  const videoUrl =
    typeof candidate.videoUrl === "string" && !candidate.videoUrl.startsWith("blob:")
      ? candidate.videoUrl
      : undefined;
  const posterUrl =
    typeof candidate.posterUrl === "string" && !candidate.posterUrl.startsWith("blob:")
      ? candidate.posterUrl
      : undefined;
  const translatedCaptions =
    candidate.translatedCaptions && typeof candidate.translatedCaptions === "object"
      ? candidate.translatedCaptions
      : undefined;

  return {
    id: candidate.id,
    author: decodeBasicHtmlEntities(candidate.author),
    handle: candidate.handle,
    isAnonymous: candidate.isAnonymous === true,
    anonymousKey: typeof candidate.anonymousKey === "string" ? candidate.anonymousKey : undefined,
    caption: normalizeCaptionWhitespace(decodeBasicHtmlEntities(candidate.caption)),
    originalLanguage: typeof candidate.originalLanguage === "string" ? candidate.originalLanguage : "English",
    translatedCaptions,
    countryCode: candidate.countryCode,
    countryName: candidate.countryName,
    createdAt: createdAtLabelFromHoursAgo(ageHours),
    createdAtHoursAgo: ageHours,
    createdAtMs,
    videoUrl,
    mediaType,
    posterUrl,
    likes: typeof candidate.likes === "number" ? candidate.likes : 0,
    comments: typeof candidate.comments === "number" ? candidate.comments : 0,
    reposts: typeof candidate.reposts === "number" ? candidate.reposts : 0,
    views: typeof candidate.views === "number" ? candidate.views : 0,
    upvotes: typeof candidate.upvotes === "number" ? candidate.upvotes : 0,
    neutralVotes: typeof candidate.neutralVotes === "number" ? candidate.neutralVotes : 0,
    downvotes: typeof candidate.downvotes === "number" ? candidate.downvotes : 0
  };
}

function writePersistedPosts(posts: FeedPost[]) {
  if (typeof window === "undefined") {
    return;
  }

  const serializable = posts.slice(0, MAX_PERSISTED_POSTS).map((post) => ({
    ...post,
    videoUrl: post.videoUrl && post.videoUrl.startsWith("blob:") ? undefined : post.videoUrl,
    posterUrl: post.posterUrl && post.posterUrl.startsWith("blob:") ? undefined : post.posterUrl
  }));
  window.localStorage.setItem(POSTS_STORAGE_KEY, JSON.stringify(serializable));
}

function writeSignedInProfile(profile: StoredAuthProfile | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (!profile) {
    window.localStorage.removeItem(SIGNED_IN_PROFILE_KEY);
    return;
  }
  window.localStorage.setItem(SIGNED_IN_PROFILE_KEY, JSON.stringify(profile));
}

function readOwnServerProfileCache(): ServerLedgerProfile | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(OWN_PROFILE_CACHE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<ServerLedgerProfile>;
    if (
      (parsed.provider !== "google" && parsed.provider !== "passkey") ||
      typeof parsed.userId !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.handle !== "string"
    ) {
      return null;
    }
    return parsed as ServerLedgerProfile;
  } catch {
    return null;
  }
}

function writeOwnServerProfileCache(profile: ServerLedgerProfile | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (!profile) {
    window.localStorage.removeItem(OWN_PROFILE_CACHE_KEY);
    return;
  }
  window.localStorage.setItem(OWN_PROFILE_CACHE_KEY, JSON.stringify(profile));
}

function normalizeHandle(value: string): string {
  const stripped = value.trim().replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  if (stripped.length < 2) {
    return "@member";
  }
  return `@${stripped.slice(0, 32)}`;
}

function normalizeHandleList(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const handle = normalizeHandle(value);
    if (handle === "@member" || seen.has(handle)) {
      continue;
    }
    seen.add(handle);
    normalized.push(handle);
  }
  return normalized;
}

function privateFollowingHandlesFromPayload(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  const candidate = payload as {
    privateSocialGraph?: {
      followingHandles?: unknown;
    };
    userPreferences?: {
      followingHandles?: unknown;
    };
  };
  const fromPrivateBlock = Array.isArray(candidate.privateSocialGraph?.followingHandles)
    ? candidate.privateSocialGraph?.followingHandles
    : [];
  const fromLegacy = Array.isArray(candidate.userPreferences?.followingHandles)
    ? candidate.userPreferences?.followingHandles
    : [];
  const source = fromPrivateBlock.length > 0 ? fromPrivateBlock : fromLegacy;
  return normalizeHandleList(source.filter((value): value is string => typeof value === "string"));
}

function fallbackHandleFromAuthProfile(profile: StoredAuthProfile | null): string {
  if (!profile) {
    return "@you";
  }
  const emailLocal = (profile.email ?? "").split("@")[0] ?? "";
  const basis = emailLocal.trim() || profile.name.trim() || "you";
  return normalizeHandle(basis);
}

function draftFromServerProfile(profile: ServerLedgerProfile): ProfileEditorDraft {
  return {
    name: profile.name,
    username: profile.username,
    handle: profile.handle,
    bio: profile.bio,
    location: profile.location,
    avatarUrl: profile.avatarUrl,
    bannerUrl: profile.bannerUrl,
    shareSocialGraph: profile.shareSocialGraph
  };
}

function bytesToBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function openPrivateKeyDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    throw new Error("IndexedDB unavailable outside browser.");
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(PRIVATE_KEY_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PRIVATE_KEY_STORE_NAME)) {
        db.createObjectStore(PRIVATE_KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open key database."));
  });
}

async function readMasterKeyFromIndexedDb(): Promise<CryptoKey | null> {
  const db = await openPrivateKeyDatabase();
  return new Promise<CryptoKey | null>((resolve, reject) => {
    const transaction = db.transaction(PRIVATE_KEY_STORE_NAME, "readonly");
    const store = transaction.objectStore(PRIVATE_KEY_STORE_NAME);
    const request = store.get(PRIVATE_KEY_RECORD_ID);
    request.onsuccess = () => {
      const value = request.result;
      resolve(value instanceof CryptoKey ? value : null);
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to read master key."));
  });
}

async function writeMasterKeyToIndexedDb(key: CryptoKey): Promise<void> {
  const db = await openPrivateKeyDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PRIVATE_KEY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(PRIVATE_KEY_STORE_NAME);
    const request = store.put(key, PRIVATE_KEY_RECORD_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Unable to store master key."));
  });
}

function clearCachedMasterKey(): void {
  cachedMasterKeyPromise = null;
}

async function derivePassphraseWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> {
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const passphraseBytes = new TextEncoder().encode(passphrase);
  const passphraseMaterial = await cryptoApi.importKey(
    "raw",
    Uint8Array.from(passphraseBytes).buffer as ArrayBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const saltBuffer = Uint8Array.from(salt).buffer as ArrayBuffer;
  return cryptoApi.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations
    },
    passphraseMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function fingerprintMasterKey(rawMasterKey: Uint8Array): Promise<string> {
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const digest = await cryptoApi.digest("SHA-256", Uint8Array.from(rawMasterKey).buffer as ArrayBuffer);
  const fingerprint = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
  return fingerprint;
}

function setRecoveryPassphrasePromptHandler(handler: RecoveryPassphrasePromptHandler | null): void {
  recoveryPassphrasePromptHandler = handler;
}

function isStrongRecoveryPhrase(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 20) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

function generateDefaultRecoveryPhrase(wordCount: number = 7): string {
  const phrase: string[] = [];
  for (let index = 0; index < wordCount; index += 1) {
    phrase.push(pickRandom([...RECOVERY_PHRASE_WORDS]));
  }
  return phrase.join(" ");
}

function downloadRecoveryPhrase(phrase: string): void {
  if (typeof window === "undefined") {
    return;
  }
  const resetDate = new Date();
  resetDate.setHours(24, 0, 0, 0);
  const payload = [
    "pawmaq.com recovery phrase",
    "",
    `phrase: ${phrase}`,
    `generated_at: ${new Date().toISOString()}`,
    `daily_reset_hint: ${resetDate.toISOString()}`,
    "",
    "Store this phrase securely. It may still be possible for your account to be identified."
  ].join("\n");
  const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pawmaq-recovery-phrase-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

async function promptForPassphrase(request: RecoveryPassphrasePromptRequest): Promise<string> {
  const handler = recoveryPassphrasePromptHandler;
  if (!handler) {
    throw new Error("Recovery passphrase prompt unavailable.");
  }
  const value = await handler(request);
  const trimmed = value.trim();
  if (!isStrongRecoveryPhrase(trimmed)) {
    throw new Error("Recovery passphrase canceled or too weak.");
  }
  return trimmed;
}

async function createPrivateCryptoBundle(rawMasterKey: Uint8Array): Promise<PrivateCryptoBundlePayload> {
  const passphrase = await promptForPassphrase({
    mode: "setup",
    defaultValue: generateDefaultRecoveryPhrase()
  });
  downloadRecoveryPhrase(passphrase);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const wrapIv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await derivePassphraseWrappingKey(passphrase, salt, PRIVATE_CRYPTO_KDF_ITERATIONS);
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const wrapIvBuffer = Uint8Array.from(wrapIv).buffer as ArrayBuffer;
  const wrapped = await cryptoApi.encrypt(
    { name: "AES-GCM", iv: wrapIvBuffer },
    wrappingKey,
    Uint8Array.from(rawMasterKey).buffer as ArrayBuffer
  );
  return {
    kdf: PRIVATE_CRYPTO_KDF,
    iterations: PRIVATE_CRYPTO_KDF_ITERATIONS,
    saltBase64: bytesToBase64(salt),
    wrapIvBase64: bytesToBase64(wrapIv),
    wrappedMasterKeyBase64: bytesToBase64(new Uint8Array(wrapped))
  };
}

async function unwrapMasterKeyFromBundle(bundle: PrivateCryptoBundlePayload): Promise<Uint8Array> {
  const passphrase = await promptForPassphrase({
    mode: "unlock"
  });
  const salt = base64ToBytes(bundle.saltBase64);
  const wrapIv = base64ToBytes(bundle.wrapIvBase64);
  const wrapped = base64ToBytes(bundle.wrappedMasterKeyBase64);
  const wrappingKey = await derivePassphraseWrappingKey(passphrase, salt, bundle.iterations);
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const wrapIvBuffer = Uint8Array.from(wrapIv).buffer as ArrayBuffer;
  const wrappedBuffer = Uint8Array.from(wrapped).buffer as ArrayBuffer;
  const raw = await cryptoApi.decrypt({ name: "AES-GCM", iv: wrapIvBuffer }, wrappingKey, wrappedBuffer);
  return new Uint8Array(raw);
}

async function fetchPrivateCryptoBundle(): Promise<PrivateCryptoBundlePayload | null> {
  const response = await fetchApi<PrivateCryptoBundleResponse>("/v1/profiles/private-crypto");
  return response.bundle;
}

async function writePrivateCryptoBundle(bundle: PrivateCryptoBundlePayload): Promise<void> {
  await fetchApi<{ ok: boolean }>("/v1/profiles/private-crypto", {
    method: "PUT",
    body: JSON.stringify(bundle)
  });
}

async function ensureAccountMasterKey(): Promise<CryptoKey> {
  if (cachedMasterKeyPromise) {
    return cachedMasterKeyPromise;
  }
  cachedMasterKeyPromise = (async () => {
    const cryptoApi = window.crypto?.subtle;
    if (!cryptoApi) {
      throw new Error("WebCrypto is not available in this browser.");
    }
    const existingKey = await readMasterKeyFromIndexedDb();
    if (existingKey) {
      return existingKey;
    }
    if (masterKeySetupPromptSuppressed) {
      throw new Error("Private key setup temporarily suppressed.");
    }

    const bundle = await fetchPrivateCryptoBundle();
    let rawMasterKey: Uint8Array;
    if (bundle) {
      rawMasterKey = await unwrapMasterKeyFromBundle(bundle);
    } else {
      rawMasterKey = window.crypto.getRandomValues(new Uint8Array(32));
      const nextBundle = await createPrivateCryptoBundle(rawMasterKey);
      await writePrivateCryptoBundle(nextBundle);
    }

    const imported = await cryptoApi.importKey(
      "raw",
      Uint8Array.from(rawMasterKey).buffer as ArrayBuffer,
      "AES-GCM",
      true,
      ["encrypt", "decrypt"]
    );
    // Persist as a browser-managed CryptoKey (not localStorage plaintext) to avoid repeated unlock prompts.
    await writeMasterKeyToIndexedDb(imported);
    return imported;
  })().catch((error) => {
    cachedMasterKeyPromise = null;
    if (error instanceof Error && /canceled|weak/i.test(error.message)) {
      masterKeySetupPromptSuppressed = true;
      window.setTimeout(() => {
        masterKeySetupPromptSuppressed = false;
      }, 120_000);
    }
    throw error;
  });
  return cachedMasterKeyPromise;
}

async function encryptPrivateProfilePayload(payload: unknown): Promise<{
  algorithm: string;
  keyFingerprint: string;
  ivBase64: string;
  ciphertextBase64: string;
}> {
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const key = await ensureAccountMasterKey();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = await cryptoApi.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const rawMaster = await cryptoApi.exportKey("raw", key);
  const fingerprint = await fingerprintMasterKey(new Uint8Array(rawMaster));
  return {
    algorithm: "AES-GCM-256",
    keyFingerprint: fingerprint,
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(new Uint8Array(encrypted))
  };
}

async function decryptPrivateProfilePayload(block: PrivateEncryptedBlockPayload): Promise<unknown> {
  const cryptoApi = window.crypto?.subtle;
  if (!cryptoApi) {
    throw new Error("WebCrypto is not available in this browser.");
  }
  const key = await ensureAccountMasterKey();
  const iv = base64ToBytes(block.ivBase64);
  const ciphertext = base64ToBytes(block.ciphertextBase64);
  const decrypted = await cryptoApi.decrypt(
    { name: "AES-GCM", iv: Uint8Array.from(iv).buffer as ArrayBuffer },
    key,
    Uint8Array.from(ciphertext).buffer as ArrayBuffer
  );
  const decoded = new TextDecoder().decode(new Uint8Array(decrypted));
  return JSON.parse(decoded) as unknown;
}

class ApiError extends Error {
  readonly status: number;

  readonly code: string;

  readonly retryAfterMs: number | null;

  constructor(status: number, code: string, message?: string, retryAfterMs?: number) {
    super(message ?? `Request failed with status ${status}.`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfterMs = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? Math.floor(retryAfterMs)
      : null;
  }
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

function isRetryableRequestError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return [408, 429, 500, 502, 503, 504].includes(error.status);
  }
  if (error instanceof Error) {
    return error.message.includes("Unable to reach the API server");
  }
  return false;
}

function retryDelayForAttempt(error: unknown, attempt: number): number {
  if (error instanceof ApiError && error.retryAfterMs !== null) {
    return Math.min(Math.max(error.retryAfterMs, 300), 8_000);
  }
  const cappedAttempt = Math.max(1, Math.min(attempt, 4));
  return Math.min(400 * 2 ** (cappedAttempt - 1), 4_000);
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  const hasBody = init?.body !== undefined && init?.body !== null;
  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...init,
      headers
    });
  } catch {
    throw new Error("Unable to reach the API server. Make sure the API is running, then retry.");
  }

  const payload = (await response.json().catch(() => null)) as
    | {
        message?: string;
        error?: string;
        retry_after_ms?: number;
      }
    | null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.error ?? "request_failed", payload?.message, payload?.retry_after_ms);
  }

  return payload as T;
}

async function requestHumanChallenge(
  purpose: "passkey_register" | "passkey_auth"
): Promise<HumanChallengeResponse> {
  return fetchApi<HumanChallengeResponse>("/v1/auth/human-challenge", {
    method: "POST",
    body: JSON.stringify({
      purpose
    })
  });
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

async function sha256Hex(input: string): Promise<string> {
  if (!("crypto" in globalThis) || !globalThis.crypto?.subtle) {
    throw new Error("Anonymous human verification is unavailable in this browser.");
  }
  const data = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function solveHumanChallenge(challenge: HumanChallengeResponse): Promise<HumanProofPayload> {
  const maxAttempts = 4_000_000;
  for (let counter = 0; counter < maxAttempts; counter += 1) {
    const payload = `${challenge.challengeId}:${challenge.nonce}:${counter}`;
    const digestHex = await sha256Hex(payload);
    if (leadingZeroBitsFromHex(digestHex) >= challenge.difficultyBits) {
      return {
        challengeId: challenge.challengeId,
        counter,
        digestHex
      };
    }
  }
  throw new Error("Unable to complete anonymous human verification challenge.");
}

async function beginPasskeyRegistration(humanProof: HumanProofPayload): Promise<PasskeyBeginResponse<PasskeyRegistrationOptions>> {
  return fetchApi<PasskeyBeginResponse<PasskeyRegistrationOptions>>("/v1/auth/passkey/register/options", {
    method: "POST",
    body: JSON.stringify({
      humanProof
    })
  });
}

async function completePasskeyRegistration(
  challengeToken: string,
  response: PasskeyRegistrationResponse,
  guest: boolean
): Promise<AuthSessionResponse> {
  return fetchApi<AuthSessionResponse>("/v1/auth/passkey/register/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeToken,
      response,
      guest
    })
  });
}

async function beginPasskeyAuthentication(humanProof: HumanProofPayload): Promise<PasskeyBeginResponse<PasskeyAuthenticationOptions>> {
  return fetchApi<PasskeyBeginResponse<PasskeyAuthenticationOptions>>("/v1/auth/passkey/authenticate/options", {
    method: "POST",
    body: JSON.stringify({
      humanProof
    })
  });
}

async function completePasskeyAuthentication(
  challengeToken: string,
  response: PasskeyAuthenticationResponse,
  guest: boolean
): Promise<AuthSessionResponse> {
  return fetchApi<AuthSessionResponse>("/v1/auth/passkey/authenticate/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeToken,
      response,
      guest
    })
  });
}

async function fetchSessionState(): Promise<AuthSessionResponse> {
  return fetchApi<AuthSessionResponse>("/v1/auth/session");
}

async function signOutSession(): Promise<void> {
  await fetchApi<{ ok: boolean }>("/v1/auth/sign-out", {
    method: "POST"
  });
}

async function startDevicePairing(intent: DevicePairingIntent): Promise<DevicePairingStartResponse> {
  return fetchApi<DevicePairingStartResponse>("/v1/auth/pairing/start", {
    method: "POST",
    body: JSON.stringify({ intent })
  });
}

async function approveDevicePairing(pairingId: string, approvalSecret: string): Promise<void> {
  await fetchApi<{ ok: boolean }>("/v1/auth/pairing/approve", {
    method: "POST",
    body: JSON.stringify({
      pairingId,
      approvalSecret
    })
  });
}

async function pollDevicePairing(
  pairingId: string,
  pollSecret: string
): Promise<DevicePairingStatusResponse> {
  return fetchApi<DevicePairingStatusResponse>("/v1/auth/pairing/status", {
    method: "POST",
    body: JSON.stringify({
      pairingId,
      pollSecret
    })
  });
}

async function completeDevicePairing(
  pairingId: string,
  pollSecret: string,
  handoffToken: string
): Promise<AuthSessionResponse> {
  return fetchApi<AuthSessionResponse>("/v1/auth/pairing/complete", {
    method: "POST",
    body: JSON.stringify({
      pairingId,
      pollSecret,
      handoffToken
    })
  });
}

async function writePrivateProfileEncryptedBlock(payload: unknown): Promise<void> {
  const encrypted = await encryptPrivateProfilePayload(payload);
  await fetchApi<{ ok: boolean }>("/v1/profiles/private-block", {
    method: "PUT",
    body: JSON.stringify(encrypted)
  });
}

async function fetchPrivateProfileEncryptedBlock(): Promise<PrivateEncryptedBlockPayload | null> {
  const response = await fetchApi<PrivateEncryptedBlockResponse>("/v1/profiles/private-block");
  return response.block;
}

async function readPrivateProfilePayload(): Promise<unknown | null> {
  const block = await fetchPrivateProfileEncryptedBlock();
  if (!block) {
    return null;
  }
  return decryptPrivateProfilePayload(block);
}

async function saveProfileLedger(draft: ProfileEditorDraft): Promise<ServerLedgerProfile> {
  return fetchApi<ServerLedgerProfile>("/v1/profiles/self", {
    method: "PUT",
    body: JSON.stringify({
      name: draft.name.trim(),
      username: draft.username.trim(),
      handle: normalizeHandle(draft.handle),
      bio: draft.bio,
      location: draft.location,
      avatarUrl: draft.avatarUrl.trim(),
      bannerUrl: draft.bannerUrl.trim(),
      shareSocialGraph: draft.shareSocialGraph
    })
  });
}

async function saveProfileLedgerWithRetry(
  draft: ProfileEditorDraft,
  onRetry: (attempt: number, maxAttempts: number, retryInMs: number) => void
): Promise<ServerLedgerProfile> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await saveProfileLedger(draft);
    } catch (error) {
      const canRetry = attempt < maxAttempts && isRetryableRequestError(error);
      if (!canRetry) {
        throw error;
      }
      const retryInMs = retryDelayForAttempt(error, attempt);
      onRetry(attempt + 1, maxAttempts, retryInMs);
      await delayMs(retryInMs);
    }
  }
  throw new Error("Unable to save profile right now.");
}

async function setFollowInLedger(targetHandle: string, follow: boolean): Promise<ServerLedgerProfile> {
  return fetchApi<ServerLedgerProfile>("/v1/profiles/follow", {
    method: "POST",
    body: JSON.stringify({
      targetHandle,
      follow
    })
  });
}

async function fetchProfileByHandle(handle: string): Promise<ServerLedgerProfile | null> {
  const normalized = normalizeHandle(handle);
  const encoded = encodeURIComponent(normalized);
  const response = await fetch(`${API_BASE_URL}/v1/profiles/by-handle/${encoded}`, {
    credentials: "include"
  });
  if (response.status === 404) {
    return null;
  }
  const payload = (await response.json().catch(() => null)) as
    | ServerLedgerProfile
    | { message?: string }
    | null;
  if (!response.ok) {
    const message = payload && "message" in payload ? payload.message : "Unable to load profile.";
    throw new Error(message ?? "Unable to load profile.");
  }
  return payload as ServerLedgerProfile;
}

async function writePostToLedger(post: FeedPost): Promise<void> {
  await fetchApi<{ ok: boolean }>("/v1/ledger/posts", {
    method: "POST",
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
      comments: post.comments
    })
  });
}

async function writeProfilePostInteraction(
  postId: string,
  action: ProfilePostInteractionAction
): Promise<void> {
  await fetchApi<{ ok: boolean }>("/v1/profiles/post-interactions", {
    method: "POST",
    body: JSON.stringify({
      postId,
      action
    })
  });
}

async function recordCreatedPostForProfile(
  postId: string,
  anonymous?: boolean
): Promise<ServerLedgerProfile> {
  return fetchApi<ServerLedgerProfile>("/v1/profiles/posts", {
    method: "POST",
    body: JSON.stringify({
      postId,
      anonymous: anonymous === true
    })
  });
}

function ledgerCreatedAtMs(iso: string, nowMs: number): number {
  const parsed = new Date(iso).getTime();
  if (!Number.isFinite(parsed)) {
    return nowMs;
  }
  return parsed;
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, "\"")
    .replace(/&ldquo;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-fA-F]+);/g, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function normalizeCaptionWhitespace(value: string): string {
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

function feedPostFromLedgerRecord(record: LedgerPostRecord, nowMs: number): FeedPost | null {
  const postId = typeof record.post_id === "string" ? record.post_id.trim() : "";
  if (!postId) {
    return null;
  }

  const textBlock = record.content_blocks.find((block): block is LedgerPostContentBlockText => block.type === "text");
  const mediaBlock = record.content_blocks.find((block): block is LedgerPostContentBlockMedia => block.type === "media");
  const caption = normalizeCaptionWhitespace(
    decodeBasicHtmlEntities(typeof textBlock?.text === "string" ? textBlock.text : "")
  );
  if (!caption.trim()) {
    return null;
  }

  const createdAtMs = ledgerCreatedAtMs(record.created_at, nowMs);
  const ageHours = Math.max(0, (nowMs - createdAtMs) / (60 * 60 * 1000));
  const isAnonymous = record.author.mode === "anonymous";
  const namedAuthor = record.author.mode === "named" ? record.author : null;
  const upvotes = Number.isFinite(record.engagement.likes) ? Math.max(0, Math.floor(record.engagement.likes)) : 0;
  const neutralVotes = Number.isFinite(record.engagement.neutral)
    ? Math.max(0, Math.floor(record.engagement.neutral))
    : 0;
  const downvotes = Number.isFinite(record.engagement.dislikes) ? Math.max(0, Math.floor(record.engagement.dislikes)) : 0;

  return {
    id: postId,
    author: isAnonymous ? "Anonymous" : decodeBasicHtmlEntities(namedAuthor?.username ?? "RSS Bot"),
    handle: isAnonymous ? "@anonymous" : normalizeHandle(namedAuthor?.usertag ?? "@rssbot"),
    isAnonymous,
    caption,
    originalLanguage: "English",
    countryCode: (record.location.country_code ?? "WW").trim().toUpperCase() || "WW",
    countryName: (record.location.country ?? "Worldwide").trim() || "Worldwide",
    createdAt: createdAtLabelFromHoursAgo(ageHours),
    createdAtHoursAgo: ageHours,
    createdAtMs,
    videoUrl: mediaBlock?.url,
    mediaType: mediaBlock?.media_kind,
    likes: upvotes,
    comments: Number.isFinite(record.engagement.comments_count)
      ? Math.max(0, Math.floor(record.engagement.comments_count))
      : 0,
    reposts: 0,
    views: 0,
    upvotes,
    neutralVotes,
    downvotes
  };
}

async function fetchLedgerPostsFromApi(): Promise<FeedPost[]> {
  const nowMs = Date.now();
  const collected: FeedPost[] = [];
  let offset = 0;
  let pageCount = 0;
  const MAX_PAGES = 20;

  while (pageCount < MAX_PAGES) {
    const query = new URLSearchParams({
      usersOffset: "0",
      usersLimit: "1",
      postsOffset: String(offset),
      postsLimit: "250",
      rankLimit: "1",
      hashtagLimit: "1"
    });
    const response = await fetch(`${API_BASE_URL}/v1/ledger/export?${query.toString()}`);
    if (!response.ok) {
      // Keep partial progress instead of failing the whole sync on one page.
      break;
    }
    const payload = (await response.json()) as LedgerExportPostsResponse;
    const pagePosts = Object.values(payload.post_popularity_ledger.posts)
      .map((record) => feedPostFromLedgerRecord(record, nowMs))
      .filter((post): post is FeedPost => post !== null);
    collected.push(...pagePosts);
    const nextOffset = payload.pagination?.posts?.next_offset;
    if (typeof nextOffset !== "number") {
      break;
    }
    offset = nextOffset;
    pageCount += 1;
  }

  return uniquePosts(collected).sort((left, right) => right.createdAtMs - left.createdAtMs);
}

function passkeySignInErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return "Passkey sign-in is temporarily rate limited. Please retry in a moment.";
  }
  if (error instanceof ApiError && error.code === "human_verification_failed") {
    return "Anonymous human verification failed. Please retry.";
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel|not allowed|abort/i.test(message)) {
    return "Passkey verification was canceled.";
  }
  if (/unsupported|not supported|webauthn/i.test(message)) {
    return "This browser or device does not support passkeys.";
  }
  return "Passkey sign-in failed. Please try again.";
}

function browserSupportsPasskeySignIn(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function isRecoveryPhraseFlowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /recovery passphrase|recovery phrase|private key setup temporarily suppressed/i.test(message);
}

function postIdentifierHash(post: FeedPost): string {
  const source = `${post.id}|${post.author}|${post.handle}|${post.caption}|${post.countryCode}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return `p${(hash >>> 0).toString(16)}`;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(values: T[]): T {
  return values[randomInt(0, values.length - 1)]!;
}

function createdAtLabelFromHoursAgo(hoursAgo: number): string {
  if (hoursAgo <= 0) {
    return "just now";
  }
  if (hoursAgo < 1) {
    return `${Math.max(1, Math.round(hoursAgo * 60))}m ago`;
  }
  if (hoursAgo < 24) {
    return `${Math.max(1, Math.round(hoursAgo))}h ago`;
  }
  const days = Math.max(1, Math.round(hoursAgo / 24));
  return `${days}d ago`;
}

function randomTranslatedCaptions(
  originalLanguage: string,
  caption: string
): Record<string, string> | undefined {
  if (originalLanguage !== "English" && Math.random() < 0.8) {
    return { English: caption };
  }
  if (originalLanguage === "English" && Math.random() < 0.25) {
    return { Spanish: caption };
  }
  return undefined;
}

function generateRandomPost(maxHoursAgo: number, referenceTimeMs: number): FeedPost {
  const profile = pickRandom(RANDOM_AUTHOR_PROFILES);
  const hoursAgo = randomFloat(0, Math.max(1 / 120, maxHoursAgo));
  const createdAtMs = referenceTimeMs - Math.round(hoursAgo * 60 * 60 * 1000);
  const caption = pickRandom(RANDOM_CAPTIONS);
  const totalVotes = randomInt(400, 42000);
  const neutralVotes = Math.floor(totalVotes * randomFloat(0.1, 0.35));
  const remaining = totalVotes - neutralVotes;
  const upvotes = Math.floor(remaining * randomFloat(0.25, 0.88));
  const downvotes = Math.max(0, remaining - upvotes);

  return {
    id: `rnd-${crypto.randomUUID()}`,
    author: profile.author,
    handle: profile.handle,
    caption,
    originalLanguage: profile.originalLanguage,
    translatedCaptions: randomTranslatedCaptions(profile.originalLanguage, caption),
    countryCode: profile.countryCode,
    countryName: profile.countryName,
    createdAt: createdAtLabelFromHoursAgo(hoursAgo),
    createdAtHoursAgo: hoursAgo,
    createdAtMs,
    posterUrl: pickRandom(RANDOM_POSTER_URLS),
    likes: randomInt(200, 32000),
    comments: randomInt(40, 8200),
    reposts: randomInt(20, 2800),
    views: randomInt(12000, 920000),
    upvotes,
    neutralVotes,
    downvotes
  };
}

function generateRandomPosts(count: number, maxHoursAgo: number, referenceTimeMs: number = Date.now()): FeedPost[] {
  const generated: FeedPost[] = [];
  for (let index = 0; index < count; index += 1) {
    generated.push(generateRandomPost(maxHoursAgo, referenceTimeMs));
  }
  return generated;
}

function postAgeHoursAt(post: FeedPost, referenceTimeMs: number): number {
  const createdAtMs = post.createdAtMs ?? referenceTimeMs - post.createdAtHoursAgo * 60 * 60 * 1000;
  if (createdAtMs > referenceTimeMs) {
    return -1;
  }
  return (referenceTimeMs - createdAtMs) / (60 * 60 * 1000);
}

function isPostInTimeWindow(post: FeedPost, timeWindow: TimeWindow, referenceTimeMs: number): boolean {
  const ageHours = postAgeHoursAt(post, referenceTimeMs);
  if (ageHours < 0) {
    return false;
  }
  // Cumulative bins: include everything newer than the selected max window.
  return ageHours <= TIME_WINDOW_MAX_HOURS[timeWindow];
}

function postEngagementWithInteraction(
  post: FeedPost,
  interaction: PostInteractionSnapshot | undefined
): EffectivePostEngagement {
  return {
    upvotes: post.upvotes + (interaction?.reaction === "up" ? 1 : 0),
    neutralVotes: post.neutralVotes + (interaction?.reaction === "neutral" ? 1 : 0),
    downvotes: post.downvotes + (interaction?.reaction === "down" ? 1 : 0),
    comments: post.comments + Math.max(0, interaction?.extraComments ?? 0)
  };
}

function postWithEffectiveEngagement(
  post: FeedPost,
  interaction: PostInteractionSnapshot | undefined
): FeedPost {
  const engagement = postEngagementWithInteraction(post, interaction);
  return {
    ...post,
    upvotes: engagement.upvotes,
    neutralVotes: engagement.neutralVotes,
    downvotes: engagement.downvotes,
    comments: engagement.comments
  };
}

function postLikeScore(post: FeedPost, interaction: PostInteractionSnapshot | undefined): number {
  return postEngagementWithInteraction(post, interaction).upvotes;
}

function postApprovalScore(post: FeedPost, interaction: PostInteractionSnapshot | undefined): number {
  const engagement = postEngagementWithInteraction(post, interaction);
  return approvalPercentFromVotes(engagement.upvotes, engagement.neutralVotes, engagement.downvotes);
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

function recoveryPassphrasePromptCopy(mode: RecoveryPassphraseMode): {
  title: string;
  description: string;
  submitLabel: string;
} {
  if (mode === "setup") {
    return {
      title: "Create Recovery Phrase",
      description:
        "Use this phrase to recover private profile encryption on another device. Create and download it before continuing.",
      submitLabel: "Create & Download"
    };
  }
  return {
    title: "Unlock Private Profile",
    description: "Enter your recovery phrase to unlock private profile encryption.",
    submitLabel: "Unlock"
  };
}

function preferredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("pawmaq-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const initialLinkedPostId = preferredLinkedPostId();
  const initialPairingApprovalRequest = pairingApprovalFromLocation();
  const [themeMode, setThemeMode] = useState<ThemeMode>(preferredTheme);
  const [recoveryPromptRequest, setRecoveryPromptRequest] = useState<RecoveryPassphrasePromptRequest | null>(null);
  const [recoveryPromptValue, setRecoveryPromptValue] = useState<string>("");
  const [recoveryPromptError, setRecoveryPromptError] = useState<string | null>(null);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() => readSignedIn() || readSignedInProfile() !== null);
  const [signedInProfile, setSignedInProfile] = useState<StoredAuthProfile | null>(readSignedInProfile);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);
  const [guestDeviceVerifiedAtMs, setGuestDeviceVerifiedAtMs] = useState<number>(readGuestDeviceVerifiedAtMs);
  const [guestPasskeyPromptOpen, setGuestPasskeyPromptOpen] = useState(false);
  const [guestPasskeyBusy, setGuestPasskeyBusy] = useState(false);
  const [activeView, setActiveView] = useState<"feed" | "profile">("feed");
  const [activeProfileHandle, setActiveProfileHandle] = useState<string>("@guest");
  const [activeProfileName, setActiveProfileName] = useState<string>("Guest");
  const [activeTab, setActiveTab] = useState<FeedTab>(initialLinkedPostId ? "world" : preferredFeedTab);
  const [linkedPostId] = useState<string | null>(initialLinkedPostId);
  const [pairingApprovalRequest, setPairingApprovalRequest] = useState<DevicePairingApprovalRequest | null>(
    initialPairingApprovalRequest
  );
  const [pairingApprovalBusy, setPairingApprovalBusy] = useState(false);
  const [pairingApprovalMessage, setPairingApprovalMessage] = useState<string | null>(null);
  const [hasScrolledToLinkedPost, setHasScrolledToLinkedPost] = useState(false);
  const [nativeLanguage, setNativeLanguage] = useState<string>(preferredNativeLanguage);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(preferredTimeWindow);
  const [feedSortMode, setFeedSortMode] = useState<FeedSortMode>("likes");
  const [timeWindowSnapshotMs, setTimeWindowSnapshotMs] = useState<number>(() => Date.now());
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [allCountriesMode, setAllCountriesMode] = useState(true);
  const [isWorldMapExpanded, setIsWorldMapExpanded] = useState(false);
  const [worldFilterMode, setWorldFilterMode] = useState<WorldFilterMode>("all");
  const [lastSelectedCountryCode, setLastSelectedCountryCode] = useState<string | null>(readLastSelectedCountryCode);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(readSavedPostIds);
  const [followedHandles, setFollowedHandles] = useState<Set<string>>(readFollowedHandles);
  const [profileCacheByHandle, setProfileCacheByHandle] = useState<Record<string, ServerLedgerProfile>>({});
  const [ownServerProfile, setOwnServerProfile] = useState<ServerLedgerProfile | null>(readOwnServerProfileCache);
  const [profileEditorDraft, setProfileEditorDraft] = useState<ProfileEditorDraft | null>(null);
  const [profileEditorBusy, setProfileEditorBusy] = useState(false);
  const [profileEditorMessage, setProfileEditorMessage] = useState<string | null>(null);
  const [profileEditorMessageTone, setProfileEditorMessageTone] = useState<ProfileSaveMessageTone>("neutral");
  const [pendingHandleChangeSave, setPendingHandleChangeSave] = useState<PendingHandleChangeSave | null>(null);
  const [postInteractions, setPostInteractions] = useState<Record<string, PostInteractionSnapshot>>(readPostInteractions);
  const [rankingInteractionSnapshot] = useState<Record<string, PostInteractionSnapshot>>(readPostInteractions);
  const [seenPostHashes, setSeenPostHashes] = useState<Set<string>>(readSeenPostHashes);
  const [posts, setPosts] = useState<FeedPost[]>(readPersistedPosts);
  const [queuedPosts, setQueuedPosts] = useState<FeedPost[]>([]);
  const [sitePulseTone, setSitePulseTone] = useState<DotTone | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [fullscreenPostId, setFullscreenPostId] = useState<string | null>(initialLinkedPostId);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const dotButtonRefs = useRef<Record<DotTone, HTMLButtonElement | null>>({
    red: null,
    green: null,
    blue: null
  });
  const dotPulseTimeoutsRef = useRef<Record<DotTone, number | null>>({
    red: null,
    green: null,
    blue: null
  });
  const dotAudioContextRef = useRef<AudioContext | null>(null);
  const dotAudioGainRef = useRef<GainNode | null>(null);
  const sitePulseTimeoutRef = useRef<number | null>(null);
  const recoveryPromptInputRef = useRef<HTMLInputElement | null>(null);
  const recoveryPromptResolverRef = useRef<{
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  } | null>(null);
  const passkeySignInEnabled = useMemo(() => browserSupportsPasskeySignIn(), []);
  const setProfileEditorStatus = useCallback((message: string | null, tone: ProfileSaveMessageTone = "neutral") => {
    setProfileEditorMessage(message);
    setProfileEditorMessageTone(tone);
  }, []);
  const viewerHandle = isSignedIn
    ? ownServerProfile?.handle ?? fallbackHandleFromAuthProfile(signedInProfile)
    : "@guest";
  const viewerName = isSignedIn
    ? ownServerProfile?.name ?? signedInProfile?.name ?? "You"
    : "Guest";
  const followingHandles = useMemo(
    () => new Set<string>([...FOLLOWING_HANDLES, ...followedHandles]),
    [followedHandles]
  );
  const recoveryPromptContent = recoveryPromptRequest
    ? recoveryPassphrasePromptCopy(recoveryPromptRequest.mode)
    : null;
  const hydratePrivateFollowingHandles = useCallback(async () => {
    try {
      const payload = await readPrivateProfilePayload();
      if (!payload) {
        return;
      }
      const privateFollowingHandles = privateFollowingHandlesFromPayload(payload);
      if (privateFollowingHandles.length === 0) {
        return;
      }
      setFollowedHandles((current) => new Set([...current, ...privateFollowingHandles]));
    } catch {
      // Keep sign-in/session hydration resilient if private block is absent or cannot be decrypted yet.
    }
  }, []);

  const requestRecoveryPrompt = useCallback(
    (request: RecoveryPassphrasePromptRequest): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        if (recoveryPromptResolverRef.current) {
          reject(new Error("Recovery passphrase prompt already open."));
          return;
        }
        recoveryPromptResolverRef.current = { resolve, reject };
        setRecoveryPromptError(null);
        setRecoveryPromptValue(request.defaultValue ?? "");
        setRecoveryPromptRequest(request);
      }),
    []
  );

  const closeRecoveryPrompt = useCallback((error: Error | null, value?: string) => {
    const resolver = recoveryPromptResolverRef.current;
    recoveryPromptResolverRef.current = null;
    setRecoveryPromptRequest(null);
    setRecoveryPromptValue("");
    setRecoveryPromptError(null);
    if (!resolver) {
      return;
    }
    if (error) {
      resolver.reject(error);
      return;
    }
    resolver.resolve((value ?? "").trim());
  }, []);

  const clearSignedInState = useCallback((nextAuthMessage: string | null = null) => {
    clearCachedMasterKey();
    const nowMs = Date.now();
    setIsSignedIn(false);
    setSignedInProfile(null);
    setOwnServerProfile(null);
    setProfileEditorDraft(null);
    setProfileEditorMessage(null);
    setProfileEditorMessageTone("neutral");
    setProfileEditorBusy(false);
    setGuestPasskeyPromptOpen(false);
    setGuestPasskeyBusy(false);
    setGuestDeviceVerifiedAtMs(nowMs);
    setFollowedHandles(readFollowedHandles());
    window.localStorage.setItem(SIGNED_IN_KEY, "0");
    writeGuestDeviceVerifiedAtMs(nowMs);
    writeSignedInProfile(null);
    writeOwnServerProfileCache(null);
    setAuthStatusMessage(nextAuthMessage);
  }, []);

  function toggleTheme() {
    const nextTheme: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(nextTheme);
    window.localStorage.setItem("pawmaq-theme", nextTheme);
  }

  function ensureDotAudioContext(): AudioContext | null {
    if (typeof window === "undefined") {
      return null;
    }
    const AudioCtor = window.AudioContext;
    if (!AudioCtor) {
      return null;
    }
    if (!dotAudioContextRef.current) {
      const context = new AudioCtor();
      const gain = context.createGain();
      gain.gain.value = 0.14;
      gain.connect(context.destination);
      dotAudioContextRef.current = context;
      dotAudioGainRef.current = gain;
    }
    const context = dotAudioContextRef.current;
    if (!context) {
      return null;
    }
    if (context.state === "suspended") {
      void context.resume().catch(() => {
        // Keep dot animation interactive even if audio resume fails.
      });
    }
    return context;
  }

  function playDotSound(tone: DotTone) {
    const context = ensureDotAudioContext();
    const outputGain = dotAudioGainRef.current;
    if (!context || !outputGain) {
      return;
    }

    const baseFrequency = tone === "red" ? 430 : tone === "green" ? 560 : 690;
    const now = context.currentTime;

    const bodyGain = context.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.26, now + 0.012);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);
    bodyGain.connect(outputGain);

    const bodyOsc = context.createOscillator();
    bodyOsc.type = "triangle";
    bodyOsc.frequency.setValueAtTime(baseFrequency, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(baseFrequency * 1.22, now + 0.18);
    bodyOsc.connect(bodyGain);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.2);

    const sparkleGain = context.createGain();
    sparkleGain.gain.setValueAtTime(0.0001, now + 0.035);
    sparkleGain.gain.exponentialRampToValueAtTime(0.14, now + 0.055);
    sparkleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    sparkleGain.connect(outputGain);

    const sparkleOsc = context.createOscillator();
    sparkleOsc.type = "sine";
    sparkleOsc.frequency.setValueAtTime(baseFrequency * 1.9, now + 0.03);
    sparkleOsc.frequency.exponentialRampToValueAtTime(baseFrequency * 2.7, now + 0.13);
    sparkleOsc.connect(sparkleGain);
    sparkleOsc.start(now + 0.03);
    sparkleOsc.stop(now + 0.15);
  }

  function pulseDot(tone: DotTone) {
    const button = dotButtonRefs.current[tone];
    if (!button) {
      return;
    }
    const existingTimeout = dotPulseTimeoutsRef.current[tone];
    if (typeof existingTimeout === "number") {
      window.clearTimeout(existingTimeout);
      dotPulseTimeoutsRef.current[tone] = null;
    }
    button.classList.remove("is-popping");
    void button.offsetWidth;
    button.classList.add("is-popping");
    dotPulseTimeoutsRef.current[tone] = window.setTimeout(() => {
      button.classList.remove("is-popping");
      dotPulseTimeoutsRef.current[tone] = null;
    }, 900);
  }

  function handleDotClick(tone: DotTone) {
    pulseDot(tone);
    const applyTone = () => {
      setSitePulseTone(tone);
      sitePulseTimeoutRef.current = window.setTimeout(() => {
        setSitePulseTone(null);
        sitePulseTimeoutRef.current = null;
      }, 3200);
    };
    if (sitePulseTimeoutRef.current !== null) {
      window.clearTimeout(sitePulseTimeoutRef.current);
      sitePulseTimeoutRef.current = null;
    }
    // Force retrigger when the same color is clicked repeatedly.
    setSitePulseTone(null);
    window.requestAnimationFrame(applyTone);
  }

  function updateNativeLanguage(language: string) {
    setNativeLanguage(language);
    window.localStorage.setItem("pawmaq-native-language", language);
  }

  const backToTop = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.scrollTo({ top: 0, left: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncFromUrl = () => {
      setFullscreenPostId(linkedPostIdFromLocation());
      setPairingApprovalRequest(pairingApprovalFromLocation());
    };
    window.addEventListener("popstate", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    if (!fullscreenPostId) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [fullscreenPostId]);

  useEffect(() => {
    if (typeof window === "undefined" || !fullscreenPostId) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePostFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreenPostId]);

  useEffect(() => {
    setRecoveryPassphrasePromptHandler(requestRecoveryPrompt);
    return () => {
      setRecoveryPassphrasePromptHandler(null);
      if (recoveryPromptResolverRef.current) {
        recoveryPromptResolverRef.current.reject(new Error("Recovery passphrase prompt canceled."));
        recoveryPromptResolverRef.current = null;
      }
    };
  }, [requestRecoveryPrompt]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const thresholdPx = 900;
    const updateVisibility = () => {
      const nextVisible = window.scrollY > thresholdPx;
      setShowBackToTop((current) => (current === nextVisible ? current : nextVisible));
    };
    updateVisibility();
    window.addEventListener("scroll", updateVisibility, { passive: true });
    return () => {
      window.removeEventListener("scroll", updateVisibility);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const tone of ["red", "green", "blue"] as const) {
        const timeoutId = dotPulseTimeoutsRef.current[tone];
        if (typeof timeoutId === "number") {
          window.clearTimeout(timeoutId);
          dotPulseTimeoutsRef.current[tone] = null;
        }
      }
      const context = dotAudioContextRef.current;
      dotAudioContextRef.current = null;
      dotAudioGainRef.current = null;
      if (sitePulseTimeoutRef.current !== null) {
        window.clearTimeout(sitePulseTimeoutRef.current);
        sitePulseTimeoutRef.current = null;
      }
      if (context) {
        void context.close().catch(() => {
          // Ignore close failures during unmount.
        });
      }
    };
  }, []);

  useEffect(() => {
    if (!recoveryPromptRequest) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      recoveryPromptInputRef.current?.focus();
      recoveryPromptInputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [recoveryPromptRequest]);

  function submitRecoveryPrompt() {
    if (!recoveryPromptRequest) {
      return;
    }
    const trimmed = recoveryPromptValue.trim();
    if (!isStrongRecoveryPhrase(trimmed)) {
      setRecoveryPromptError("Use at least 4 words and 20+ characters.");
      return;
    }
    closeRecoveryPrompt(null, trimmed);
  }

  function cancelRecoveryPrompt() {
    closeRecoveryPrompt(new Error("Recovery passphrase canceled."));
  }

  const applySignedInSession = useCallback((profile: ServerLedgerProfile, provider: StoredAuthProfile["provider"]) => {
    const authProfile: StoredAuthProfile = {
      provider,
      name: profile.name
    };
    setSignedInProfile(authProfile);
    setOwnServerProfile(profile);
    setProfileEditorDraft(draftFromServerProfile(profile));
    setProfileCacheByHandle((current) => ({
      ...current,
      [profile.handle]: profile
    }));
    setFollowedHandles(new Set(profile.followingHandles));
    setIsSignedIn(true);
    setGuestPasskeyPromptOpen(false);
    window.localStorage.setItem(SIGNED_IN_KEY, "1");
    writeSignedInProfile(authProfile);
  }, []);

  async function completePasskeyRegistrationFlow(guest: boolean): Promise<AuthSessionResponse> {
    const registrationChallenge = await requestHumanChallenge("passkey_register");
    const registrationProof = await solveHumanChallenge(registrationChallenge);
    const registrationStart = await beginPasskeyRegistration(registrationProof);
    const registrationResponse = await startRegistration({
      optionsJSON: registrationStart.options
    });
    return completePasskeyRegistration(registrationStart.challengeToken, registrationResponse, guest);
  }

  async function completePasskeyAuthenticationFlow(guest: boolean): Promise<AuthSessionResponse> {
    const authChallenge = await requestHumanChallenge("passkey_auth");
    const authProof = await solveHumanChallenge(authChallenge);
    const authStart = await beginPasskeyAuthentication(authProof);
    const authResponse = await startAuthentication({
      optionsJSON: authStart.options
    });
    return completePasskeyAuthentication(authStart.challengeToken, authResponse, guest);
  }

  async function signInWithPasskey(): Promise<boolean> {
    if (!passkeySignInEnabled) {
      setAuthStatusMessage("Passkeys are not supported in this browser.");
      return false;
    }

    let sessionCreated = false;
    try {
      setAuthStatusMessage(null);
      setAuthStatusMessage("Running anonymous human verification...");
      clearCachedMasterKey();
      const session = await completePasskeyAuthenticationFlow(false);
      sessionCreated = true;
      applySignedInSession(session.profile, "passkey");
      void ensureAccountMasterKey().catch(() => {
        // Keep sign-in successful even if private-key setup is postponed or canceled.
      });
      void hydratePrivateFollowingHandles();
      setAuthStatusMessage(`Signed in as ${session.profile.name}.`);
      return true;
    } catch (error) {
      if (sessionCreated) {
        void signOutSession().catch(() => {
          // Keep local cancellation responsive even if server sign-out fails.
        });
      }
      if (isRecoveryPhraseFlowError(error)) {
        clearSignedInState("Sign-in canceled. Recovery phrase setup is required to finish signing in.");
      } else if (isUnauthorizedApiError(error)) {
        clearSignedInState("Passkey session verification failed. Please try signing in again.");
      } else {
        clearSignedInState(passkeySignInErrorMessage(error));
      }
      return false;
    }
  }

  async function verifyGuestWithPasskey(): Promise<boolean> {
    if (!passkeySignInEnabled) {
      setAuthStatusMessage("Passkeys are not supported in this browser.");
      return false;
    }
    if (guestPasskeyBusy) {
      return false;
    }

    setGuestPasskeyBusy(true);
    try {
      setAuthStatusMessage(null);
      setAuthStatusMessage("Running anonymous human verification...");
      await completePasskeyAuthenticationFlow(true);
      const nowMs = Date.now();
      setGuestDeviceVerifiedAtMs(nowMs);
      writeGuestDeviceVerifiedAtMs(nowMs);
      setGuestPasskeyPromptOpen(false);
      setAuthStatusMessage("Guest device verification complete. Next check in 15 minutes.");
      return true;
    } catch (error) {
      setAuthStatusMessage(passkeySignInErrorMessage(error));
      return false;
    } finally {
      setGuestPasskeyBusy(false);
    }
  }

  async function createPasskeyOnDevice(): Promise<boolean> {
    if (!passkeySignInEnabled) {
      setAuthStatusMessage("Passkeys are not supported in this browser.");
      return false;
    }

    let sessionCreated = false;
    try {
      setAuthStatusMessage(null);
      setAuthStatusMessage("Creating a passkey on this device...");
      clearCachedMasterKey();
      const session = await completePasskeyRegistrationFlow(false);
      sessionCreated = true;
      applySignedInSession(session.profile, "passkey");
      void ensureAccountMasterKey().catch(() => {
        // Keep sign-in successful even if private-key setup is postponed or canceled.
      });
      void hydratePrivateFollowingHandles();
      setAuthStatusMessage(`Signed in as ${session.profile.name}.`);
      return true;
    } catch (error) {
      if (sessionCreated) {
        void signOutSession().catch(() => {
          // Keep local cancellation responsive even if server sign-out fails.
        });
      }
      if (isRecoveryPhraseFlowError(error)) {
        clearSignedInState("Sign-in canceled. Recovery phrase setup is required to finish signing in.");
      } else if (isUnauthorizedApiError(error)) {
        clearSignedInState("Passkey session verification failed. Please try signing in again.");
      } else {
        clearSignedInState(passkeySignInErrorMessage(error));
      }
      return false;
    }
  }

  async function continueAnonymously(): Promise<boolean> {
    const signedIn = await signInWithPasskey();
    if (signedIn) {
      return true;
    }
    return createPasskeyOnDevice();
  }

  async function startDevicePairingForQr(intent: DevicePairingIntent): Promise<{
    pairingId: string;
    approvalSecret: string;
    pollSecret: string;
    expiresAtMs: string;
  } | null> {
    try {
      const pairing = await startDevicePairing(intent);
      return {
        pairingId: pairing.pairingId,
        approvalSecret: pairing.approvalSecret,
        pollSecret: pairing.pollSecret,
        expiresAtMs: pairing.expiresAtMs
      };
    } catch (error) {
      setAuthStatusMessage(error instanceof Error ? error.message : "Unable to start device pairing.");
      return null;
    }
  }

  async function pollDevicePairingForQr(
    pairingId: string,
    pollSecret: string
  ): Promise<{ status: "pending" | "approved" | "consumed" | "expired"; handoffToken?: string }> {
    try {
      return await pollDevicePairing(pairingId, pollSecret);
    } catch {
      return { status: "pending" };
    }
  }

  async function completeDevicePairingForQr(
    pairingId: string,
    pollSecret: string,
    handoffToken: string
  ): Promise<boolean> {
    try {
      const session = await completeDevicePairing(pairingId, pollSecret, handoffToken);
      applySignedInSession(session.profile, "passkey");
      void ensureAccountMasterKey().catch(() => {
        // Keep sign-in successful even if private-key setup is postponed or canceled.
      });
      void hydratePrivateFollowingHandles();
      setAuthStatusMessage(`Signed in as ${session.profile.name}.`);
      return true;
    } catch (error) {
      setAuthStatusMessage(error instanceof Error ? error.message : "Unable to complete device pairing.");
      return false;
    }
  }

  function clearPairingApprovalFromUrl() {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("linkDevice");
    url.searchParams.delete("pairingId");
    url.searchParams.delete("approvalSecret");
    const query = url.searchParams.toString();
    const nextPath = `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
    window.history.replaceState({}, "", nextPath || "/");
  }

  function dismissPairingApproval() {
    clearPairingApprovalFromUrl();
    setPairingApprovalRequest(null);
    setPairingApprovalMessage(null);
  }

  async function approvePairingFromLink(): Promise<void> {
    if (!pairingApprovalRequest || pairingApprovalBusy) {
      return;
    }
    if (!isSignedIn) {
      setPairingApprovalMessage("Sign in on this phone first, then approve device linking.");
      return;
    }
    setPairingApprovalBusy(true);
    try {
      setPairingApprovalMessage("Confirm your identity on this phone...");
      const reverifiedSession = await completePasskeyAuthenticationFlow(false);
      applySignedInSession(reverifiedSession.profile, "passkey");
      setPairingApprovalMessage("Identity confirmed. Approving device link...");
      await approveDevicePairing(pairingApprovalRequest.pairingId, pairingApprovalRequest.approvalSecret);
      setPairingApprovalMessage("Device approved. You can return to your other device now.");
      window.setTimeout(() => {
        dismissPairingApproval();
      }, 1200);
    } catch (error) {
      setPairingApprovalMessage(error instanceof Error ? error.message : "Unable to approve device linking.");
    } finally {
      setPairingApprovalBusy(false);
    }
  }

  function signOut() {
    void signOutSession().catch(() => {
      // Keep local sign-out responsive even if server sign-out fails.
    });
    if (activeProfileHandle === viewerHandle) {
      setActiveProfileHandle("@guest");
      setActiveProfileName("Guest");
      setActiveView("feed");
    }
    clearSignedInState(null);
  }

  function openProfile(name: string, handle: string) {
    setActiveProfileName(name);
    setActiveProfileHandle(handle);
    setActiveView("profile");
    void (async () => {
      try {
        const profile = await fetchProfileByHandle(handle);
        if (profile) {
          setProfileCacheByHandle((current) => ({
            ...current,
            [profile.handle]: profile
          }));
        }
      } catch {
        // Keep optimistic profile fallback from current post metadata.
      }
    })();
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
  }

  function openViewerProfile() {
    openProfile(viewerName, viewerHandle);
  }

  function openPostFullscreen(postId: string) {
    setFullscreenPostId(postId);
    if (typeof window === "undefined") {
      return;
    }
    window.sessionStorage.setItem(SCROLL_TARGET_POST_KEY, postId);
    const nextUrl = `/?postId=${encodeURIComponent(postId)}#post-${postId}`;
    window.history.pushState({ postId }, "", nextUrl);
  }

  function closePostFullscreen() {
    setFullscreenPostId(null);
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("postId");
    url.searchParams.delete("post");
    url.hash = "";
    const query = url.searchParams.toString();
    const nextPath = `${url.pathname}${query.length > 0 ? `?${query}` : ""}`;
    window.history.replaceState({}, "", nextPath || "/");
  }

  function recordProfileInteraction(postId: string, action: ProfilePostInteractionAction) {
    if (!isSignedIn) {
      return;
    }
    void writeProfilePostInteraction(postId, action).catch(() => {
      // Keep interaction UX responsive even if ledger write fails.
    });
  }

  function syncPostLedgerWithInteraction(postId: string, interaction: PostInteractionSnapshot | undefined) {
    const post = posts.find((candidate) => candidate.id === postId);
    if (!post) {
      return;
    }
    void writePostToLedger(postWithEffectiveEngagement(post, interaction)).catch(() => {
      // Keep interaction UX responsive even if ledger write fails.
    });
  }

  function toggleSavedPost(postId: string) {
    const action: ProfilePostInteractionAction = savedPostIds.has(postId) ? "unsaved" : "saved";
    setSavedPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      window.localStorage.setItem("pawmaq-account-you-saved-post-ids", JSON.stringify([...next]));
      return next;
    });
    recordProfileInteraction(postId, action);
  }

  function updatePostReaction(postId: string, reaction: PostReactionState) {
    const current = postInteractions[postId];
    const nextInteraction: PostInteractionSnapshot = {
      reaction,
      reposted: current?.reposted ?? false,
      extraComments: current?.extraComments ?? 0
    };
    setPostInteractions((current) => ({
      ...current,
      [postId]: nextInteraction
    }));
    syncPostLedgerWithInteraction(postId, nextInteraction);
    if (reaction === "up") {
      recordProfileInteraction(postId, "liked");
    } else if (reaction === "down") {
      recordProfileInteraction(postId, "disliked");
    } else if (reaction === "neutral") {
      recordProfileInteraction(postId, "neutral");
    }
  }

  function togglePostRepost(postId: string) {
    const action: ProfilePostInteractionAction = postInteractions[postId]?.reposted ? "unreposted" : "reposted";
    setPostInteractions((current) => ({
      ...current,
      [postId]: {
        reaction: current[postId]?.reaction ?? null,
        reposted: !(current[postId]?.reposted ?? false),
        extraComments: current[postId]?.extraComments ?? 0
      }
    }));
    recordProfileInteraction(postId, action);
  }

  function incrementPostComments(postId: string) {
    const current = postInteractions[postId];
    const nextInteraction: PostInteractionSnapshot = {
      reaction: current?.reaction ?? null,
      reposted: current?.reposted ?? false,
      extraComments: (current?.extraComments ?? 0) + 1
    };
    setPostInteractions((current) => ({
      ...current,
      [postId]: nextInteraction
    }));
    syncPostLedgerWithInteraction(postId, nextInteraction);
    recordProfileInteraction(postId, "commented");
  }

  async function toggleFollowHandle(handle: string) {
    if (!handle || handle === viewerHandle) {
      return;
    }

    const shouldFollow = !followedHandles.has(handle);

    if (!isSignedIn) {
      setFollowedHandles((current) => {
        const next = new Set(current);
        if (shouldFollow) {
          next.add(handle);
        } else {
          next.delete(handle);
        }
        writeFollowedHandles(next);
        return next;
      });
      return;
    }

    setFollowedHandles((current) => {
      const next = new Set(current);
      if (shouldFollow) {
        next.add(handle);
      } else {
        next.delete(handle);
      }
      return next;
    });

    try {
      const updatedOwnProfile = await setFollowInLedger(handle, shouldFollow);
      setOwnServerProfile(updatedOwnProfile);
      setProfileEditorDraft((current) =>
        current
          ? {
              ...current
            }
          : draftFromServerProfile(updatedOwnProfile)
      );
      setProfileCacheByHandle((current) => ({
        ...current,
        [updatedOwnProfile.handle]: updatedOwnProfile
      }));
      setFollowedHandles(new Set(updatedOwnProfile.followingHandles));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update follow right now.";
      setAuthStatusMessage(message);
      try {
        const synced = await fetchSessionState();
        if (!synced.guest) {
          setOwnServerProfile(synced.profile);
          setFollowedHandles(new Set(synced.profile.followingHandles));
          setProfileCacheByHandle((current) => ({
            ...current,
            [synced.profile.handle]: synced.profile
          }));
        }
      } catch {
        // Ignore secondary sync failures and keep optimistic state.
      }
    }
  }

  function updateProfileDraft(field: keyof ProfileEditorDraft, value: string | boolean) {
    setProfileEditorDraft((current) =>
      current
        ? {
            ...current,
            [field]: value as never
          }
        : current
    );
    setProfileEditorStatus(null, "neutral");
  }

  async function persistOwnProfileEdits(draft: ProfileEditorDraft, previousHandle: string, previousName: string) {
    setProfileEditorBusy(true);
    setProfileEditorStatus("Saving profile…", "neutral");

    try {
      const savedProfile = await saveProfileLedgerWithRetry(draft, (attempt, maxAttempts, retryInMs) => {
        const retryInSeconds = Math.max(0.3, retryInMs / 1000);
        setProfileEditorStatus(
          `Temporary connection issue. Retrying save (${attempt}/${maxAttempts}) in ${retryInSeconds.toFixed(1)}s…`,
          "warning"
        );
      });
      setOwnServerProfile(savedProfile);
      setProfileEditorDraft(draftFromServerProfile(savedProfile));
      setProfileCacheByHandle((current) => ({
        ...current,
        [savedProfile.handle]: savedProfile
      }));
      setFollowedHandles(new Set(savedProfile.followingHandles));
      setProfileEditorStatus("Profile saved.", "success");

      if (previousHandle !== savedProfile.handle || previousName !== savedProfile.name) {
        setPosts((current) =>
          current.map((post) =>
            !post.isAnonymous && post.handle === previousHandle
              ? {
                  ...post,
                  handle: savedProfile.handle,
                  author: savedProfile.name
                }
              : post
          )
        );
      }

      if (activeProfileHandle === previousHandle || activeProfileHandle === savedProfile.handle) {
        setActiveProfileHandle(savedProfile.handle);
        setActiveProfileName(savedProfile.name);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save profile right now.";
      setProfileEditorStatus(message, "error");
    } finally {
      setProfileEditorBusy(false);
    }
  }

  function saveOwnProfileEdits() {
    if (!isSignedIn || !profileEditorDraft || profileEditorBusy) {
      return;
    }

    const previousHandle = ownServerProfile?.handle ?? viewerHandle;
    const previousName = ownServerProfile?.name ?? viewerName;
    const draft = {
      ...profileEditorDraft
    };
    const draftHandleRaw = draft.handle.trim();
    const draftHandleCandidate = draftHandleRaw.startsWith("@") ? draftHandleRaw : `@${draftHandleRaw}`;
    let normalizedDraftHandle = draftHandleCandidate.toLowerCase();
    try {
      normalizedDraftHandle = normalizeHandle(draftHandleCandidate);
    } catch {
      // Keep API-side validation path for malformed handles.
    }
    if (normalizedDraftHandle !== previousHandle) {
      setPendingHandleChangeSave({
        draft,
        previousHandle,
        previousName
      });
      return;
    }
    void persistOwnProfileEdits(draft, previousHandle, previousName);
  }

  function cancelPendingHandleChangeSave() {
    setPendingHandleChangeSave(null);
    setProfileEditorStatus("Handle update canceled.", "neutral");
  }

  function confirmPendingHandleChangeSave() {
    if (!pendingHandleChangeSave || profileEditorBusy) {
      return;
    }
    const pending = pendingHandleChangeSave;
    setPendingHandleChangeSave(null);
    void persistOwnProfileEdits(pending.draft, pending.previousHandle, pending.previousName);
  }

  function publishPost(payload: {
    caption: string;
    countryCode: string;
    countryName: string;
    videoUrl?: string;
    mediaType?: "video" | "gif" | "png";
    originalLanguage?: string;
    anonymous?: boolean;
  }) {
    if (!isSignedIn) {
      return;
    }
    const isAnonymous = payload.anonymous === true;
    const newPost: FeedPost = {
      id: `post-${crypto.randomUUID()}`,
      author: isAnonymous ? "Anonymous" : viewerName,
      handle: isAnonymous ? "@anonymous" : viewerHandle,
      isAnonymous,
      anonymousKey: isAnonymous ? `anon_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}` : undefined,
      caption: payload.caption,
      countryCode: payload.countryCode,
      countryName: payload.countryName,
      createdAt: "just now",
      createdAtHoursAgo: 0,
      createdAtMs: Date.now(),
      originalLanguage: payload.originalLanguage ?? nativeLanguage,
      videoUrl: payload.videoUrl,
      mediaType: payload.mediaType,
      likes: 0,
      comments: 0,
      reposts: 0,
      views: 0,
      upvotes: 0,
      neutralVotes: 0,
      downvotes: 0
    };
    setPosts((prev) => [newPost, ...prev]);
    void writePostToLedger(newPost).catch(() => {
      // Keep publishing non-blocking even if ledger write is unavailable.
    });
    if (isSignedIn && !isAnonymous) {
      void recordCreatedPostForProfile(newPost.id)
        .then((updatedProfile) => {
          setOwnServerProfile(updatedProfile);
          setProfileCacheByHandle((current) => ({
            ...current,
            [updatedProfile.handle]: updatedProfile
          }));
        })
        .catch(() => {
          // Keep publish flow non-blocking if profile ledger update fails.
        });
    }
    setQueuedPosts([]);
    setActiveTab("following");
    setActiveView("feed");
  }

  function handleCountryFilterChange(countryCode: string) {
    setCountryFilter(countryCode);
    if (countryCode !== "all") {
      setAllCountriesMode(false);
      setLastSelectedCountryCode(countryCode);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_SELECTED_COUNTRY_KEY, countryCode);
      }
    } else {
      setAllCountriesMode(true);
      setWorldFilterMode("all");
    }
  }

  function toggleGlobeFilterMode() {
    const fallbackCountryCode =
      (lastSelectedCountryCode && /^[A-Z]{2}$/.test(lastSelectedCountryCode) ? lastSelectedCountryCode : null) ??
      worldSupportData[0]?.iso2 ??
      "US";

    if (allCountriesMode || countryFilter === "all" || countryFilter === ANONYMOUS_COUNTRY_FILTER) {
      handleCountryFilterChange(fallbackCountryCode);
      setWorldFilterMode("globe");
      setIsWorldMapExpanded(true);
      return;
    }

    setWorldFilterMode("globe");
    setIsWorldMapExpanded((current) => !current);
  }

  function selectTimeWindow(nextWindow: TimeWindow) {
    setTimeWindow(nextWindow);
    setTimeWindowSnapshotMs(Date.now());
    if (typeof window !== "undefined") {
      window.localStorage.setItem(TIME_WINDOW_STORAGE_KEY, nextWindow);
    }
  }

  function handleTabChange(nextTab: FeedTab) {
    if (nextTab === activeTab) {
      return;
    }
    if (nextTab === "world") {
      // Entering World should default to a broad view so imported posts are visible immediately.
      setCountryFilter("all");
      setAllCountriesMode(true);
      setWorldFilterMode("all");
      setIsWorldMapExpanded(false);
    }
    if (activeTab === "world" && nextTab === "following" && typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    if (nextTab !== "world") {
      setIsWorldMapExpanded(false);
    }
    setActiveView("feed");
    setActiveTab(nextTab);
  }

  const countryNamesByCode = useMemo(
    () => isoCountries.getNames("en", { select: "official" }) as Record<string, string>,
    []
  );

  function pickRandomWorldCountry() {
    const countryCodes = Object.keys(countryNamesByCode).filter((code) => /^[A-Z]{2}$/.test(code));
    if (countryCodes.length === 0) {
      return;
    }
    const currentCode = countryFilter === "all" ? null : countryFilter;
    const pool = countryCodes.length > 1 && currentCode
      ? countryCodes.filter((code) => code !== currentCode)
      : countryCodes;
    const randomCode = pool[Math.floor(Math.random() * pool.length)] ?? countryCodes[0]!;
    handleCountryFilterChange(randomCode);
  }

  const activeCountryFilterLabel = useMemo(() => {
    if (countryFilter === "all") {
      return "All countries";
    }
    if (countryFilter === ANONYMOUS_COUNTRY_FILTER) {
      return "Anonymous location";
    }
    return (
      countryNamesByCode[countryFilter] ??
      worldSupportData.find((country) => country.iso2 === countryFilter)?.country ??
      countryFilter
    );
  }, [countryFilter, countryNamesByCode]);

  const worldMapActivityRatioByIso = useMemo(() => {
    const populationByIso = new Map(worldSupportData.map((country) => [country.iso2, country.population]));
    const totalsByIso = new Map<string, { postCount: number; likeCount: number }>();

    for (const post of posts) {
      const iso2 = post.countryCode.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(iso2)) {
        continue;
      }
      const entry = totalsByIso.get(iso2) ?? { postCount: 0, likeCount: 0 };
      entry.postCount += 1;
      entry.likeCount += Math.max(0, post.upvotes);
      totalsByIso.set(iso2, entry);
    }

    const perMillionScoreByIso = new Map<string, number>();
    let maxScore = 0;
    for (const [iso2, totals] of totalsByIso) {
      const population = populationByIso.get(iso2);
      if (!population || population <= 0) {
        continue;
      }
      const combinedActivity = totals.postCount + totals.likeCount;
      const perMillionScore = (combinedActivity / population) * 1_000_000;
      perMillionScoreByIso.set(iso2, perMillionScore);
      if (perMillionScore > maxScore) {
        maxScore = perMillionScore;
      }
    }

    const ratioByIso: Record<string, number> = {};
    if (maxScore <= 0) {
      return ratioByIso;
    }
    for (const [iso2, score] of perMillionScoreByIso) {
      ratioByIso[iso2] = Math.min(1, Math.max(0, score / maxScore));
    }
    return ratioByIso;
  }, [posts]);

  const rankedCandidates = useMemo(() => {
    const targetPost = linkedPostId ? posts.find((post) => post.id === linkedPostId) : undefined;
    const filteredByTime = posts.filter((post) =>
      isPostInTimeWindow(post, timeWindow, timeWindowSnapshotMs)
    );
    const savedTabFiltered =
      activeTab === "saved"
        ? filteredByTime.filter((post) => savedPostIds.has(post.id))
        : filteredByTime;
    const maybeCountryFiltered =
      activeTab === "world" && countryFilter !== "all"
        ? savedTabFiltered.filter((post) => post.countryCode === countryFilter)
        : savedTabFiltered;

    let basePosts: FeedPost[];
    if (activeTab === "following") {
      const followedOnly = maybeCountryFiltered.filter((post) => followingHandles.has(post.handle));
      basePosts = followedOnly;
    } else if (activeTab === "saved") {
      basePosts = savedTabFiltered;
    } else {
      basePosts = maybeCountryFiltered;
    }

    const deduped = uniquePosts(basePosts);
    const withTargetPost =
      targetPost && !deduped.some((post) => post.id === targetPost.id)
        ? [targetPost, ...deduped]
        : deduped;

    return [...withTargetPost].sort((left, right) => {
      const leftInteraction = rankingInteractionSnapshot[left.id];
      const rightInteraction = rankingInteractionSnapshot[right.id];
      const leftEngagement = postEngagementWithInteraction(left, leftInteraction);
      const rightEngagement = postEngagementWithInteraction(right, rightInteraction);
      const leftScore =
        feedSortMode === "approval"
          ? postApprovalScore(left, leftInteraction)
          : postLikeScore(left, leftInteraction);
      const rightScore =
        feedSortMode === "approval"
          ? postApprovalScore(right, rightInteraction)
          : postLikeScore(right, rightInteraction);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      if (feedSortMode === "approval" && leftEngagement.upvotes !== rightEngagement.upvotes) {
        return rightEngagement.upvotes - leftEngagement.upvotes;
      }
      if (leftEngagement.downvotes !== rightEngagement.downvotes) {
        return leftEngagement.downvotes - rightEngagement.downvotes;
      }
      return right.createdAtMs - left.createdAtMs;
    });
  }, [
    activeTab,
    posts,
    timeWindow,
    feedSortMode,
    timeWindowSnapshotMs,
    linkedPostId,
    countryFilter,
    savedPostIds,
    rankingInteractionSnapshot,
    followingHandles,
    viewerHandle
  ]);

  const visibleQueuedPosts = useMemo(() => {
    const visibleIds = new Set(queuedPosts.map((post) => post.id));
    return rankedCandidates.filter((post) => visibleIds.has(post.id));
  }, [queuedPosts, rankedCandidates]);

  const feedContextKey = useMemo(
    () =>
      `${activeTab}|${timeWindow}|${feedSortMode}|${timeWindowSnapshotMs}|${activeTab === "world" ? countryFilter : "all"}`,
    [activeTab, timeWindow, feedSortMode, timeWindowSnapshotMs, countryFilter]
  );

  const loadMorePosts = useCallback(() => {
    setQueuedPosts((current) => {
      const currentIds = new Set(current.map((post) => post.id));
      const isSavedTab = activeTab === "saved";
      const unseenCandidates = rankedCandidates.filter((post) => {
        if (currentIds.has(post.id)) {
          return false;
        }
        if (linkedPostId && post.id === linkedPostId) {
          return true;
        }
        if (isSavedTab) {
          return true;
        }
        return !seenPostHashes.has(postIdentifierHash(post));
      });
      let nextBatch = unseenCandidates.slice(0, LOAD_BATCH_SIZE);
      if (linkedPostId && !currentIds.has(linkedPostId)) {
        const targetPost = unseenCandidates.find((post) => post.id === linkedPostId);
        if (targetPost && !nextBatch.some((post) => post.id === linkedPostId)) {
          nextBatch = [targetPost, ...nextBatch.slice(0, Math.max(0, LOAD_BATCH_SIZE - 1))];
        }
      }

      if (nextBatch.length === 0) {
        if (current.length === 0 && rankedCandidates.length > 0) {
          // Fallback so feed does not render blank when every candidate is already marked as seen.
          nextBatch = rankedCandidates.slice(0, LOAD_BATCH_SIZE);
        } else {
          return current;
        }
      }

      if (nextBatch.length > 0 && !isSavedTab) {
        setSeenPostHashes((existing) => {
          const next = new Set(existing);
          for (const post of nextBatch) {
            next.add(postIdentifierHash(post));
            recordProfileInteraction(post.id, "seen");
          }
          writeSeenPostHashes(next);
          return next;
        });
      }

      return [...current, ...nextBatch];
    });
  }, [activeTab, rankedCandidates, linkedPostId, seenPostHashes, isSignedIn]);

  useEffect(() => {
    setQueuedPosts([]);
    setSeenPostHashes(new Set());
    writeSeenPostHashes(new Set());
  }, [feedContextKey]);

  useEffect(() => {
    if (queuedPosts.length === 0) {
      loadMorePosts();
    }
  }, [queuedPosts.length, loadMorePosts]);

  useEffect(() => {
    if (!linkedPostId) {
      return;
    }
    setHasScrolledToLinkedPost(false);
    setActiveView("feed");
    setActiveTab("world");
    setCountryFilter("all");
    setAllCountriesMode(true);
    setWorldFilterMode("all");
    setIsWorldMapExpanded(false);
  }, [linkedPostId]);

  useEffect(() => {
    if (typeof window === "undefined" || !linkedPostId || !("scrollRestoration" in window.history)) {
      return;
    }
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, [linkedPostId]);

  useEffect(() => {
    if (!linkedPostId || hasScrolledToLinkedPost || activeView !== "feed") {
      return;
    }
    const targetRankIndex = rankedCandidates.findIndex((post) => post.id === linkedPostId);
    if (targetRankIndex === -1) {
      return;
    }
    if (visibleQueuedPosts.length <= targetRankIndex) {
      setQueuedPosts((current) => {
        const requiredCount = Math.max(LOAD_BATCH_SIZE, targetRankIndex + 1);
        if (current.length >= requiredCount) {
          return current;
        }
        return rankedCandidates.slice(0, requiredCount);
      });
      return;
    }
    const targetElement = document.getElementById(`post-${linkedPostId}`);
    if (!targetElement) {
      return;
    }

    const alignToTarget = () => {
      const refreshedTarget = document.getElementById(`post-${linkedPostId}`);
      if (!refreshedTarget) {
        return;
      }
      const scrollTop =
        window.scrollY + refreshedTarget.getBoundingClientRect().top - window.innerHeight * 0.3;
      window.scrollTo({ top: Math.max(0, scrollTop), left: 0, behavior: "auto" });
    };

    alignToTarget();
    const rafId = window.requestAnimationFrame(() => {
      alignToTarget();
    });
    const timeoutId = window.setTimeout(() => {
      alignToTarget();
    }, 220);

    setHasScrolledToLinkedPost(true);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(SCROLL_TARGET_POST_KEY);
    }
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [linkedPostId, hasScrolledToLinkedPost, activeView, rankedCandidates, visibleQueuedPosts.length]);

  useEffect(() => {
    writePersistedPosts(posts);
  }, [posts]);

  useEffect(() => {
    let canceled = false;

    async function syncLedgerPosts() {
      try {
        const ledgerPosts = await fetchLedgerPostsFromApi();
        if (canceled || ledgerPosts.length === 0) {
          return;
        }
        setPosts((current) => uniquePosts([...current, ...ledgerPosts]).sort((left, right) => right.createdAtMs - left.createdAtMs));
      } catch {
        // Keep feed usable with local persisted posts when ledger API is unavailable.
      }
    }

    void syncLedgerPosts();
    const intervalId = window.setInterval(() => {
      void syncLedgerPosts();
    }, 45_000);

    const onFocus = () => {
      void syncLedgerPosts();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    writeOwnServerProfileCache(ownServerProfile);
  }, [ownServerProfile]);

  useEffect(() => {
    if (!isSignedIn || !ownServerProfile) {
      return;
    }
    setProfileEditorDraft((current) => current ?? draftFromServerProfile(ownServerProfile));
  }, [isSignedIn, ownServerProfile]);

  useEffect(() => {
    writePostInteractions(postInteractions);
  }, [postInteractions]);

  useEffect(() => {
    if (!sessionHydrated || !isSignedIn || !ownServerProfile) {
      return;
    }
    const followingHandlesList = normalizeHandleList([...followedHandles]).sort((left, right) =>
      left.localeCompare(right)
    );
    const savedPostIdsList = [...savedPostIds].sort((left, right) => left.localeCompare(right));
    const payload = {
      schema: "v1",
      updatedAt: new Date().toISOString(),
      userPreferences: {
        nativeLanguage,
        feedSortMode,
        timeWindow,
        activeTab,
        savedOnly: activeTab === "saved",
        followingHandles: followingHandlesList,
        savedPostIds: savedPostIdsList
      },
      privateSocialGraph: {
        followingHandles: followingHandlesList
      },
      interactions: {
        savedPostIds: savedPostIdsList
      }
    };
    void writePrivateProfileEncryptedBlock(payload).catch(() => {
      // Keep the feed responsive even if encrypted private block sync fails.
    });
  }, [
    sessionHydrated,
    isSignedIn,
    ownServerProfile,
    nativeLanguage,
    feedSortMode,
    timeWindow,
    activeTab,
    followedHandles,
    savedPostIds
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(FEED_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    writeGuestDeviceVerifiedAtMs(guestDeviceVerifiedAtMs);
  }, [guestDeviceVerifiedAtMs]);

  useEffect(() => {
    if (!sessionHydrated || isSignedIn || !passkeySignInEnabled) {
      setGuestPasskeyPromptOpen(false);
      return;
    }
    const check = () => {
      const elapsedMs = Date.now() - guestDeviceVerifiedAtMs;
      if (elapsedMs >= GUEST_PASSKEY_REAUTH_INTERVAL_MS) {
        setGuestPasskeyPromptOpen(true);
      }
    };
    check();
    const intervalId = window.setInterval(check, 15_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [sessionHydrated, isSignedIn, passkeySignInEnabled, guestDeviceVerifiedAtMs]);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMorePosts();
        }
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMorePosts]);

  useEffect(() => {
    let isCancelled = false;

    void (async () => {
      try {
        const session = await fetchSessionState();
        if (isCancelled) {
          return;
        }
        if (session.guest === true) {
          setIsSignedIn(false);
          setSignedInProfile(null);
          setOwnServerProfile(null);
          setProfileEditorDraft(null);
          window.localStorage.setItem(SIGNED_IN_KEY, "0");
          writeSignedInProfile(null);
        } else {
          applySignedInSession(session.profile, "passkey");
          setProfileEditorDraft((current) => current ?? draftFromServerProfile(session.profile));
          void ensureAccountMasterKey().catch(() => {
            // Keep session restoration resilient if passphrase entry is skipped.
          });
          void hydratePrivateFollowingHandles();
        }
        setSessionHydrated(true);
      } catch (error) {
        if (isCancelled) {
          return;
        }
        void signOutSession().catch(() => {
          // Keep local state clear even if server sign-out fails.
        });
        if (isRecoveryPhraseFlowError(error)) {
          clearSignedInState("Sign-in canceled. Recovery phrase setup is required to finish signing in.");
        } else if (isUnauthorizedApiError(error)) {
          clearSignedInState(null);
        } else {
          clearSignedInState(null);
        }
        setSessionHydrated(true);
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [applySignedInSession, clearSignedInState, hydratePrivateFollowingHandles]);

  useEffect(() => {
    if (!sessionHydrated || !isSignedIn) {
      return;
    }
    let canceled = false;
    const intervalId = window.setInterval(() => {
      void (async () => {
        try {
          const session = await fetchSessionState();
          if (canceled) {
            return;
          }
          if (session.guest === true) {
            clearSignedInState("Session expired. Please sign in again.");
            return;
          }
          setOwnServerProfile(session.profile);
          setProfileCacheByHandle((current) => ({
            ...current,
            [session.profile.handle]: session.profile
          }));
        } catch (error) {
          if (canceled) {
            return;
          }
          if (isUnauthorizedApiError(error)) {
            clearSignedInState("Session expired. Please sign in again.");
          }
        }
      })();
    }, 120_000);

    return () => {
      canceled = true;
      window.clearInterval(intervalId);
    };
  }, [clearSignedInState, isSignedIn, sessionHydrated]);

  useEffect(() => {
    if (!isSignedIn || followedHandles.size === 0) {
      return;
    }
    let canceled = false;
    const missing = [...followedHandles].filter((handle) => !profileCacheByHandle[handle]);
    if (missing.length === 0) {
      return;
    }
    void (async () => {
      const results = await Promise.all(
        missing.map(async (handle) => {
          try {
            const profile = await fetchProfileByHandle(handle);
            return profile;
          } catch {
            return null;
          }
        })
      );
      if (canceled) {
        return;
      }
      const updates = results.filter((profile): profile is ServerLedgerProfile => Boolean(profile));
      if (updates.length === 0) {
        return;
      }
      setProfileCacheByHandle((current) => {
        const next = { ...current };
        for (const profile of updates) {
          next[profile.handle] = profile;
        }
        return next;
      });
    })();
    return () => {
      canceled = true;
    };
  }, [isSignedIn, followedHandles, profileCacheByHandle]);

  useEffect(() => {
    if (!isSignedIn || !ownServerProfile) {
      return;
    }
    if (activeProfileHandle === "@you") {
      setActiveProfileHandle(ownServerProfile.handle);
      setActiveProfileName(ownServerProfile.name);
    }
  }, [isSignedIn, ownServerProfile, activeProfileHandle]);

  useEffect(() => {
    if (!ownServerProfile) {
      return;
    }
    setPosts((current) =>
      current.map((post) =>
        post.handle === "@you"
          ? {
              ...post,
              handle: ownServerProfile.handle,
              author: ownServerProfile.name
            }
          : post
      )
    );
  }, [ownServerProfile]);

  useEffect(() => {
    if (!isSignedIn && activeProfileHandle === "@you") {
      setActiveProfileHandle("@guest");
      setActiveProfileName("Guest");
    }
  }, [isSignedIn, activeProfileHandle]);

  const activeProfileIsOwn = activeProfileHandle === viewerHandle;
  const activeLedgerProfile = activeProfileIsOwn
    ? ownServerProfile
    : profileCacheByHandle[activeProfileHandle] ?? null;
  const activeProfilePosts = useMemo(
    () => {
      if (activeLedgerProfile) {
        const postIds = new Set(activeLedgerProfile.posts);
        return uniquePosts(posts.filter((post) => !post.isAnonymous && postIds.has(post.id))).sort(
          (left, right) => right.createdAtMs - left.createdAtMs
        );
      }
      if (activeProfileIsOwn) {
        return [];
      }
      return uniquePosts(posts.filter((post) => !post.isAnonymous && post.handle === activeProfileHandle)).sort(
        (left, right) => right.createdAtMs - left.createdAtMs
      );
    },
    [posts, activeProfileHandle, activeProfileIsOwn, activeLedgerProfile]
  );
  const activeProfileLatestPost = activeProfilePosts[0];
  const activeProfileResolvedName =
    activeLedgerProfile?.name ||
    activeProfileName ||
    activeProfileLatestPost?.author ||
    (activeProfileHandle.startsWith("@")
      ? activeProfileHandle.slice(1)
      : activeProfileHandle);
  const activeProfileResolvedHandle = activeLedgerProfile?.handle ?? activeProfileHandle;
  const activeProfileIsFollowing = followedHandles.has(activeProfileResolvedHandle);
  const activeProfileFollowingProfiles = useMemo<FollowingProfileSummary[]>(() => {
    if (!activeProfileIsOwn) {
      return [];
    }
    const handles = normalizeHandleList([...followedHandles]).sort((left, right) => left.localeCompare(right));
    return handles.map((handle) => {
      const profile = profileCacheByHandle[handle];
      const latestPostFromHandle = posts.find((post) => !post.isAnonymous && post.handle === handle);
      const fallbackName = handle.replace(/^@+/, "") || "member";
      return {
        handle,
        name: profile?.name || latestPostFromHandle?.author || fallbackName,
        avatarUrl: profile?.avatarUrl || undefined
      };
    });
  }, [activeProfileIsOwn, followedHandles, profileCacheByHandle, posts]);
  const activeProfileFollowersCount = activeLedgerProfile
    ? activeLedgerProfile.followerCount
    : syntheticCountFromHandle(`${activeProfileHandle}:followers`, 200, 9800) +
      (activeProfileIsFollowing ? 1 : 0);
  const activeProfileFollowingCount = activeProfileIsOwn
    ? activeLedgerProfile?.followingCount ?? followedHandles.size
    : activeLedgerProfile?.followingCount ??
      syntheticCountFromHandle(`${activeProfileHandle}:following`, 40, 1800);
  const activeProfileBio = activeProfileIsOwn
    ? activeLedgerProfile?.bio || "Your profile. Share clips, follow creators, and track your posts."
    : activeLedgerProfile?.bio ||
      `Follow ${activeProfileResolvedName} to keep their posts in your Following feed.`;
  const activeProfileLocation = activeLedgerProfile?.location || activeProfileLatestPost?.countryName || null;
  const fullscreenPost = useMemo(
    () =>
      fullscreenPostId
        ? posts.find((post) => post.id === fullscreenPostId) ??
          visibleQueuedPosts.find((post) => post.id === fullscreenPostId) ??
          activeProfilePosts.find((post) => post.id === fullscreenPostId) ??
          null
        : null,
    [fullscreenPostId, posts, visibleQueuedPosts, activeProfilePosts]
  );
  const activeProfileBannerUrl = activeLedgerProfile?.bannerUrl || activeProfileLatestPost?.posterUrl;
  const activeProfileAvatarUrl = activeLedgerProfile?.avatarUrl;
  const activeProfileUsername = activeLedgerProfile?.username || activeProfileResolvedName.toLowerCase();

  return (
    <div className={`app-shell mode-${themeMode}${sitePulseTone ? ` is-rgb-${sitePulseTone}` : ""}`}>
      <header className="top-bar reveal">
        <div>
          <p className="top-bar__title">Pawmaq Feed</p>
          <p className="top-bar__subtitle">Privacy first, anonymous open-source social media site</p>
        </div>
        <div className="top-bar__center-dots" role="group" aria-label="Color controls">
          <button
            type="button"
            className="top-bar__dot-button top-bar__dot-button--red"
            aria-label="Red dot"
            ref={(node) => {
              dotButtonRefs.current.red = node;
            }}
            onClick={() => handleDotClick("red")}
          >
            <span className="top-bar__dot top-bar__dot--red" />
          </button>
          <button
            type="button"
            className="top-bar__dot-button top-bar__dot-button--green"
            aria-label="Green dot"
            ref={(node) => {
              dotButtonRefs.current.green = node;
            }}
            onClick={() => handleDotClick("green")}
          >
            <span className="top-bar__dot top-bar__dot--green" />
          </button>
          <button
            type="button"
            className="top-bar__dot-button top-bar__dot-button--blue"
            aria-label="Blue dot"
            ref={(node) => {
              dotButtonRefs.current.blue = node;
            }}
            onClick={() => handleDotClick("blue")}
          >
            <span className="top-bar__dot top-bar__dot--blue" />
          </button>
        </div>
        <div className="top-bar__actions">
          <ThemeToggle mode={themeMode} onToggle={toggleTheme} />
          <AccountMenu
            mode={themeMode}
            isSignedIn={isSignedIn}
            signedInProfile={signedInProfile}
            onSignOut={signOut}
            onSignInWithPasskey={signInWithPasskey}
            onCreatePasskeyOnDevice={createPasskeyOnDevice}
            onStartDevicePairing={startDevicePairingForQr}
            onPollDevicePairing={pollDevicePairingForQr}
            onCompleteDevicePairing={completeDevicePairingForQr}
            passkeySignInEnabled={passkeySignInEnabled}
            authStatusMessage={authStatusMessage}
            onOpenProfile={openViewerProfile}
            profileButtonLabel={viewerName}
          />
        </div>
      </header>

      <div className="layout-grid">
        <SideNav activeTab={activeTab} onTabChange={handleTabChange} />

        <main className="main-column">
          {activeView === "profile" ? (
            <>
              <ProfilePage
                profileName={activeProfileResolvedName}
                profileUsername={activeProfileUsername}
                profileHandle={activeProfileResolvedHandle}
                profileBio={activeProfileBio}
                profileLocation={activeProfileLocation}
                profileAvatarUrl={activeProfileAvatarUrl}
                profileBannerUrl={activeProfileBannerUrl}
                postsCount={Math.max(activeLedgerProfile?.posts.length ?? 0, activeProfilePosts.length)}
                followersCount={activeProfileFollowersCount}
                followingCount={activeProfileFollowingCount}
                followingProfiles={activeProfileFollowingProfiles}
                isOwnProfile={activeProfileIsOwn}
                isFollowing={activeProfileIsFollowing}
                onBackToFeed={() => setActiveView("feed")}
                onSignOut={signOut}
                onToggleFollow={() => void toggleFollowHandle(activeProfileResolvedHandle)}
                onOpenFollowingProfile={(handle, name) => openProfile(name, handle)}
                profileEditorDraft={activeProfileIsOwn ? profileEditorDraft : null}
                profileEditorBusy={profileEditorBusy}
                profileEditorMessage={profileEditorMessage}
                profileEditorMessageTone={profileEditorMessageTone}
                nativeLanguage={nativeLanguage}
                onNativeLanguageChange={updateNativeLanguage}
                feedSortMode={feedSortMode}
                onFeedSortModeChange={setFeedSortMode}
                onProfileFieldChange={(field, value) => updateProfileDraft(field, value)}
                onSaveProfile={() => void saveOwnProfileEdits()}
              />
              <section className="feed-list">
                {activeProfilePosts.length === 0 ? (
                  <div className="panel profile-page__empty">No posts from this profile yet.</div>
                ) : (
                  activeProfilePosts.map((post) => (
                    <FeedCard
                      key={post.id}
                      post={post}
                      nativeLanguage={nativeLanguage}
                      isSaved={savedPostIds.has(post.id)}
                      onToggleSave={toggleSavedPost}
                      onOpenPost={openPostFullscreen}
                      isSignedIn={isSignedIn}
                      onSignInWithPasskey={signInWithPasskey}
                      onCreatePasskeyOnDevice={createPasskeyOnDevice}
                      passkeySignInEnabled={passkeySignInEnabled}
                      viewerHandle={viewerHandle}
                      onOpenAuthorProfile={openProfile}
                      reactionState={postInteractions[post.id]?.reaction ?? null}
                      isReposted={postInteractions[post.id]?.reposted ?? false}
                      extraComments={postInteractions[post.id]?.extraComments ?? 0}
                      onReactionChange={updatePostReaction}
                      onToggleRepost={togglePostRepost}
                      onCommentCountIncrement={incrementPostComments}
                    />
                  ))
                )}
              </section>
            </>
          ) : (
            <>
              <section className="feed-tools reveal">
                <button
                  type="button"
                  className={`feed-tools__chip feed-tools__chip--time feed-tools__chip--tw-10m ${timeWindow === "10m" ? "is-active" : ""}`}
                  onClick={() => selectTimeWindow("10m")}
                >
                  10 min
                </button>
                <button
                  type="button"
                  className={`feed-tools__chip feed-tools__chip--time feed-tools__chip--tw-1h ${timeWindow === "1h" ? "is-active" : ""}`}
                  onClick={() => selectTimeWindow("1h")}
                >
                  1 hr
                </button>
                <div className="feed-tools__window">
                  {TIME_WINDOW_CHOICES.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      className={`feed-tools__chip feed-tools__chip--time feed-tools__chip--tw-${key} ${key === "24h" ? "feed-tools__chip--priority" : ""} ${timeWindow === key ? "is-active" : ""}`}
                      onClick={() => selectTimeWindow(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </section>

              <VideoComposer
                countries={worldSupportData}
                onPublish={publishPost}
                isSignedIn={isSignedIn}
                onSignInWithPasskey={signInWithPasskey}
                onCreatePasskeyOnDevice={createPasskeyOnDevice}
                passkeySignInEnabled={passkeySignInEnabled}
              />

              {activeTab === "world" ? (
                <section className="world-filter panel reveal" role="status" aria-live="polite">
                  <div className="world-filter__top">
                    <span className="world-filter__label">World filter</span>
                    <strong className="world-filter__country">{activeCountryFilterLabel}</strong>
                    <span className="world-filter__hint">
                      {allCountriesMode
                        ? "Showing content from every country."
                        : countryFilter === ANONYMOUS_COUNTRY_FILTER
                          ? "Showing posts where the author chose anonymous location."
                        : "You are viewing posts only from this country."}
                    </span>
                  </div>
                  <div className="world-filter__controls">
                    <button
                      type="button"
                      className={worldFilterMode === "all" ? "world-filter__chip is-active" : "world-filter__chip"}
                      onClick={() => {
                        handleCountryFilterChange("all");
                        setWorldFilterMode("all");
                        setIsWorldMapExpanded(false);
                      }}
                    >
                      All countries
                    </button>
                    <button
                      type="button"
                      className={worldFilterMode === "globe" ? "world-filter__chip is-active" : "world-filter__chip"}
                      onClick={toggleGlobeFilterMode}
                      aria-expanded={isWorldMapExpanded}
                    >
                      Globe
                    </button>
                    <button
                      type="button"
                      className={worldFilterMode === "random" ? "world-filter__chip is-active" : "world-filter__chip"}
                      onClick={() => {
                        pickRandomWorldCountry();
                        setWorldFilterMode("random");
                        setIsWorldMapExpanded(false);
                      }}
                    >
                      Random country
                    </button>
                    <button
                      type="button"
                      className={worldFilterMode === "anonymous" ? "world-filter__chip is-active" : "world-filter__chip"}
                      onClick={() => {
                        handleCountryFilterChange(ANONYMOUS_COUNTRY_FILTER);
                        setWorldFilterMode("anonymous");
                        setIsWorldMapExpanded(false);
                      }}
                    >
                      Anonymous
                    </button>
                  </div>
                  {isWorldMapExpanded ? (
                    allCountriesMode ? (
                      <p className="world-map__collapsed-note">Turn off "All countries" to filter from the map.</p>
                    ) : (
                      <WorldSupportMap
                        countries={worldSupportData}
                        activityRatioByIso={worldMapActivityRatioByIso}
                        selectedCountryCode={/^[A-Z]{2}$/.test(countryFilter) ? countryFilter : null}
                        onCountrySelect={(code) => {
                          handleCountryFilterChange(code);
                          setWorldFilterMode("globe");
                          setIsWorldMapExpanded(false);
                        }}
                      />
                    )
                  ) : null}
                </section>
              ) : null}

              <section className="feed-list">
                {visibleQueuedPosts.length === 0 ? (
                  <div className="panel profile-page__empty">No posts yet.</div>
                ) : (
                  visibleQueuedPosts.map((post) => (
                    <FeedCard
                      key={post.id}
                      post={post}
                      nativeLanguage={nativeLanguage}
                      isSaved={savedPostIds.has(post.id)}
                      onToggleSave={toggleSavedPost}
                      onOpenPost={openPostFullscreen}
                      isSignedIn={isSignedIn}
                      onSignInWithPasskey={signInWithPasskey}
                      onCreatePasskeyOnDevice={createPasskeyOnDevice}
                      passkeySignInEnabled={passkeySignInEnabled}
                      viewerHandle={viewerHandle}
                      onOpenAuthorProfile={openProfile}
                      reactionState={postInteractions[post.id]?.reaction ?? null}
                      isReposted={postInteractions[post.id]?.reposted ?? false}
                      extraComments={postInteractions[post.id]?.extraComments ?? 0}
                      onReactionChange={updatePostReaction}
                      onToggleRepost={togglePostRepost}
                      onCommentCountIncrement={incrementPostComments}
                    />
                  ))
                )}
                <div className="feed-end-sentinel" ref={loadMoreRef} />
              </section>
            </>
          )}
        </main>

        <RightRail />
      </div>

      {fullscreenPost ? (
        <section className="post-fullscreen" role="dialog" aria-modal="true" aria-label="Post fullscreen view">
          <div className="post-fullscreen__shell">
            <header className="post-fullscreen__topbar">
              <button
                type="button"
                className="post-fullscreen__back"
                onClick={closePostFullscreen}
                aria-label="Back to feed"
                title="Back"
              >
                ←
              </button>
              <h3 className="post-fullscreen__title">{fullscreenPost.author} {fullscreenPost.handle}</h3>
            </header>
            <div className="post-fullscreen__body">
              <FeedCard
                key={`fullscreen-${fullscreenPost.id}`}
                post={fullscreenPost}
                nativeLanguage={nativeLanguage}
                isSaved={savedPostIds.has(fullscreenPost.id)}
                onToggleSave={toggleSavedPost}
                onOpenPost={openPostFullscreen}
                forceCommentsOpen
                disableHeaderOpen
                isFullscreen
                isSignedIn={isSignedIn}
                onSignInWithPasskey={signInWithPasskey}
                onCreatePasskeyOnDevice={createPasskeyOnDevice}
                passkeySignInEnabled={passkeySignInEnabled}
                viewerHandle={viewerHandle}
                onOpenAuthorProfile={openProfile}
                reactionState={postInteractions[fullscreenPost.id]?.reaction ?? null}
                isReposted={postInteractions[fullscreenPost.id]?.reposted ?? false}
                extraComments={postInteractions[fullscreenPost.id]?.extraComments ?? 0}
                onReactionChange={updatePostReaction}
                onToggleRepost={togglePostRepost}
                onCommentCountIncrement={incrementPostComments}
              />
            </div>
          </div>
        </section>
      ) : null}

      {showBackToTop ? (
        <button
          type="button"
          className="back-to-top-button"
          onClick={backToTop}
          aria-label="Back to top"
          title="Back to top"
        >
          <span aria-hidden="true">↑</span>
        </button>
      ) : null}

      {pairingApprovalRequest ? (
        <div className="auth-modal-backdrop" role="presentation">
          <section className="auth-modal panel" role="dialog" aria-modal="true" aria-label="Approve device linking">
            <h4>Approve device linking</h4>
            <p>
              This request came from another device. Approval is phone-first: confirm with a fresh passkey check on this
              phone, then the browser will be signed in.
            </p>
            {pairingApprovalMessage ? <p>{pairingApprovalMessage}</p> : null}
            <div className="auth-modal__actions">
              {!isSignedIn ? (
                <>
                  <button
                    type="button"
                    className="yt-button-secondary"
                    onClick={() => void signInWithPasskey()}
                    disabled={!passkeySignInEnabled || pairingApprovalBusy}
                  >
                    Sign in on this phone
                  </button>
                  <button
                    type="button"
                    className="yt-button-secondary"
                    onClick={() => void createPasskeyOnDevice()}
                    disabled={!passkeySignInEnabled || pairingApprovalBusy}
                  >
                    Create passkey on this device
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="yt-button-primary"
                  onClick={() => void approvePairingFromLink()}
                  disabled={pairingApprovalBusy}
                >
                  {pairingApprovalBusy ? "Approving..." : "Approve link"}
                </button>
              )}
              <button
                type="button"
                className="yt-button-secondary"
                onClick={dismissPairingApproval}
                disabled={pairingApprovalBusy}
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {pendingHandleChangeSave ? (
        <div className="auth-modal-backdrop" role="presentation">
          <section className="auth-modal panel" role="dialog" aria-modal="true" aria-label="Confirm handle update">
            <h4>Confirm handle change</h4>
            <p>
              Changing your @handle lets someone else claim your previous handle.
            </p>
            <div className="auth-modal__actions">
              <button
                type="button"
                className="yt-button-secondary"
                onClick={cancelPendingHandleChangeSave}
                disabled={profileEditorBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="yt-button-primary"
                onClick={confirmPendingHandleChangeSave}
                disabled={profileEditorBusy}
              >
                {profileEditorBusy ? "Saving..." : "Continue"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {guestPasskeyPromptOpen ? (
        <div className="auth-modal-backdrop" role="presentation">
          <section className="auth-modal panel" role="dialog" aria-modal="true" aria-label="Device check required">
            <h4>Quick device check</h4>
            <p>
              You are browsing as a guest. To continue in guest mode, complete a quick biometric or security-key check
              every 15 minutes.
            </p>
            <div className="auth-modal__actions">
              <button
                type="button"
                className="yt-button-secondary"
                onClick={() => void continueAnonymously()}
                disabled={!passkeySignInEnabled || guestPasskeyBusy}
              >
                Continue anonymously
              </button>
              <button
                type="button"
                className="yt-button-secondary"
                onClick={() => void createPasskeyOnDevice()}
                disabled={!passkeySignInEnabled || guestPasskeyBusy}
              >
                Create passkey on this device
              </button>
              <button
                type="button"
                className="yt-button-primary"
                onClick={() => void verifyGuestWithPasskey()}
                disabled={!passkeySignInEnabled || guestPasskeyBusy}
              >
                {guestPasskeyBusy ? "Checking device..." : "Verify device"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {recoveryPromptRequest && recoveryPromptContent ? (
        <div className="recovery-modal-backdrop" onClick={cancelRecoveryPrompt}>
          <section
            className="recovery-modal panel"
            role="dialog"
            aria-modal="true"
            aria-label={recoveryPromptContent.title}
            onClick={(event) => event.stopPropagation()}
          >
            <h4>{recoveryPromptContent.title}</h4>
            <p>{recoveryPromptContent.description}</p>
            <label className="recovery-modal__field" htmlFor="recovery-phrase-input">
              Recovery phrase
            </label>
            <input
              id="recovery-phrase-input"
              ref={recoveryPromptInputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={recoveryPromptValue}
              onChange={(event) => {
                setRecoveryPromptError(null);
                setRecoveryPromptValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitRecoveryPrompt();
                }
              }}
            />
            {recoveryPromptError ? (
              <p className="recovery-modal__error" role="alert">
                {recoveryPromptError}
              </p>
            ) : null}
            <div className="recovery-modal__actions">
              {recoveryPromptRequest.mode === "setup" ? (
                <button
                  type="button"
                  className="yt-button-secondary"
                  onClick={() => {
                    setRecoveryPromptError(null);
                    setRecoveryPromptValue(generateDefaultRecoveryPhrase());
                  }}
                >
                  New phrase
                </button>
              ) : null}
              <button type="button" className="yt-button-secondary" onClick={cancelRecoveryPrompt}>
                Cancel
              </button>
              <button type="button" className="yt-button-primary" onClick={submitRecoveryPrompt}>
                {recoveryPromptContent.submitLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
