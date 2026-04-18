import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

interface StoredMediaRecord {
  media_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  original_name: string;
  created_at: string;
  sha256: string;
}

interface MediaIndexFile {
  index_version: string;
  generated_at: string;
  media: Record<string, StoredMediaRecord>;
}

const FALLBACK_INDEX: MediaIndexFile = {
  index_version: "v1.0",
  generated_at: new Date().toISOString(),
  media: {}
};

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/png": ".png",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov"
};

function extensionFromMimeOrFilename(mimeType: string, fileName: string): string {
  const mapped = MIME_EXTENSION_MAP[mimeType.toLowerCase()];
  if (mapped) {
    return mapped;
  }

  const ext = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) {
    return ext;
  }
  return ".bin";
}

export function isAllowedMediaMimeType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return (
    lower.startsWith("video/") ||
    lower === "image/gif" ||
    lower === "image/png" ||
    lower === "image/jpeg"
  );
}

export class MediaStoreService {
  private readonly indexPath: string;

  private readonly storageDir: string;

  private indexCache: MediaIndexFile | null = null;

  private loadingPromise: Promise<MediaIndexFile> | null = null;

  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(indexPath: string, storageDir: string) {
    this.indexPath = resolve(process.cwd(), indexPath);
    this.storageDir = resolve(process.cwd(), storageDir);
  }

  async saveUpload(input: {
    originalName: string;
    mimeType: string;
    buffer: Buffer;
  }): Promise<StoredMediaRecord> {
    const mediaId = `m_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const extension = extensionFromMimeOrFilename(input.mimeType, input.originalName);
    const fileName = `${mediaId}${extension}`;
    const outputPath = join(this.storageDir, fileName);
    const sha256 = createHash("sha256").update(input.buffer).digest("hex");

    await mkdir(this.storageDir, { recursive: true });
    await writeFile(outputPath, input.buffer);

    const record: StoredMediaRecord = {
      media_id: mediaId,
      file_name: fileName,
      mime_type: input.mimeType,
      size_bytes: input.buffer.byteLength,
      original_name: input.originalName,
      created_at: new Date().toISOString(),
      sha256
    };

    await this.mutateIndex((index) => {
      index.media[mediaId] = record;
    });

    return record;
  }

  async resolveMedia(mediaId: string): Promise<{ record: StoredMediaRecord; absolutePath: string } | null> {
    const index = await this.getIndex();
    const record = index.media[mediaId];
    if (!record) {
      return null;
    }
    const absolutePath = join(this.storageDir, record.file_name);
    try {
      const info = await stat(absolutePath);
      if (!info.isFile()) {
        return null;
      }
      return { record, absolutePath };
    } catch {
      return null;
    }
  }

  private async getIndex(): Promise<MediaIndexFile> {
    if (this.indexCache) {
      return this.indexCache;
    }
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    this.loadingPromise = this.loadIndex().finally(() => {
      this.loadingPromise = null;
    });
    this.indexCache = await this.loadingPromise;
    return this.indexCache;
  }

  private async loadIndex(): Promise<MediaIndexFile> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<MediaIndexFile>;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.index_version !== "string" ||
        typeof parsed.generated_at !== "string" ||
        !parsed.media ||
        typeof parsed.media !== "object"
      ) {
        throw new Error("Invalid media index.");
      }
      return {
        index_version: parsed.index_version,
        generated_at: parsed.generated_at,
        media: parsed.media as Record<string, StoredMediaRecord>
      };
    } catch {
      await this.persistIndex(FALLBACK_INDEX);
      return structuredClone(FALLBACK_INDEX);
    }
  }

  private async mutateIndex(mutator: (index: MediaIndexFile) => void): Promise<void> {
    await this.withMutationLock(async () => {
      const index = await this.getIndex();
      mutator(index);
      index.generated_at = new Date().toISOString();
      await this.persistIndex(index);
    });
  }

  private async persistIndex(index: MediaIndexFile): Promise<void> {
    await mkdir(dirname(this.indexPath), { recursive: true });
    const tmpPath = `${this.indexPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.indexPath);
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
