import { useEffect, useMemo, useRef, useState } from "react";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import { API_BASE_URL } from "../config/api";
import type { CountrySupport } from "../types";

interface PublishPayload {
  caption: string;
  countryCode: string;
  countryName: string;
  videoUrl?: string;
  mediaType?: "video" | "gif" | "png";
  originalLanguage?: string;
  anonymous?: boolean;
}

interface VideoComposerProps {
  countries: CountrySupport[];
  onPublish: (payload: PublishPayload) => void;
  isSignedIn: boolean;
  onSignInWithPasskey: () => Promise<boolean>;
  onCreatePasskeyOnDevice: () => Promise<boolean>;
  passkeySignInEnabled: boolean;
}

const MAX_DAILY_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_DAILY_UPLOAD_MB = MAX_DAILY_UPLOAD_BYTES / (1024 * 1024);
const MAX_DRAFT_PERSIST_BYTES = 1024 * 1024;
const COMPOSER_DRAFT_KEY = "pawmaq-composer-draft-v1";
const DAILY_UPLOAD_USAGE_KEY = "pawmaq-daily-upload-usage-v1";
const SIGN_IN_REQUIRED_POST_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to post. This helps keep the number of bots at a minimum.";
const SIGN_IN_REQUIRED_UPLOAD_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to upload media. This helps keep the number of bots at a minimum.";
const DEFAULT_MEDIA_ACCEPT = "video/*,image/gif,image/png,image/jpeg,.jpg,.jpeg";
const IMAGE_MEDIA_ACCEPT = "image/gif,image/png,image/jpeg,.jpg,.jpeg";
const VIDEO_MEDIA_ACCEPT = "video/*";
type LocationPrecision = "country" | "region" | "city";
type PullMode = "text" | "link" | "image" | "video";

interface ComposerDraftState {
  collapsed: boolean;
  pullMode: PullMode;
  caption: string;
  linkUrl: string;
  postAnonymously: boolean;
  locationPrecision: LocationPrecision;
  countryInput: string;
  regionInput: string;
  cityInput: string;
}

interface DailyUploadUsageState {
  day: string;
  bytesUsed: number;
}

interface UploadedMediaPayload {
  mediaId: string;
  mediaUrl: string;
  mimeType: string;
  sizeBytes: number;
}

isoCountries.registerLocale(enLocale);

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3H15L16 4H21V6H3V4H8L9 3ZM6 8H18L17 21H7L6 8ZM10 10V18H12V10H10ZM12 10V18H14V10H12Z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.7 9.3L12 14.6L17.3 9.3L19 11L12 18L5 11L6.7 9.3Z" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.3 14.7L12 9.4L6.7 14.7L5 13L12 6L19 13L17.3 14.7Z" />
    </svg>
  );
}

function readComposerDraft(defaultCountry: string): ComposerDraftState {
  const fallback: ComposerDraftState = {
    collapsed: true,
    pullMode: "text",
    caption: "",
    linkUrl: "",
    postAnonymously: false,
    locationPrecision: "country",
    countryInput: defaultCountry,
    regionInput: "",
    cityInput: ""
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  const raw = window.localStorage.getItem(COMPOSER_DRAFT_KEY);
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ComposerDraftState>;
    const pullMode =
      parsed.pullMode === "text" ||
      parsed.pullMode === "link" ||
      parsed.pullMode === "image" ||
      parsed.pullMode === "video"
        ? parsed.pullMode
        : "text";
    const locationPrecision =
      parsed.locationPrecision === "region" || parsed.locationPrecision === "city"
        ? parsed.locationPrecision
        : "country";
    return {
      collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : true,
      pullMode,
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
      linkUrl: typeof parsed.linkUrl === "string" ? parsed.linkUrl : "",
      postAnonymously: parsed.postAnonymously === true,
      locationPrecision,
      countryInput:
        typeof parsed.countryInput === "string" && parsed.countryInput.trim().length > 0
          ? parsed.countryInput
          : defaultCountry,
      regionInput: typeof parsed.regionInput === "string" ? parsed.regionInput : "",
      cityInput: typeof parsed.cityInput === "string" ? parsed.cityInput : ""
    };
  } catch {
    return fallback;
  }
}

