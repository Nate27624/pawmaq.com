import { useMemo, useRef, useState } from "react";
import type { CountrySupport } from "../types";

interface PublishPayload {
  caption: string;
  countryCode: string;
  countryName: string;
  videoUrl?: string;
}

interface VideoComposerProps {
  countries: CountrySupport[];
  onPublish: (payload: PublishPayload) => void;
}

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_VIDEO_MB = MAX_VIDEO_BYTES / (1024 * 1024);

export function VideoComposer({ countries, onPublish }: VideoComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [caption, setCaption] = useState("");
  const [countryCode, setCountryCode] = useState(countries[0]?.iso2 ?? "US");
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | undefined>();
  const [status, setStatus] = useState<string>(`Drop a clip or click to upload. Max ${MAX_VIDEO_MB}MB.`);

  const countryNameByCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const country of countries) {
      map.set(country.iso2, country.country);
    }
    return map;
  }, [countries]);

  function applyFile(file: File) {
    if (!file.type.startsWith("video/")) {
      setStatus("Please upload a video file.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setStatus(`Video too large. Limit is ${MAX_VIDEO_MB}MB.`);
      return;
    }
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    const localUrl = URL.createObjectURL(file);
    setVideoUrl(localUrl);
    setSelectedFileName(file.name);
    setStatus("Video attached. Add a caption and publish.");
  }

  function onFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      applyFile(file);
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      applyFile(file);
    }
  }

  function publishPost() {
    const trimmedCaption = caption.trim();
    if (!trimmedCaption) {
      setStatus("Caption is required.");
      return;
    }
    onPublish({
      caption: trimmedCaption,
      countryCode,
      countryName: countryNameByCode.get(countryCode) ?? countryCode,
      videoUrl
    });
    setCaption("");
    setSelectedFileName(null);
    setVideoUrl(undefined);
    setStatus("Post published to your feed.");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <section className="panel composer reveal">
      <header className="composer__header">
        <h2>Create Video Post</h2>
      </header>
      <div
        className="dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {videoUrl ? (
          <video src={videoUrl} controls playsInline />
        ) : (
          <p>Drop video here or click to choose file (max {MAX_VIDEO_MB}MB)</p>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept="video/*" onChange={onFileSelect} hidden />
      {selectedFileName ? <p className="status-line">Attached: {selectedFileName}</p> : null}
      <textarea
        className="composer__caption"
        placeholder="Share what this video means in one line..."
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
      />
      <div className="composer__actions">
        <label>
          Country
          <select value={countryCode} onChange={(event) => setCountryCode(event.target.value)}>
            {countries.map((country) => (
              <option key={country.iso2} value={country.iso2}>
                {country.country}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={publishPost}>
          Publish
        </button>
      </div>
      <p className="status-line">{status}</p>
    </section>
  );
}
