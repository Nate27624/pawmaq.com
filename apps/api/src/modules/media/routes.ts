import multipart from "@fastify/multipart";
import { createReadStream } from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireAuthenticatedIdentity } from "../auth/guards.js";
import type { AuthSessionService } from "../auth/service.js";
import {
  PreLedgerQueueBusyError,
  PreLedgerQueueRateLimitError,
  PreLedgerQueueService,
  PreLedgerValidationError,
  preprocessUploadForStorage
} from "../intake/pre-ledger-queue.js";
import type { ProfileLedgerService } from "../profiles/service.js";
import { MediaStoreService, isAllowedMediaMimeType } from "./service.js";

const MAX_MEDIA_UPLOAD_BYTES = 210 * 1024 * 1024;

const paramsSchema = z.object({
  mediaId: z.string().regex(/^m_[a-z0-9_]+$/i)
});

function requestBaseUrl(request: FastifyRequest, mediaPublicBaseUrl?: string): string {
  if (mediaPublicBaseUrl) {
    return mediaPublicBaseUrl.replace(/\/+$/, "");
  }
  const protocol = request.protocol || "http";
  const host = request.hostname || request.headers.host || "localhost:3000";
  return `${protocol}://${host}`;
}

export async function registerMediaRoutes(
  app: FastifyInstance,
  mediaIndexPath: string,
  mediaStorageDir: string,
  preLedgerQueue: PreLedgerQueueService,
  authSessions: AuthSessionService,
  profileLedger: ProfileLedgerService,
  mediaPublicBaseUrl?: string
): Promise<void> {
  const mediaStore = new MediaStoreService(mediaIndexPath, mediaStorageDir);

  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: MAX_MEDIA_UPLOAD_BYTES
    }
  });

  app.post("/v1/media/upload", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const viewerProfile = await profileLedger.getByProviderSubject(identity.provider, identity.subject);
    if (!viewerProfile) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Sign-in is required for media upload."
      });
    }

    let filePart: Awaited<ReturnType<typeof request.file>> | undefined;
    let streamConsumed = false;
    try {
      filePart = await request.file();
      if (!filePart) {
        return reply.code(400).send({
          error: "missing_file",
          message: "Upload requires a media file."
        });
      }

      if (!isAllowedMediaMimeType(filePart.mimetype)) {
        filePart.file.resume();
        streamConsumed = true;
        return reply.code(415).send({
          error: "unsupported_media_type",
          message: "Supported uploads: video, GIF, PNG, JPG."
        });
      }
      const activeFile = filePart;

      const saved = await preLedgerQueue.enqueue({
        actorKey: viewerProfile.userId,
        kind: "media_upload",
        validate: () => {
          if ((activeFile.filename || "").trim().length === 0) {
            throw new PreLedgerValidationError("Upload file name is required.");
          }
        },
        process: async () => {
          streamConsumed = true;
          const buffer = await activeFile.toBuffer();
          const prepared = preprocessUploadForStorage({
            originalName: activeFile.filename || "upload.bin",
            mimeType: activeFile.mimetype,
            buffer,
            maxBytes: MAX_MEDIA_UPLOAD_BYTES
          });
          return mediaStore.saveUpload({
            originalName: prepared.normalizedName,
            mimeType: activeFile.mimetype,
            buffer
          });
        }
      });

      const mediaUrl = `${requestBaseUrl(request, mediaPublicBaseUrl)}/v1/media/files/${saved.media_id}`;
      return reply.code(201).send({
        mediaId: saved.media_id,
        mediaUrl,
        mimeType: saved.mime_type,
        sizeBytes: saved.size_bytes
      });
    } catch (error) {
      if (filePart && !streamConsumed) {
        filePart.file.resume();
      }
      request.log.error(error);
      const message = error instanceof Error ? error.message : "";
      if (message.includes("File too large")) {
        return reply.code(413).send({
          error: "file_too_large",
          message: "Upload exceeds the server file size limit."
        });
      }
      if (error instanceof PreLedgerQueueRateLimitError) {
        return reply.code(429).send({
          error: "rate_limited",
          message: error.message,
          retry_after_ms: error.retryAfterMs
        });
      }
      if (error instanceof PreLedgerQueueBusyError) {
        return reply.code(503).send({
          error: "queue_busy",
          message: error.message
        });
      }
      if (error instanceof PreLedgerValidationError) {
        return reply.code(400).send({
          error: "validation_error",
          message: error.message
        });
      }
      return reply.code(500).send({
        error: "media_upload_failed",
        message: "Unable to upload media file."
      });
    }
  });

  app.get("/v1/media/files/:mediaId", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid media id."
      });
    }

    const resolved = await mediaStore.resolveMedia(parsed.data.mediaId);
    if (!resolved) {
      return reply.code(404).send({
        error: "media_not_found",
        message: "Media file not found."
      });
    }

    reply.header("content-type", resolved.record.mime_type);
    reply.header("cache-control", "public, max-age=31536000, immutable");
    return reply.send(createReadStream(resolved.absolutePath));
  });
}
