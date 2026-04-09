import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { AccountMenu } from "./components/AccountMenu";
import { FeedCard } from "./components/FeedCard";
import { RightRail } from "./components/RightRail";
import { SideNav } from "./components/SideNav";
import { ThemeToggle } from "./components/ThemeToggle";
import { VideoComposer } from "./components/VideoComposer";
import { WorldSupportMap } from "./components/WorldSupportMap";
import { worldSupportData } from "./data/mockData";
import type { FeedPost, FeedTab, ThemeMode } from "./types";

const FOLLOWING_HANDLES = new Set(["@linapark", "@mayachow"]);
type TimeWindow = "10m" | "1h" | "12h" | "24h" | "1w" | "1m" | "3m" | "1y";
type FeedSortMode = "likes" | "approval";

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

const TIME_WINDOW_MIN_HOURS_EXCLUSIVE: Record<TimeWindow, number> = {
  "10m": -1,
  "1h": 10 / 60,
  "12h": 1,
  "24h": 12,
  "1w": 24,
  "1m": 24 * 7,
  "3m": 24 * 30,
  "1y": 24 * 90
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
const SIGNED_IN_KEY = "pawmaq-account-signed-in";
const SIGNED_IN_PROFILE_KEY = "pawmaq-account-signed-in-profile";
const LAST_SELECTED_COUNTRY_KEY = "pawmaq-world-last-country-filter";
const INITIAL_POOL_SIZE = 72;
const LOAD_BATCH_SIZE = 12;
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

isoCountries.registerLocale(enLocale);

interface RandomAuthorProfile {
  author: string;
  handle: string;
  countryCode: string;
  countryName: string;
  originalLanguage: string;
}

interface StoredAuthProfile {
  provider: "google";
  subject: string;
  name: string;
  email: string;
  picture?: string;
}

interface GoogleUserInfoResponse {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void;
}

interface GoogleOauth2Api {
  initTokenClient: (options: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
  }) => GoogleTokenClient;
}

interface GoogleApi {
  accounts: {
    oauth2: GoogleOauth2Api;
  };
}

let googleIdentityScriptPromise: Promise<void> | null = null;

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
      parsed.provider !== "google" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.email !== "string"
    ) {
      return null;
    }
    return {
      provider: "google",
      subject: parsed.subject,
      name: parsed.name,
      email: parsed.email,
      picture: typeof parsed.picture === "string" ? parsed.picture : undefined
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

function writeSeenPostHashes(hashes: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(SEEN_POST_HASHES_KEY, JSON.stringify([...hashes]));
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

function googleApiFromWindow(): GoogleApi | null {
  if (typeof window === "undefined") {
    return null;
  }
  const maybeGoogle = (window as Window & { google?: GoogleApi }).google;
  if (!maybeGoogle?.accounts?.oauth2?.initTokenClient) {
    return null;
  }
  return maybeGoogle;
}

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google sign-in requires a browser environment."));
  }
  if (googleApiFromWindow()) {
    return Promise.resolve();
  }
  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      if (googleApiFromWindow()) {
        resolve();
        return;
      }
      let finished = false;
      const interval = window.setInterval(() => {
        if (finished) {
          return;
        }
        if (googleApiFromWindow()) {
          finished = true;
          window.clearInterval(interval);
          window.clearTimeout(timeout);
          resolve();
        }
      }, 50);
      const timeout = window.setTimeout(() => {
        if (finished) {
          return;
        }
        finished = true;
        window.clearInterval(interval);
        reject(new Error("Google sign-in script load timed out."));
      }, 6000);
      existing.addEventListener(
        "error",
        () => {
          if (finished) {
            return;
          }
          finished = true;
          window.clearInterval(interval);
          window.clearTimeout(timeout);
          reject(new Error("Failed to load Google sign-in script."));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google sign-in script."));
    document.head.appendChild(script);
  }).catch((error) => {
    googleIdentityScriptPromise = null;
    throw error;
  });

  return googleIdentityScriptPromise;
}

async function requestGoogleAccessToken(clientId: string): Promise<string> {
  await loadGoogleIdentityScript();
  const googleApi = googleApiFromWindow();
  if (!googleApi) {
    throw new Error("Google sign-in did not initialize.");
  }

  return new Promise<string>((resolve, reject) => {
    const tokenClient = googleApi.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error_description ?? response.error));
          return;
        }
        if (!response.access_token) {
          reject(new Error("No Google access token returned."));
          return;
        }
        resolve(response.access_token);
      }
    });
    tokenClient.requestAccessToken({ prompt: "select_account" });
  });
}