const LATIN_LANGUAGE_HINTS: Array<{ language: string; words: string[] }> = [
  { language: "Spanish", words: ["que", "para", "con", "esta", "este", "una", "por", "como"] },
  { language: "Portuguese", words: ["que", "para", "com", "esta", "este", "uma", "como", "nao"] },
  { language: "French", words: ["que", "pour", "avec", "dans", "cette", "est", "pas", "une"] },
  { language: "German", words: ["und", "mit", "nicht", "ein", "eine", "fur", "ist", "das"] },
  { language: "Italian", words: ["che", "per", "con", "questo", "questa", "una", "non", "come"] },
  { language: "English", words: ["the", "and", "with", "this", "that", "for", "you", "are"] }
];

function detectLatinLanguage(text: string): string | null {
  const folded = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const tokens = folded.match(/[a-z']+/g) ?? [];
  if (tokens.length === 0) {
    return null;
  }

  let bestLanguage: string | null = null;
  let bestScore = 0;
  let secondBest = 0;

  for (const { language, words } of LATIN_LANGUAGE_HINTS) {
    const set = new Set(words);
    const score = tokens.reduce((total, token) => total + (set.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      secondBest = bestScore;
      bestScore = score;
      bestLanguage = language;
    } else if (score > secondBest) {
      secondBest = score;
    }
  }

  if (bestLanguage && bestScore >= 2) {
    return bestLanguage;
  }
  if (bestLanguage && bestScore >= 1 && bestScore > secondBest) {
    return bestLanguage;
  }
  return "English";
}

function detectCaptionLanguage(caption: string): string {
  const text = caption.trim();
  if (!text) {
    return "English";
  }
  if (/[\u0900-\u097F]/.test(text)) {
    return "Hindi";
  }
  if (/[\uAC00-\uD7AF]/.test(text)) {
    return "Korean";
  }
  if (/[\u3040-\u30FF]/.test(text)) {
    return "Japanese";
  }
  if (/[\u4E00-\u9FFF]/.test(text)) {
    return "Chinese";
  }
  return detectLatinLanguage(text) ?? "English";
}

function textByteLength(value: string): number {
  if (typeof TextEncoder === "undefined") {
    return value.length;
  }
  return new TextEncoder().encode(value).length;
}

function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextDailyResetLabel(now: Date = new Date()): string {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
}

function readDailyUploadUsageState(): DailyUploadUsageState {
  const today = localDateKey();
  if (typeof window === "undefined") {
    return { day: today, bytesUsed: 0 };
  }

  const raw = window.localStorage.getItem(DAILY_UPLOAD_USAGE_KEY);
  if (!raw) {
    return { day: today, bytesUsed: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    const bytes = parsed[today];
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
      return { day: today, bytesUsed: 0 };
    }
    return { day: today, bytesUsed: Math.floor(bytes) };
  } catch {
    return { day: today, bytesUsed: 0 };
  }
}

function writeDailyUploadUsageState(state: DailyUploadUsageState): void {
  if (typeof window === "undefined") {
    return;
  }

  let nextRecord: Record<string, number> = {};
  const raw = window.localStorage.getItem(DAILY_UPLOAD_USAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, number>;
      if (parsed && typeof parsed === "object") {
        nextRecord = parsed;
      }
    } catch {
      // Ignore malformed persisted data and rewrite.
    }
  }

  nextRecord[state.day] = Math.max(0, Math.floor(state.bytesUsed));
  window.localStorage.setItem(DAILY_UPLOAD_USAGE_KEY, JSON.stringify(nextRecord));
}

async function uploadMediaToApi(file: File): Promise<UploadedMediaPayload> {
  const formData = new FormData();
  formData.append("file", file, file.name);

  const response = await fetch(`${API_BASE_URL}/v1/media/upload`, {
    method: "POST",
    credentials: "include",
    body: formData
  });

  const payload = (await response.json().catch(() => null)) as
    | UploadedMediaPayload
    | { message?: string }
    | null;

  if (!response.ok || !payload || typeof payload !== "object") {
    const message = payload && "message" in payload ? payload.message : "Unable to upload media.";
    throw new Error(message ?? "Unable to upload media.");
  }

  if (
    !("mediaUrl" in payload) ||
    typeof payload.mediaUrl !== "string" ||
    !("sizeBytes" in payload) ||
    typeof payload.sizeBytes !== "number"
  ) {
    throw new Error("Media upload response was invalid.");
  }

  return payload as UploadedMediaPayload;
}

function autoResizeTextarea(textarea: HTMLTextAreaElement) {
  const priorHeight = textarea.offsetHeight;
  textarea.style.height = "auto";
  const nextHeight = Math.max(textarea.scrollHeight, priorHeight);
  textarea.style.height = `${nextHeight}px`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = url;
  });
}

