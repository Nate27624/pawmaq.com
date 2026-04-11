import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuthenticatedIdentity } from "../auth/guards.js";
import type { AuthSessionService } from "../auth/service.js";
import { OpenSourceModerationPipeline } from "./service.js";

const moderationContentTypes = ["post", "reply", "profile"] as const;

const moderationPayloadSchema = z.object({
  id: z.string().uuid().optional(),
  contentType: z.enum(moderationContentTypes),
  text: z.string().min(1).max(8000),
  authorId: z.string().min(1).optional(),
  createdAt: z.string().datetime().optional()
});

export async function registerModerationRoutes(
  app: FastifyInstance,
  runtime: "ollama" | "vllm" | "tgi",
  authSessions: AuthSessionService
): Promise<void> {
  const moderationPipeline = new OpenSourceModerationPipeline(runtime);

  app.get("/v1/moderation/health", async () => {
    return {
      ok: true,
      deploymentMode: "self-hosted-open-source",
      modelRuntime: runtime
    };
  });

  app.post("/v1/moderation/analyze", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }

    const parsed = moderationPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid moderation payload",
        details: parsed.error.issues
      });
    }

    const nowIso = new Date().toISOString();
    const moderationEvent = {
      id: parsed.data.id ?? crypto.randomUUID(),
      contentType: parsed.data.contentType,
      text: parsed.data.text,
      authorId: identity.subject,
      createdAt: parsed.data.createdAt ?? nowIso
    };

    const result = await moderationPipeline.analyze(moderationEvent);
    return reply.code(200).send(result);
  });
}