async function fetchGoogleUserInfo(accessToken: string): Promise<StoredAuthProfile> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    throw new Error("Unable to read Google profile.");
  }
  const payload = (await response.json()) as GoogleUserInfoResponse;
  if (!payload.sub || !payload.name || !payload.email) {
    throw new Error("Google profile is missing required fields.");
  }
  return {
    provider: "google",
    subject: payload.sub,
    name: payload.name,
    email: payload.email,
    picture: payload.picture
  };
}

function googleSignInErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("popup_closed_by_user")) {
    return "Google sign-in was canceled.";
  }
  if (message.includes("access_denied")) {
    return "Google sign-in was denied.";
  }
  return "Google sign-in failed. Please try again.";
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
  return (
    ageHours > TIME_WINDOW_MIN_HOURS_EXCLUSIVE[timeWindow] &&
    ageHours <= TIME_WINDOW_MAX_HOURS[timeWindow]
  );
}

function postLikeScore(post: FeedPost): number {
  return post.upvotes;
}

function postApprovalScore(post: FeedPost): number {
  return approvalPercentFromVotes(post.upvotes, post.neutralVotes, post.downvotes);
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(preferredTheme);
  const [isSignedIn, setIsSignedIn] = useState<boolean>(() => readSignedIn() || readSignedInProfile() !== null);
  const [signedInProfile, setSignedInProfile] = useState<StoredAuthProfile | null>(readSignedInProfile);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FeedTab>("following");
  const [nativeLanguage, setNativeLanguage] = useState<string>(preferredNativeLanguage);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("24h");
  const [feedSortMode, setFeedSortMode] = useState<FeedSortMode>("likes");
  const [timeWindowSnapshotMs, setTimeWindowSnapshotMs] = useState<number>(() => Date.now());
  const [savedOnly, setSavedOnly] = useState(false);
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [allCountriesMode, setAllCountriesMode] = useState(true);
  const [lastSelectedCountryCode, setLastSelectedCountryCode] = useState<string | null>(readLastSelectedCountryCode);
  const [savedPostIds, setSavedPostIds] = useState<Set<string>>(readSavedPostIds);
  const [seenPostHashes, setSeenPostHashes] = useState<Set<string>>(readSeenPostHashes);
  const [posts, setPosts] = useState<FeedPost[]>(() =>
    generateRandomPosts(INITIAL_POOL_SIZE, TIME_WINDOW_MAX_HOURS["1w"], Date.now())
  );
  const [queuedPosts, setQueuedPosts] = useState<FeedPost[]>([]);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();
  const googleSignInEnabled = googleClientId.length > 0;

  function toggleTheme() {
    const nextTheme: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(nextTheme);
    window.localStorage.setItem("pawmaq-theme", nextTheme);
  }

  function updateNativeLanguage(language: string) {
    setNativeLanguage(language);
    window.localStorage.setItem("pawmaq-native-language", language);
  }

  async function signInWithGoogle(): Promise<boolean> {
    if (!googleSignInEnabled) {
      setAuthStatusMessage("Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID.");
      return false;
    }

    try {
      setAuthStatusMessage(null);
      const accessToken = await requestGoogleAccessToken(googleClientId);
      const profile = await fetchGoogleUserInfo(accessToken);
      setSignedInProfile(profile);
      setIsSignedIn(true);
      window.localStorage.setItem(SIGNED_IN_KEY, "1");
      writeSignedInProfile(profile);
      setAuthStatusMessage(`Signed in as ${profile.name}.`);
      return true;
    } catch (error) {
      setAuthStatusMessage(googleSignInErrorMessage(error));
      return false;
    }
  }

  function signOut() {
    setIsSignedIn(false);
    setSignedInProfile(null);
    setAuthStatusMessage(null);
    window.localStorage.setItem(SIGNED_IN_KEY, "0");
    writeSignedInProfile(null);
  }

  function toggleSavedPost(postId: string) {
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
  }

  function publishPost(payload: {
    caption: string;
    countryCode: string;
    countryName: string;
    videoUrl?: string;
    mediaType?: "video" | "gif" | "png";
    originalLanguage?: string;
  }) {
    if (!isSignedIn) {
      return;
    }
    const newPost: FeedPost = {
      id: `post-${crypto.randomUUID()}`,
      author: "You",
      handle: "@you",
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
    setQueuedPosts([]);
    setActiveTab("following");
  }

  const countryApprovalByCode = useMemo(() => {
    const voteTotalsByCountry = new Map<string, { upvotes: number; neutralVotes: number; downvotes: number }>();

    for (const post of posts) {
      const current = voteTotalsByCountry.get(post.countryCode) ?? {
        upvotes: 0,
        neutralVotes: 0,
        downvotes: 0
      };
      current.upvotes += post.upvotes;
      current.neutralVotes += post.neutralVotes;
      current.downvotes += post.downvotes;
      voteTotalsByCountry.set(post.countryCode, current);
    }

    const approvalByCountry = new Map<string, number>();
    for (const [countryCode, votes] of voteTotalsByCountry) {
      approvalByCountry.set(
        countryCode,
        approvalPercentFromVotes(votes.upvotes, votes.neutralVotes, votes.downvotes)
      );
    }
    return approvalByCountry;
  }, [posts]);

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
    }
  }

  function handleAllCountriesModeToggle(next: boolean) {
    if (next) {
      handleCountryFilterChange("all");
      return;
    }
    setAllCountriesMode(false);
  }

  function selectTimeWindow(nextWindow: TimeWindow) {
    setTimeWindow(nextWindow);
    setTimeWindowSnapshotMs(Date.now());
  }

  function handleTabChange(nextTab: FeedTab) {
    if (nextTab === activeTab) {
      return;
    }
    if (activeTab === "world" && nextTab === "following" && typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    setActiveTab(nextTab);
  }

  const countryNamesByCode = useMemo(
    () => isoCountries.getNames("en", { select: "official" }) as Record<string, string>,
    []
  );

  const activeCountryFilterLabel = useMemo(() => {
    if (activeTab !== "world" || countryFilter === "all") {
      return null;
    }
    return (
      countryNamesByCode[countryFilter] ??
      worldSupportData.find((country) => country.iso2 === countryFilter)?.country ??
      countryFilter
    );
  }, [activeTab, countryFilter, countryNamesByCode]);

  const rankedCandidates = useMemo(() => {
    const filteredByTime = posts.filter((post) =>
      isPostInTimeWindow(post, timeWindow, timeWindowSnapshotMs)
    );

    const maybeSavedFiltered = savedOnly
      ? filteredByTime.filter((post) => savedPostIds.has(post.id))
      : filteredByTime;
    const maybeCountryFiltered =
      activeTab === "world" && countryFilter !== "all"
        ? maybeSavedFiltered.filter((post) => post.countryCode === countryFilter)
        : maybeSavedFiltered;

    let basePosts: FeedPost[];
    if (activeTab === "following") {
      basePosts = maybeCountryFiltered.filter(
        (post) => FOLLOWING_HANDLES.has(post.handle) || post.handle === "@you"
      );
    } else {
      basePosts = maybeCountryFiltered;
    }

    const deduped = uniquePosts(basePosts);

    return [...deduped].sort((left, right) => {
      const leftScore = feedSortMode === "approval" ? postApprovalScore(left) : postLikeScore(left);
      const rightScore = feedSortMode === "approval" ? postApprovalScore(right) : postLikeScore(right);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      if (feedSortMode === "approval" && left.upvotes !== right.upvotes) {
        return right.upvotes - left.upvotes;
      }
      if (left.downvotes !== right.downvotes) {
        return left.downvotes - right.downvotes;
      }
      return right.createdAtMs - left.createdAtMs;
    });
  }, [
    activeTab,
    posts,
    timeWindow,
    feedSortMode,
    timeWindowSnapshotMs,
    savedOnly,
    countryFilter,
    savedPostIds
  ]);

  const feedContextKey = useMemo(
    () =>
      `${activeTab}|${timeWindow}|${feedSortMode}|${timeWindowSnapshotMs}|${savedOnly ? "saved" : "all"}|${activeTab === "world" ? countryFilter : "all"}`,
    [activeTab, timeWindow, feedSortMode, timeWindowSnapshotMs, savedOnly, countryFilter]
  );

  const loadMorePosts = useCallback(() => {
    setQueuedPosts((current) => {
      const currentIds = new Set(current.map((post) => post.id));
      const unseenCandidates = rankedCandidates.filter((post) => {
        if (currentIds.has(post.id)) {
          return false;
        }
        if (savedOnly) {
          return true;
        }
        return !seenPostHashes.has(postIdentifierHash(post));
      });
      const nextBatch = unseenCandidates.slice(0, LOAD_BATCH_SIZE);

      if (nextBatch.length === 0) {
        if (savedOnly) {
          return current;
        }
        setPosts((existing) => [
          ...existing,
          ...generateRandomPosts(
            LOAD_BATCH_SIZE * 3,
            TIME_WINDOW_MAX_HOURS[timeWindow],
            timeWindowSnapshotMs
          )
        ]);
        return current;
      }

      if (nextBatch.length > 0 && !savedOnly) {
        setSeenPostHashes((existing) => {
          const next = new Set(existing);
          for (const post of nextBatch) {
            next.add(postIdentifierHash(post));
          }
          writeSeenPostHashes(next);
          return next;
        });
      }

      return [...current, ...nextBatch];
    });
  }, [rankedCandidates, seenPostHashes, timeWindow, timeWindowSnapshotMs, savedOnly]);

  useEffect(() => {
    setQueuedPosts([]);
  }, [feedContextKey]);

  useEffect(() => {
    if (queuedPosts.length === 0) {
      loadMorePosts();
    }
  }, [queuedPosts.length, loadMorePosts]);

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

  return (
    <div className={`app-shell mode-${themeMode}`}>
      <header className="top-bar reveal">
        <div>
          <p className="top-bar__title">Pawmaq Feed</p>
          <p className="top-bar__subtitle">Cross between pulse-driven X streams and video-native channels.</p>
        </div>
        <div className="top-bar__actions">
          <ThemeToggle mode={themeMode} onToggle={toggleTheme} />
          <AccountMenu
            mode={themeMode}
            isSignedIn={isSignedIn}
            signedInProfile={signedInProfile}
            onSignOut={signOut}
            onSignInWithGoogle={signInWithGoogle}
            googleSignInEnabled={googleSignInEnabled}
            authStatusMessage={authStatusMessage}
            nativeLanguage={nativeLanguage}
            onNativeLanguageChange={updateNativeLanguage}
            feedSortMode={feedSortMode}
            onFeedSortModeChange={setFeedSortMode}
            savedCount={savedPostIds.size}
          />
        </div>
      </header>

      <div className="layout-grid">
        <SideNav activeTab={activeTab} onTabChange={handleTabChange} />

        <main className="main-column">
          {activeTab === "world" ? (
            <WorldSupportMap
              countries={worldSupportData}
              selectedCountryCode={countryFilter === "all" ? null : countryFilter}
              allCountriesMode={allCountriesMode}
              onToggleAllCountriesMode={handleAllCountriesModeToggle}
              onCountrySelect={handleCountryFilterChange}
            />
          ) : null}

          <section className="panel feed-tools reveal">
            <button
              type="button"
              className={timeWindow === "10m" ? "feed-tools__chip is-active" : "feed-tools__chip"}
              onClick={() => selectTimeWindow("10m")}
            >
              10 min
            </button>
            <button
              type="button"
              className={timeWindow === "1h" ? "feed-tools__chip is-active" : "feed-tools__chip"}
              onClick={() => selectTimeWindow("1h")}
            >
              1 hr
            </button>
            <div className="feed-tools__window">
              {TIME_WINDOW_CHOICES.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className={timeWindow === key ? "feed-tools__chip is-active" : "feed-tools__chip"}
                  onClick={() => selectTimeWindow(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={savedOnly ? "feed-tools__chip is-active" : "feed-tools__chip"}
              onClick={() => setSavedOnly((current) => !current)}
            >
              Saved Only
            </button>
          </section>

          <VideoComposer
            countries={worldSupportData}
            onPublish={publishPost}
            isSignedIn={isSignedIn}
            onSignInWithGoogle={signInWithGoogle}
            googleSignInEnabled={googleSignInEnabled}
          />

          {activeCountryFilterLabel ? (
            <div className="feed-country-context reveal" role="status" aria-live="polite">
              <span className="feed-country-context__label">World filter</span>
              <strong className="feed-country-context__country">{activeCountryFilterLabel}</strong>
              <span className="feed-country-context__hint">
                You are viewing posts only from this country.
              </span>
              <button
                type="button"
                className="feed-country-context__clear"
                onClick={() => handleCountryFilterChange("all")}
              >
                Show all
              </button>
            </div>
          ) : null}

          <section className="feed-list">
            {queuedPosts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                nativeLanguage={nativeLanguage}
                isSaved={savedPostIds.has(post.id)}
                onToggleSave={toggleSavedPost}
                isSignedIn={isSignedIn}
                countryApprovalPercent={countryApprovalByCode.get(post.countryCode) ?? null}
                rankScore={
                  activeTab === "world"
                    ? feedSortMode === "approval"
                      ? postApprovalScore(post)
                      : post.upvotes
                    : undefined
                }
                rankLabel={feedSortMode === "approval" ? "Approval" : "Likes"}
              />
            ))}
            <div className="feed-end-sentinel" ref={loadMoreRef} />
          </section>
        </main>

        <RightRail />
      </div>
    </div>
  );
}