async function convertJpegToPng(file: File): Promise<File> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Image conversion context unavailable.");
    }
    context.drawImage(image, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/png");
    });
    if (!pngBlob) {
      throw new Error("Failed to convert JPG to PNG.");
    }
    const convertedName = file.name.replace(/\.(jpe?g)$/i, "") + ".png";
    return new File([pngBlob], convertedName, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function VideoComposer({
  countries,
  onPublish,
  isSignedIn,
  onSignInWithPasskey,
  onCreatePasskeyOnDevice,
  passkeySignInEnabled
}: VideoComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const captionTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const defaultCountry = countries[0]?.country ?? "United States";
  const initialDraft = useMemo(() => readComposerDraft(defaultCountry), [defaultCountry]);
  const initialDailyUsage = useMemo(readDailyUploadUsageState, []);
  const [collapsed, setCollapsed] = useState(initialDraft.collapsed);
  const [caption, setCaption] = useState(initialDraft.caption);
  const [postAnonymously, setPostAnonymously] = useState(initialDraft.postAnonymously);
  const [locationPrecision, setLocationPrecision] = useState<LocationPrecision>(initialDraft.locationPrecision);
  const [countryInput, setCountryInput] = useState(initialDraft.countryInput);
  const [regionInput, setRegionInput] = useState(initialDraft.regionInput);
  const [cityInput, setCityInput] = useState(initialDraft.cityInput);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [mediaType, setMediaType] = useState<"video" | "gif" | "png" | null>(null);
  const [pullMode, setPullMode] = useState<PullMode>(initialDraft.pullMode);
  const [pickerAccept, setPickerAccept] = useState(DEFAULT_MEDIA_ACCEPT);
  const [linkUrl, setLinkUrl] = useState(initialDraft.linkUrl);
  const [mediaBytes, setMediaBytes] = useState(0);
  const [dailyUploadUsage, setDailyUploadUsage] = useState<DailyUploadUsageState>(initialDailyUsage);
  const [publishAuthModalOpen, setPublishAuthModalOpen] = useState(false);
  const [publishAuthModalTab, setPublishAuthModalTab] = useState<"signin" | "signup">("signin");
  const [signInBusyProvider, setSignInBusyProvider] = useState<"passkey" | null>(null);
  const [status, setStatus] = useState<string>("");

  function dailyBudgetStatus(bytesUsed: number): string {
    const remaining = Math.max(0, MAX_DAILY_UPLOAD_BYTES - bytesUsed);
    return `${formatMegabytes(remaining)} remaining for today. Resets ${nextDailyResetLabel()}.`;
  }

  function refreshDailyUploadUsage(): DailyUploadUsageState {
    const latest = readDailyUploadUsageState();
    if (latest.day !== dailyUploadUsage.day || latest.bytesUsed !== dailyUploadUsage.bytesUsed) {
      setDailyUploadUsage(latest);
    }
    return latest;
  }

  function showDailyBudgetStatus() {
    const usage = refreshDailyUploadUsage();
    setStatus(dailyBudgetStatus(usage.bytesUsed));
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const captionForDraft =
      textByteLength(caption) <= MAX_DRAFT_PERSIST_BYTES ? caption : "";
    const linkForDraft = textByteLength(linkUrl) <= MAX_DRAFT_PERSIST_BYTES ? linkUrl : "";
    const nextDraft: ComposerDraftState = {
      collapsed,
      pullMode,
      caption: captionForDraft,
      linkUrl: linkForDraft,
      postAnonymously,
      locationPrecision,
      countryInput,
      regionInput,
      cityInput
    };
    try {
      window.localStorage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(nextDraft));
    } catch {
      // Ignore storage quota errors so large posts can still be composed.
    }
  }, [collapsed, pullMode, caption, linkUrl, postAnonymously, locationPrecision, countryInput, regionInput, cityInput]);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    setPublishAuthModalOpen(false);
    setSignInBusyProvider(null);
  }, [isSignedIn]);

  useEffect(() => {
    if (!publishAuthModalOpen) {
      return;
    }
    setPublishAuthModalTab("signin");
  }, [publishAuthModalOpen]);

  useEffect(() => {
    if (!captionTextareaRef.current) {
      return;
    }
    autoResizeTextarea(captionTextareaRef.current);
  }, [caption, collapsed]);

  useEffect(() => {
    setStatus(dailyBudgetStatus(dailyUploadUsage.bytesUsed));
  }, [dailyUploadUsage.day, dailyUploadUsage.bytesUsed]);

  const countryCodeByName = useMemo(() => {
    const fromIsoCatalog = isoCountries.getNames("en", { select: "official" }) as Record<string, string>;
    const map = new Map<string, string>();

    for (const [iso2, countryName] of Object.entries(fromIsoCatalog)) {
      map.set(countryName.toLowerCase(), iso2);
    }

    // Keep local dataset aliases available in the map as well.
    for (const country of countries) {
      map.set(country.country.toLowerCase(), country.iso2);
    }
    return map;
  }, [countries]);

  const countrySuggestions = useMemo(() => {
    const fromIsoCatalog = isoCountries.getNames("en", { select: "official" }) as Record<string, string>;
    const names = new Set<string>(Object.values(fromIsoCatalog));

    for (const country of countries) {
      names.add(country.country);
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [countries]);

  async function applyFile(file: File) {
    const lowerName = file.name.toLowerCase();
    const isGif = file.type === "image/gif" || lowerName.endsWith(".gif");
    const isVideo = file.type.startsWith("video/");
    const isPng = file.type === "image/png" || lowerName.endsWith(".png");
    const isJpeg =
      file.type === "image/jpeg" ||
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg");

    if (!isVideo && !isGif && !isPng && !isJpeg) {
      setStatus("Please upload a video, GIF, PNG, or JPG file.");
      return;
    }
    let normalizedFile = file;
    let normalizedMediaType: "video" | "gif" | "png" = "video";

    if (isJpeg) {
      try {
        normalizedFile = await convertJpegToPng(file);
      } catch {
        setStatus("Could not convert JPG to PNG. Try another file.");
        return;
      }
      normalizedMediaType = "png";
    } else if (isPng) {
      normalizedMediaType = "png";
    } else if (isGif) {
      normalizedMediaType = "gif";
    }

    const usage = refreshDailyUploadUsage();
    const remainingDailyBytes = Math.max(0, MAX_DAILY_UPLOAD_BYTES - usage.bytesUsed);
    const draftTextBytes = textByteLength(caption) + textByteLength(linkUrl);
    const nextTotalBytes = draftTextBytes + normalizedFile.size;
    if (nextTotalBytes > remainingDailyBytes) {
      setStatus(
        `This file exceeds your remaining daily budget (${formatMegabytes(remainingDailyBytes)} left). Resets ${nextDailyResetLabel()}.`
      );
      return;
    }
    setStatus("Uploading media...");
    let uploaded: UploadedMediaPayload;
    try {
      uploaded = await uploadMediaToApi(normalizedFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upload media.";
      setStatus(message);
      return;
    }

    if (videoUrl && videoUrl.startsWith("blob:")) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoUrl(uploaded.mediaUrl);
    setMediaType(normalizedMediaType);
    setPullMode(normalizedMediaType === "video" ? "video" : "image");
    setMediaBytes(Math.max(0, Math.floor(uploaded.sizeBytes)));
    setSelectedFileName(normalizedFile.name);
    if (isJpeg) {
      setStatus(`JPG converted to PNG and attached. Add details and publish. ${dailyBudgetStatus(usage.bytesUsed)}`);
      return;
    }
    setStatus(
      `${normalizedMediaType === "video" ? "Video" : normalizedMediaType.toUpperCase()} attached. Add details and publish. ${dailyBudgetStatus(usage.bytesUsed)}`
    );
  }

  function onFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    if (!isSignedIn) {
      setStatus(SIGN_IN_REQUIRED_UPLOAD_MESSAGE);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }
    const file = event.target.files?.[0];
    if (file) {
      void applyFile(file);
    }
    setPickerAccept(DEFAULT_MEDIA_ACCEPT);
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!isSignedIn) {
      setStatus(SIGN_IN_REQUIRED_UPLOAD_MESSAGE);
      return;
    }
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void applyFile(file);
    }
  }

  function clearAttachedMedia() {
    if (videoUrl && videoUrl.startsWith("blob:")) {
      URL.revokeObjectURL(videoUrl);
    }
    setSelectedFileName(null);
    setVideoUrl(undefined);
    setMediaType(null);
    setMediaBytes(0);
    setPickerAccept(DEFAULT_MEDIA_ACCEPT);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function openMediaPicker(kind: "all" | "image" | "video") {
    if (!isSignedIn) {
      setStatus(SIGN_IN_REQUIRED_UPLOAD_MESSAGE);
      return;
    }
    if (kind === "image") {
      setPullMode("image");
      setPickerAccept(IMAGE_MEDIA_ACCEPT);
    } else if (kind === "video") {
      setPullMode("video");
      setPickerAccept(VIDEO_MEDIA_ACCEPT);
    } else {
      setPickerAccept(DEFAULT_MEDIA_ACCEPT);
    }
    window.requestAnimationFrame(() => {
      fileInputRef.current?.click();
    });
  }

  function publishPost() {
    if (!isSignedIn) {
      setPublishAuthModalOpen(true);
      return;
    }

    const trimmedCaption = caption.trim();
    const trimmedLink = linkUrl.trim();
    let publishCaption = caption;

    if (pullMode === "link") {
      if (!trimmedLink) {
        setStatus("Link URL is required.");
        return;
      }
      try {
        const parsed = new URL(trimmedLink);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("invalid");
        }
      } catch {
        setStatus("Please enter a valid http(s) link.");
        return;
      }
      publishCaption = trimmedCaption ? `${trimmedLink}\n\n${caption}` : trimmedLink;
    } else if (!trimmedCaption) {
      setStatus("Post text is required.");
      return;
    }

    if (pullMode === "image" && (!videoUrl || (mediaType !== "gif" && mediaType !== "png"))) {
      setStatus("Please upload an image or GIF before publishing.");
      return;
    }
    if (pullMode === "video" && (!videoUrl || mediaType !== "video")) {
      setStatus("Please upload a video before publishing.");
      return;
    }

    const captionBytes = textByteLength(publishCaption);
    const totalUploadBytes = captionBytes + mediaBytes;
    const usage = refreshDailyUploadUsage();
    const remainingDailyBytes = Math.max(0, MAX_DAILY_UPLOAD_BYTES - usage.bytesUsed);
    if (totalUploadBytes > remainingDailyBytes) {
      setStatus(`This post exceeds your remaining daily budget (${formatMegabytes(remainingDailyBytes)} left). Resets ${nextDailyResetLabel()}.`);
      return;
    }
    const detectedLanguage = detectCaptionLanguage(publishCaption.trim());

    const trimmedCountry = countryInput.trim();
    const trimmedRegion = regionInput.trim();
    const trimmedCity = cityInput.trim();
    const mappedCountryCode = postAnonymously
      ? "ANON"
      : countryCodeByName.get(trimmedCountry.toLowerCase()) ??
        isoCountries.getAlpha2Code(trimmedCountry, "en") ??
        "";
    const resolvedCountryCode = mappedCountryCode;

    if (!postAnonymously) {
      if (!trimmedCountry) {
        setStatus("Country or territory is required.");
        return;
      }
      if (locationPrecision === "region" && !trimmedRegion) {
        setStatus("Region/State is required for region precision.");
        return;
      }
      if (locationPrecision === "city" && !trimmedCity) {
        setStatus("City is required for city precision.");
        return;
      }
    }

    const locationLabel = postAnonymously
      ? "Anonymous"
      : locationPrecision === "city"
        ? `${trimmedCity}${trimmedRegion ? `, ${trimmedRegion}` : ""}, ${trimmedCountry}`
        : locationPrecision === "region"
          ? `${trimmedRegion}, ${trimmedCountry}`
          : trimmedCountry;

    onPublish({
      // Preserve the user's line breaks exactly as typed.
      caption: publishCaption,
      countryCode: resolvedCountryCode,
      countryName: locationLabel,
      videoUrl,
      mediaType: mediaType ?? undefined,
      originalLanguage: detectedLanguage,
      anonymous: postAnonymously
    });
    setCaption("");
    setLinkUrl("");
    setSelectedFileName(null);
    setVideoUrl(undefined);
    setMediaType(null);
    setPullMode("text");
    setMediaBytes(0);
    const nextUsage: DailyUploadUsageState = {
      day: usage.day,
      bytesUsed: usage.bytesUsed + totalUploadBytes
    };
    setDailyUploadUsage(nextUsage);
    writeDailyUploadUsageState(nextUsage);
    setStatus(`Post published. ${dailyBudgetStatus(nextUsage.bytesUsed)}`);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearDraft() {
    clearAttachedMedia();
    setCaption("");
    setLinkUrl("");
    setPullMode("text");
    setRegionInput("");
    setCityInput("");
    const usage = refreshDailyUploadUsage();
    setStatus(`Draft cleared. ${dailyBudgetStatus(usage.bytesUsed)}`);
  }

  async function handlePasskeySignInFromModal() {
    if (signInBusyProvider || !passkeySignInEnabled) {
      return;
    }
    setSignInBusyProvider("passkey");
    const success = await onSignInWithPasskey();
    setSignInBusyProvider(null);
    if (success) {
      setPublishAuthModalOpen(false);
      setStatus("Signed in. You can publish your post now.");
      return;
    }
    setStatus("Passkey sign-in did not complete. Please try again.");
  }

  async function handleCreatePasskeyOnDeviceFromModal() {
    if (signInBusyProvider || !passkeySignInEnabled) {
      return;
    }
    setSignInBusyProvider("passkey");
    const success = await onCreatePasskeyOnDevice();
    setSignInBusyProvider(null);
    if (success) {
      setPublishAuthModalOpen(false);
      setStatus("Passkey created. You can publish your post now.");
      return;
    }
    setStatus("Passkey setup did not complete. Please try again.");
  }

  return (
    <section className={collapsed ? "composer composer--collapsed reveal" : "panel composer reveal"}>
      {collapsed ? (
        <div className="composer__collapsed-row" role="region" aria-label="Create post">
          <strong className="composer__collapsed-title">Create Post</strong>
          <span className="composer__collapsed-note">
            {isSignedIn ? "Hidden while you browse. Draft is preserved." : "Sign in is required to publish."}
          </span>
          <button
            type="button"
            className="composer__collapse composer__collapse--icon"
            onClick={() => setCollapsed(false)}
            aria-expanded="false"
            aria-label="Expand create post"
            title="Expand create post"
          >
            <ChevronDownIcon />
          </button>
        </div>
      ) : (
        <>
          <header className="composer__header">
            <div className="composer__title-group">
              <h2>Create Post</h2>
              <div className="composer__media-slider" role="radiogroup" aria-label="Post type">
                <button
                  type="button"
                  className={
                    pullMode === "text" ? "composer__media-option is-active" : "composer__media-option"
                  }
                  onClick={() => {
                    setPullMode("text");
                    clearAttachedMedia();
                    captionTextareaRef.current?.focus();
                    showDailyBudgetStatus();
                  }}
                  aria-checked={pullMode === "text"}
                  role="radio"
                >
                  Text
                </button>
                <button
                  type="button"
                  className={
                    pullMode === "link" ? "composer__media-option is-active" : "composer__media-option"
                  }
                  onClick={() => {
                    setPullMode("link");
                    clearAttachedMedia();
                    window.requestAnimationFrame(() => {
                      linkInputRef.current?.focus();
                    });
                    showDailyBudgetStatus();
                  }}
                  aria-checked={pullMode === "link"}
                  role="radio"
                >
                  Link
                </button>
                <button
                  type="button"
                  className={
                    pullMode === "image" ? "composer__media-option is-active" : "composer__media-option"
                  }
                  onClick={() => {
                    setPullMode("image");
                    clearAttachedMedia();
                    showDailyBudgetStatus();
                  }}
                  aria-checked={pullMode === "image"}
                  role="radio"
                >
                  Image
                </button>
                <button
                  type="button"
                  className={
                    pullMode === "video" ? "composer__media-option is-active" : "composer__media-option"
                  }
                  onClick={() => {
                    setPullMode("video");
                    clearAttachedMedia();
                    showDailyBudgetStatus();
                  }}
                  aria-checked={pullMode === "video"}
                  role="radio"
                >
                  Video
                </button>
              </div>
            </div>
            <button
              type="button"
              className="composer__collapse composer__collapse--header composer__collapse--icon"
              onClick={() => setCollapsed(true)}
              aria-expanded="true"
              aria-label="Minimize create post"
              title="Minimize create post"
            >
              <ChevronUpIcon />
            </button>
          </header>
          {pullMode === "image" || pullMode === "video" ? (
            <div
              className="dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop}
              onClick={() => openMediaPicker(pullMode === "image" ? "image" : "video")}
            >
              {videoUrl && (mediaType === "gif" || mediaType === "png") ? (
                <img src={videoUrl} alt="Uploaded media preview" loading="lazy" />
              ) : videoUrl ? (
                <video src={videoUrl} controls playsInline />
              ) : pullMode === "image" ? (
                <p>Upload image, GIF, PNG, or JPG (daily {MAX_DAILY_UPLOAD_MB}MB)</p>
              ) : (
                <p>Upload video (daily {MAX_DAILY_UPLOAD_MB}MB)</p>
              )}
            </div>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept={pickerAccept}
            onChange={onFileSelect}
            disabled={!isSignedIn}
            hidden
          />
          {(pullMode === "image" || pullMode === "video") && selectedFileName ? (
            <p className="status-line">Attached: {selectedFileName}</p>
          ) : null}
          {pullMode === "link" ? (
            <div className="composer__link-panel">
              <label className="composer__link-label">
                Link URL
                <input
                  ref={linkInputRef}
                  type="url"
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://example.com/article"
                />
              </label>
              <textarea
                ref={captionTextareaRef}
                className="composer__caption composer__caption--link"
                placeholder="Add optional context..."
                value={caption}
                onChange={(event) => {
                  autoResizeTextarea(event.target);
                  setCaption(event.target.value);
                }}
              />
            </div>
          ) : null}
          {pullMode === "text" ? (
            <textarea
              ref={captionTextareaRef}
              className="composer__caption composer__caption--expanded"
              placeholder="Write your post text..."
              value={caption}
              onChange={(event) => {
                autoResizeTextarea(event.target);
                setCaption(event.target.value);
              }}
            />
          ) : null}
          {pullMode === "image" || pullMode === "video" ? (
            <textarea
              ref={captionTextareaRef}
              className="composer__caption"
              placeholder="Add caption..."
              value={caption}
              onChange={(event) => {
                autoResizeTextarea(event.target);
                setCaption(event.target.value);
              }}
            />
          ) : null}
          {!postAnonymously ? (
            <div className="composer__meta">
              <label>
                Precision
                <select
                  value={locationPrecision}
                  onChange={(event) => setLocationPrecision(event.target.value as LocationPrecision)}
                >
                  <option value="country">Country</option>
                  <option value="region">Region/State</option>
                  <option value="city">City</option>
                </select>
              </label>
              <label>
                Country or territory
                <input
                  list="country-suggestions"
                  value={countryInput}
                  onChange={(event) => {
                    const nextCountry = event.target.value;
                    setCountryInput(nextCountry);
                  }}
                  placeholder="Enter country or territory"
                />
                <datalist id="country-suggestions">
                  {countrySuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              {locationPrecision !== "country" ? (
                <label>
                  Region/State
                  <input
                    value={regionInput}
                    onChange={(event) => setRegionInput(event.target.value)}
                    placeholder="California"
                  />
                </label>
              ) : null}
              {locationPrecision === "city" ? (
                <label>
                  City
                  <input
                    value={cityInput}
                    onChange={(event) => setCityInput(event.target.value)}
                    placeholder="San Francisco"
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="composer__privacy-card">
            <div className="composer__privacy-top">
              <div className="composer__location-preview">
                Posting location: {postAnonymously
                  ? "Anonymous"
                  : locationPrecision === "city"
                    ? `${cityInput || "City"}${regionInput ? `, ${regionInput}` : ""}, ${countryInput || "Country"}`
                    : locationPrecision === "region"
                      ? `${regionInput || "Region"}, ${countryInput || "Country"}`
                      : countryInput || "Country"}
              </div>
              <label className="composer__checkbox">
                <input
                  type="checkbox"
                  checked={postAnonymously}
                  onChange={(event) => setPostAnonymously(event.target.checked)}
                />
                Post anonymously
              </label>
            </div>
            {postAnonymously ? (
              <p className="composer__anonymous-note">
                Your profile name and handle are hidden on this post. It may still be possible for your account to be
                identified.
              </p>
            ) : null}
          </div>
          <div className="yt-compose__actions composer__actions">
            <button
              type="button"
              className="yt-button-secondary yt-button-icon"
              onClick={clearDraft}
              aria-label="Clear post draft"
              title="Clear draft"
            >
              <TrashIcon />
            </button>
            <button type="button" className="yt-button-primary" onClick={publishPost}>
              Publish
            </button>
          </div>
          <p className="status-line">{status}</p>
        </>
      )}
      {publishAuthModalOpen ? (
        <div
          className="auth-modal-backdrop"
          role="presentation"
          onClick={() => setPublishAuthModalOpen(false)}
        >
          <div
            className="auth-modal panel"
            role="dialog"
            aria-modal="true"
            aria-label="Sign in required"
            onClick={(event) => event.stopPropagation()}
          >
            <h4>Sign in required</h4>
            <p>{SIGN_IN_REQUIRED_POST_MESSAGE}</p>
            <div className="auth-modal__tabs" role="tablist" aria-label="Authentication mode">
              <button
                type="button"
                className={publishAuthModalTab === "signin" ? "auth-modal__tab is-active" : "auth-modal__tab"}
                onClick={() => setPublishAuthModalTab("signin")}
                role="tab"
                aria-selected={publishAuthModalTab === "signin"}
              >
                Sign in
              </button>
              <button
                type="button"
                className={publishAuthModalTab === "signup" ? "auth-modal__tab is-active" : "auth-modal__tab"}
                onClick={() => setPublishAuthModalTab("signup")}
                role="tab"
                aria-selected={publishAuthModalTab === "signup"}
              >
                Sign up
              </button>
            </div>
            <p className="auth-modal__note">
              Phone QR sign-in is recommended from the top-right Guest/User menu. This modal supports on-device passkey sign-in.
            </p>
            <div className="auth-modal__actions">
              <button
                type="button"
                className="yt-button-secondary"
                onClick={() => setPublishAuthModalOpen(false)}
              >
                Close
              </button>
              {publishAuthModalTab === "signin" ? (
                <button
                  type="button"
                  className="yt-button-secondary"
                  onClick={() => void handlePasskeySignInFromModal()}
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
                  onClick={() => void handleCreatePasskeyOnDeviceFromModal()}
                  disabled={!passkeySignInEnabled || signInBusyProvider !== null}
                >
                  {signInBusyProvider === "passkey"
                    ? "Setting up..."
                    : passkeySignInEnabled
                      ? "Create passkey on this device"
                      : "Passkey unavailable"}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
