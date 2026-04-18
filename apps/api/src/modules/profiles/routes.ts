import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuthenticatedIdentity } from "../auth/guards.js";
import type { AuthSessionService } from "../auth/service.js";
import type { ProfileLedgerService } from "./service.js";

const updateProfileSchema = z.object({
  name: z.string().min(1).max(120),
  username: z.string().min(2).max(64),
  handle: z.string().min(2).max(33),
  bio: z.string().max(300),
  location: z.string().max(120),
  avatarUrl: z.string().url().or(z.literal("")),
  bannerUrl: z.string().url().or(z.literal("")),
  shareSocialGraph: z.boolean()
});

const setFollowSchema = z.object({
  targetHandle: z.string().min(2).max(33),
  follow: z.boolean()
});

const recordPostInteractionSchema = z.object({
  postId: z.string().min(1).max(220),
  action: z.enum([
    "seen",
    "liked",
    "disliked",
    "neutral",
    "saved",
    "unsaved",
    "reposted",
    "unreposted",
    "commented"
  ])
});

const recordCreatedPostSchema = z.object({
  postId: z.string().min(1).max(220),
  anonymous: z.boolean().optional()
});

const privateBlockSchema = z.object({
  algorithm: z.string().min(3).max(80),
  keyFingerprint: z.string().min(8).max(160),
  ivBase64: z.string().min(8).max(240),
  ciphertextBase64: z.string().min(12).max(1_200_000)
});

const privateCryptoBundleSchema = z.object({
  kdf: z.literal("PBKDF2-SHA256"),
  iterations: z.number().int().min(50_000).max(5_000_000),
  saltBase64: z.string().min(8).max(512),
  wrapIvBase64: z.string().min(8).max(512),
  wrappedMasterKeyBase64: z.string().min(16).max(4096)
});

const profileByHandleParamsSchema = z.object({
  handle: z.string().min(2).max(33)
});

export async function registerProfileRoutes(
  app: FastifyInstance,
  profileLedger: ProfileLedgerService,
  authSessions: AuthSessionService
): Promise<void> {
  app.put("/v1/profiles/self", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid profile update payload",
        details: parsed.error.issues
      });
    }

    try {
      const profile = await profileLedger.updateOwnProfile({
        ...parsed.data,
        provider: identity.provider,
        subject: identity.subject
      });
      return reply.code(200).send(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update profile.";
      const statusCode = /cap/i.test(message) ? 429 : /taken|not found/i.test(message) ? 409 : 400;
      return reply.code(statusCode).send({
        error: "profile_update_failed",
        message
      });
    }
  });

  app.post("/v1/profiles/follow", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const parsed = setFollowSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid follow payload",
        details: parsed.error.issues
      });
    }

    try {
      const profile = await profileLedger.setFollow({
        ...parsed.data,
        provider: identity.provider,
        subject: identity.subject
      });
      return reply.code(200).send(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update follow state.";
      const statusCode = /cap/i.test(message) ? 429 : 400;
      return reply.code(statusCode).send({
        error: "profile_follow_update_failed",
        message
      });
    }
  });

  app.post("/v1/profiles/post-interactions", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const parsed = recordPostInteractionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post interaction payload",
        details: parsed.error.issues
      });
    }

    try {
      await profileLedger.recordPostInteraction({
        ...parsed.data,
        provider: identity.provider,
        subject: identity.subject
      });
      return reply.code(200).send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to record post interaction.";
      const statusCode = /cap/i.test(message) ? 429 : /not found/i.test(message) ? 404 : 400;
      return reply.code(statusCode).send({
        error: "profile_post_interaction_failed",
        message
      });
    }
  });

  app.post("/v1/profiles/posts", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const parsed = recordCreatedPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post ownership payload",
        details: parsed.error.issues
      });
    }

    try {
      const profile = await profileLedger.recordCreatedPost({
        ...parsed.data,
        provider: identity.provider,
        subject: identity.subject
      });
      return reply.code(200).send(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to record created post.";
      const statusCode = /cap/i.test(message) ? 429 : /not found/i.test(message) ? 404 : 400;
      return reply.code(statusCode).send({
        error: "profile_post_create_record_failed",
        message
      });
    }
  });

  app.put("/v1/profiles/private-block", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const parsed = privateBlockSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid private block payload",
        details: parsed.error.issues
      });
    }

    try {
      await profileLedger.updatePrivateEncryptedBlock({
        provider: identity.provider,
        subject: identity.subject,
        algorithm: parsed.data.algorithm,
        keyFingerprint: parsed.data.keyFingerprint,
        ivBase64: parsed.data.ivBase64,
        ciphertextBase64: parsed.data.ciphertextBase64
      });
      return reply.code(200).send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update private profile block.";
      const statusCode = /cap/i.test(message) ? 429 : /not found/i.test(message) ? 404 : 400;
      return reply.code(statusCode).send({
        error: "profile_private_block_update_failed",
        message
      });
    }
  });

  app.get("/v1/profiles/private-block", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    try {
      const block = await profileLedger.getPrivateEncryptedBlock(identity.provider, identity.subject);
      return reply.code(200).send({
        block
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read private profile block.";
      return reply.code(500).send({
        error: "profile_private_block_read_failed",
        message
      });
    }
  });

  app.put("/v1/profiles/private-crypto", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    const parsed = privateCryptoBundleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid private crypto bundle payload",
        details: parsed.error.issues
      });
    }

    try {
      await profileLedger.updatePrivateCryptoBundle({
        provider: identity.provider,
        subject: identity.subject,
        kdf: parsed.data.kdf,
        iterations: parsed.data.iterations,
        saltBase64: parsed.data.saltBase64,
        wrapIvBase64: parsed.data.wrapIvBase64,
        wrappedMasterKeyBase64: parsed.data.wrappedMasterKeyBase64
      });
      return reply.code(200).send({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update private crypto bundle.";
      const statusCode = /cap/i.test(message) ? 429 : /not found/i.test(message) ? 404 : 400;
      return reply.code(statusCode).send({
        error: "profile_private_crypto_update_failed",
        message
      });
    }
  });

  app.get("/v1/profiles/private-crypto", async (request, reply) => {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return;
    }
    try {
      const bundle = await profileLedger.getPrivateCryptoBundle(identity.provider, identity.subject);
      return reply.code(200).send({
        bundle
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read private crypto bundle.";
      return reply.code(500).send({
        error: "profile_private_crypto_read_failed",
        message
      });
    }
  });

  app.get("/v1/profiles/by-handle/:handle", async (request, reply) => {
    const paramsParsed = profileByHandleParamsSchema.safeParse(request.params);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid profile handle.",
        details: paramsParsed.error.issues
      });
    }

    try {
      const profile = await profileLedger.getByHandle(paramsParsed.data.handle);
      if (!profile) {
        return reply.code(404).send({
          error: "profile_not_found",
          message: "No profile exists for this handle."
        });
      }
      return reply.code(200).send(profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load profile.";
      return reply.code(400).send({
        error: "profile_lookup_failed",
        message
      });
    }
  });
}
