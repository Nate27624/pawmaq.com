import { useEffect, useMemo, useRef, useState } from "react";
import isoCountries from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
import type { CountrySupport } from "../types";

interface PublishPayload {
  caption: string;
  countryCode: string;
  countryName: string;
  videoUrl?: string;
  mediaType?: "video" | "gif" | "png";
  originalLanguage?: string;
}

interface VideoComposerProps {
  countries: CountrySupport[];
  onPublish: (payload: PublishPayload) => void;
  isSignedIn: boolean;
  onSignInWithGoogle: () => Promise<boolean>;
  googleSignInEnabled: boolean;
}

const MAX_TOTAL_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_TOTAL_UPLOAD_MB = MAX_TOTAL_UPLOAD_BYTES / (1024 * 1024);
const MAX_DRAFT_PERSIST_BYTES = 1024 * 1024;
const COMPOSER_DRAFT_KEY = "pawmaq-composer-draft-v1";
const SIGN_IN_REQUIRED_POST_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to post. This helps keep the number of bots at a minimum.";
const SIGN_IN_REQUIRED_UPLOAD_MESSAGE =
  "Sorry for the inconvenience, you need to sign in to upload media. This helps keep the number of bots at a minimum.";
type LocationPrecision = "country" | "region" | "city";

interface ComposerDraftState {
  collapsed: boolean;
  caption: string;
  locationPrecision: LocationPrecision;
  countryInput: string;
  regionInput: string;
  cityInput: string;
}

isoCountries.registerLocale(enLocale);

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3H15L16 4H21V6H3V4H8L9 3ZM6 8H18L17 21H7L6 8ZM10 10V18H12V10H10ZM12 10V18H14V10H12Z" />
    </svg>
  );
}

function readComposerDraft(defaultCountry: string): ComposerDraftState {
  const fallback: ComposerDraftState = {
    collapsed: false,
    caption: "",
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
    const locationPrecision =
      parsed.locationPrecision === "region" || parsed.locationPrecision === "city"
        ? parsed.locationPrecision
        : "country";
    return {
      collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : false,
      caption: typeof parsed.caption === "string" ? parsed.caption : "",
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
  onSignInWithGoogle,
  googleSignInEnabled
}: VideoComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const defaultCountry = countries[0]?.country ?? "United States";
  const initialDraft = useMemo(() => readComposerDraft(defaultCountry), [defaultCountry]);
  const [collapsed, setCollapsed] = useState(initialDraft.collapsed);
  const [caption, setCaption] = useState(initialDraft.caption);
  const [locationPrecision, setLocationPrecision] = useState<LocationPrecision>(initialDraft.locationPrecision);
  const [countryInput, setCountryInput] = useState(initialDraft.countryInput);
  const [regionInput, setRegionInput] = useState(initialDraft.regionInput);
  const [cityInput, setCityInput] = useState(initialDraft.cityInput);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [mediaType, setMediaType] = useState<"video" | "gif" | "png" | null>(null);
  const [mediaBytes, setMediaBytes] = useState(0);
  const [publishAuthModalOpen, setPublishAuthModalOpen] = useState(false);
  const [googleSignInBusy, setGoogleSignInBusy] = useState(false);
  const [status, setStatus] = useState<string>(
    `Media is optional. Total post budget is ${MAX_TOTAL_UPLOAD_MB}MB (text + media).`
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const captionForDraft =
      textByteLength(caption) <= MAX_DRAFT_PERSIST_BYTES ? caption : "";
    const nextDraft: ComposerDraftState = {
      collapsed,
      caption: captionForDraft,
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
  }, [collapsed, caption, locationPrecision, countryInput, regionInput, cityInput]);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }
    setPublishAuthModalOpen(false);
    setGoogleSignInBusy(false);
  }, [isSignedIn]);

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

    const nextTotalBytes = textByteLength(caption) + normalizedFile.size;
    if (nextTotalBytes > MAX_TOTAL_UPLOAD_BYTES) {
      setStatus(
        `Upload exceeds total ${MAX_TOTAL_UPLOAD_MB}MB budget (text + media).`
      );
      return;
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    const localUrl = URL.createObjectURL(normalizedFile);
    setVideoUrl(localUrl);
    setMediaType(normalizedMediaType);
    setMediaBytes(normalizedFile.size);
    setSelectedFileName(normalizedFile.name);
    if (isJpeg) {
      setStatus("JPG converted to PNG and attached. Add a caption and publish.");
      return;
    }
    setStatus(`${normalizedMediaType === "video" ? "Video" : normalizedMediaType.toUpperCase()} attached. Add a caption and publish.`);
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

  function publishPost() {
    if (!isSignedIn) {
      setPublishAuthModalOpen(true);
      return;
    }

    const trimmedCaption = caption.trim();
    if (!trimmedCaption) {
      setStatus("Caption is required.");
      return;
    }
    const captionBytes = textByteLength(caption);
    const totalUploadBytes = captionBytes + mediaBytes;
    if (totalUploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
      setStatus(`Post exceeds total ${MAX_TOTAL_UPLOAD_MB}MB budget (text + media).`);
      return;
    }
    const detectedLanguage = detectCaptionLanguage(trimmedCaption);

    const trimmedCountry = countryInput.trim();
    const trimmedRegion = regionInput.trim();
    const trimmedCity = cityInput.trim();
    const mappedCountryCode =
      countryCodeByName.get(trimmedCountry.toLowerCase()) ??
      isoCountries.getAlpha2Code(trimmedCountry, "en") ??
      "";
    const resolvedCountryCode = mappedCountryCode;

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

    const locationLabel =
      locationPrecision === "city"
        ? `${trimmedCity}${trimmedRegion ? `, ${trimmedRegion}` : ""}, ${trimmedCountry}`
        : locationPrecision === "region"
          ? `${trimmedRegion}, ${trimmedCountry}`
          : trimmedCountry;

    onPublish({
      caption: trimmedCaption,
      countryCode: resolvedCountryCode,
      countryName: locationLabel,
      videoUrl,
      mediaType: mediaType ?? undefined,
      originalLanguage: detectedLanguage
    });
    setCaption("");
    setSelectedFileName(null);
    setVideoUrl(undefined);
    setMediaType(null);
    setMediaBytes(0);
    setStatus("Post published to your feed.");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearDraft() {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setCaption("");
    setSelectedFileName(null);
    setVideoUrl(undefined);
    setMediaType(null);
    setMediaBytes(0);
    setRegionInput("");
    setCityInput("");
    setStatus(
      `Draft cleared. Total post budget is ${MAX_TOTAL_UPLOAD_MB}MB (text + media).`
    );
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleGoogleSignInFromModal() {
    if (googleSignInBusy || !googleSignInEnabled) {
      return;
    }
    setGoogleSignInBusy(true);
    const success = await onSignInWithGoogle();
    setGoogleSignInBusy(false);
    if (success) {
      setPublishAuthModalOpen(false);
      setStatus("Signed in. You can publish your post now.");
      return;
    }
    setStatus("Google sign-in did not complete. Please try again.");
  }

  return (
    <section className="panel composer reveal">
      <header className="composer__header">
        <h2>Create Post</h2>
        <button
          type="button"
          className="composer__collapse"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
        >
          {collapsed ? "Expand" : "Minimize"}
        </button>
      </header>
      {collapsed ? (
        <p className="composer__collapsed-note">Composer minimized. Draft is preserved.</p>
      ) : (
        <>
          <div
            className="dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onClick={() => {
              if (!isSignedIn) {
                setStatus(SIGN_IN_REQUIRED_UPLOAD_MESSAGE);
                return;
              }
              fileInputRef.current?.click();
            }}
          >
            {videoUrl && (mediaType === "gif" || mediaType === "png") ? (
              <img src={videoUrl} alt="Uploaded media preview" loading="lazy" />
            ) : videoUrl ? (
              <video src={videoUrl} controls playsInline />
            ) : (
              <p>Text-only post or upload video/GIF/PNG/JPG (total {MAX_TOTAL_UPLOAD_MB}MB)</p>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/gif,image/png,image/jpeg,.jpg,.jpeg"
            onChange={onFileSelect}
            disabled={!isSignedIn}
            hidden
          />
          {selectedFileName ? <p className="status-line">Attached: {selectedFileName}</p> : null}
          <textarea
            className="composer__caption"
            placeholder="Write your post text..."
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
          />
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
          <div className="composer__location-preview">
            Posting location:{" "}
            {locationPrecision === "city"
              ? `${cityInput || "City"}${regionInput ? `, ${regionInput}` : ""}, ${countryInput || "Country"}`
              : locationPrecision === "region"
                ? `${regionInput || "Region"}, ${countryInput || "Country"}`
                : countryInput || "Country"}
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
            <div className="auth-modal__actions">
              <button
                type="button"
                className="yt-button-secondary"
                onClick={() => setPublishAuthModalOpen(false)}
              >
                Close
              </button>
              <button
                type="button"
                className="yt-button-primary"
                onClick={() => void handleGoogleSignInFromModal()}
                disabled={!googleSignInEnabled || googleSignInBusy}
              >
                {googleSignInBusy
                  ? "Signing in..."
                  : googleSignInEnabled
                    ? "Sign in with Google"
                    : "Google sign-in unavailable"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
