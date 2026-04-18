import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { readAuthenticatedIdentity, requireAuthenticatedIdentity } from "../auth/guards.js";
import type { AuthSessionService } from "../auth/service.js";
import {
  PreLedgerQueueBusyError,
  PreLedgerQueueRateLimitError,
  PreLedgerQueueService,
  PreLedgerValidationError,
  validateCaptionLinks,
  validatePublicHttpUrl
} from "../intake/pre-ledger-queue.js";
import type { ProfileLedgerService } from "../profiles/service.js";
import type { ProfileLedger, ProfileLedgerUserRecord } from "../profiles/types.js";
import type { PostPopularityLedgerService } from "./service.js";
import type { PostLedgerRecord, PostPopularityLedger } from "./types.js";

const postEventSchema = z.object({
  id: z.string().min(1).max(220),
  author: z.string().min(1).max(120),
  handle: z.string().min(2).max(33),
  isAnonymous: z.boolean().optional(),
  anonymousKey: z.string().min(8).max(140).optional(),
  caption: z.string().min(1).max(8000000),
  createdAtMs: z.number().int().positive(),
  countryCode: z.string().min(2).max(8),
  countryName: z.string().min(2).max(200),
  mediaType: z.enum(["video", "gif", "png"]).optional(),
  mediaUrl: z.string().url().optional(),
  upvotes: z.number().int().min(0),
  neutralVotes: z.number().int().min(0),
  downvotes: z.number().int().min(0),
  comments: z.number().int().min(0)
});

const hashtagQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10)
});

const ledgerExportQuerySchema = z.object({
  usersOffset: z.coerce.number().int().min(0).default(0),
  usersLimit: z.coerce.number().int().min(1).max(250).default(100),
  postsOffset: z.coerce.number().int().min(0).default(0),
  postsLimit: z.coerce.number().int().min(1).max(250).default(100),
  rankLimit: z.coerce.number().int().min(1).max(500).default(200),
  hashtagLimit: z.coerce.number().int().min(1).max(500).default(200)
});

const postParamsSchema = z.object({
  postId: z.string().min(1).max(220)
});

const postCommentParamsSchema = z.object({
  postId: z.string().min(1).max(220),
  commentId: z.string().min(1).max(220)
});

const postCommentBodySchema = z.object({
  text: z.string().min(1).max(10000)
});

const postReplyParamsSchema = z.object({
  postId: z.string().min(1).max(220),
  commentId: z.string().min(1).max(220),
  replyId: z.string().min(1).max(220)
});

const reactionBodySchema = z.object({
  reaction: z.enum(["up", "down", "none"])
});

const LEDGER_EXPORT_WINDOW_MS = 60_000;
const LEDGER_EXPORT_MAX_PER_WINDOW = 30;
const LEDGER_EXPORT_MAX_TRACKED_KEYS = 10_000;

interface LedgerExportRateCounter {
  windowStartMs: number;
  count: number;
}

interface PublicProfileLedgerUserRecord {
  user_id: string;
  provider: ProfileLedgerUserRecord["provider"];
  username: string;
  usertag: string;
  name: string;
  bio: string;
  location: string;
  avatar_url: string;
  banner_url: string;
  share_social_graph: boolean;
  following_handles: string[];
  follower_handles: string[];
  posts: string[];
  created_at: string;
  updated_at: string;
  commitments: {
    provider_subject_hash_sha256: string;
    post_interaction_history_sha256: string;
    private_profile_encrypted_sha256: string | null;
    private_crypto_bundle_sha256: string | null;
  };
}

interface PublicProfileLedgerExport {
  ledger_version: string;
  generated_at: string;
  export_policy: "public_projection_v1";
  users: Record<string, PublicProfileLedgerUserRecord>;
  username_index: Record<string, string>;
  usertag_index: Record<string, string>;
  commitments: {
    raw_profile_ledger_sha256: string;
    users_projection_sha256: string;
    daily_quota_redacted_sha256: string;
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const serializedEntries = entries.map(
    ([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`
  );
  return `{${serializedEntries.join(",")}}`;
}

function sha256Of(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function dedupePreservingOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function toPublicProfileLedger(snapshot: ProfileLedger): PublicProfileLedgerExport {
  const projectedUsers: Record<string, PublicProfileLedgerUserRecord> = {};
  for (const userId of Object.keys(snapshot.users).sort((left, right) => left.localeCompare(right))) {
    const record = snapshot.users[userId];
    if (!record) {
      continue;
    }
    const followingHandles = record.share_social_graph ? dedupeAndSort(record.following_handles) : [];
    const followerHandles = record.share_social_graph ? dedupeAndSort(record.follower_handles) : [];
    projectedUsers[userId] = {
      user_id: record.user_id,
      provider: record.provider,
      username: record.username,
      usertag: record.usertag,
      name: record.name,
      bio: record.bio,
      location: record.location,
      avatar_url: record.avatar_url,
      banner_url: record.banner_url,
      share_social_graph: record.share_social_graph,
      following_handles: followingHandles,
      follower_handles: followerHandles,
      posts: dedupePreservingOrder(record.posts),
      created_at: record.created_at,
      updated_at: record.updated_at,
      commitments: {
        provider_subject_hash_sha256: sha256Of(record.provider_subject_hash),
        post_interaction_history_sha256: sha256Of(record.post_interaction_history),
        private_profile_encrypted_sha256: record.private_profile_encrypted
          ? sha256Of(record.private_profile_encrypted)
          : null,
        private_crypto_bundle_sha256: record.private_crypto_bundle ? sha256Of(record.private_crypto_bundle) : null
      }
    };
  }

  return {
    ledger_version: snapshot.ledger_version,
    generated_at: snapshot.generated_at,
    export_policy: "public_projection_v1",
    users: projectedUsers,
    username_index: { ...snapshot.username_index },
    usertag_index: { ...snapshot.usertag_index },
    commitments: {
      raw_profile_ledger_sha256: sha256Of(snapshot),
      users_projection_sha256: sha256Of(projectedUsers),
      daily_quota_redacted_sha256: sha256Of(snapshot.daily_ledger_quota_by_user)
    }
  };
}

function toPublicPostPopularityLedger(snapshot: PostPopularityLedger): PostPopularityLedger {
  const sanitizedPosts: Record<string, PostLedgerRecord> = {};
  const sortedPostIds = Object.keys(snapshot.posts).sort((left, right) => left.localeCompare(right));
  for (const postId of sortedPostIds) {
    const sourcePost = snapshot.posts[postId];
    if (!sourcePost) {
      continue;
    }
    sanitizedPosts[postId] = sanitizePostRecord(sourcePost);
  }
  return {
    ...snapshot,
    posts: sanitizedPosts
  };
}

function sanitizePostRecord(post: PostLedgerRecord): PostLedgerRecord {
  const sanitized = structuredClone(post);
  const comments = sanitized.engagement.comments;
  for (const comment of comments) {
    if ("reaction_by_actor" in comment) {
      delete comment.reaction_by_actor;
    }
    for (const reply of comment.replies) {
      if ("reaction_by_actor" in reply) {
        delete reply.reaction_by_actor;
      }
    }
  }
  return sanitized;
}

function nextOffsetValue(offset: number, pageSize: number, total: number): number | null {
  const next = offset + pageSize;
  return next < total ? next : null;
}

function pickRecordPage<T>(source: Record<string, T>, offset: number, limit: number): {
  page: Record<string, T>;
  total: number;
  pageSize: number;
  nextOffset: number | null;
} {
  const sortedKeys = Object.keys(source).sort((left, right) => left.localeCompare(right));
  const pageKeys = sortedKeys.slice(offset, offset + limit);
  const page: Record<string, T> = {};
  for (const key of pageKeys) {
    const value = source[key];
    if (value !== undefined) {
      page[key] = value;
    }
  }
  return {
    page,
    total: sortedKeys.length,
    pageSize: pageKeys.length,
    nextOffset: nextOffsetValue(offset, pageKeys.length, sortedKeys.length)
  };
}

function normalizedRateKey(raw: string | undefined): string {
  const key = (raw ?? "").trim();
  if (!key) {
    return "unknown";
  }
  return key.toLowerCase().slice(0, 120);
}

function pruneExportRateCounters(
  counters: Map<string, LedgerExportRateCounter>,
  nowMs: number
): void {
  if (counters.size === 0) {
    return;
  }
  for (const [rateKey, counter] of counters.entries()) {
    if (nowMs - counter.windowStartMs >= LEDGER_EXPORT_WINDOW_MS) {
      counters.delete(rateKey);
    }
  }
  if (counters.size <= LEDGER_EXPORT_MAX_TRACKED_KEYS) {
    return;
  }
  const overflow = counters.size - LEDGER_EXPORT_MAX_TRACKED_KEYS;
  let removed = 0;
  for (const rateKey of counters.keys()) {
    counters.delete(rateKey);
    removed += 1;
    if (removed >= overflow) {
      break;
    }
  }
}

export async function registerLedgerRoutes(
  app: FastifyInstance,
  profileLedger: ProfileLedgerService,
  postLedger: PostPopularityLedgerService,
  preLedgerQueue: PreLedgerQueueService,
  authSessions: AuthSessionService
): Promise<void> {
  const exportRateCounters = new Map<string, LedgerExportRateCounter>();

  async function requireViewerProfile(request: FastifyRequest, reply: FastifyReply) {
    const identity = await requireAuthenticatedIdentity(request, reply, authSessions);
    if (!identity) {
      return null;
    }
    const viewerProfile = await profileLedger.getByProviderSubject(identity.provider, identity.subject);
    if (!viewerProfile) {
      void reply.code(401).send({
        error: "unauthorized",
        message: "Session profile is no longer available."
      });
      return null;
    }
    return viewerProfile;
  }

  app.post("/v1/ledger/posts", async (request, reply) => {
    const viewerProfile = await requireViewerProfile(request, reply);
    if (!viewerProfile) {
      return;
    }

    const parsed = postEventSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post ledger payload",
        details: parsed.error.issues
      });
    }

    try {
      const payload = parsed.data.isAnonymous
        ? {
            ...parsed.data,
            author: "Anonymous",
            handle: "@anonymous"
          }
        : {
            ...parsed.data,
            author: viewerProfile.name,
            handle: viewerProfile.handle
          };
      await preLedgerQueue.enqueue({
        actorKey: viewerProfile.userId,
        kind: "ledger_post",
        validate: () => {
          validateCaptionLinks(payload.caption);
          if (payload.mediaUrl) {
            validatePublicHttpUrl(payload.mediaUrl, "mediaUrl");
          }
        },
        process: () => postLedger.upsertPost(payload)
      });
      return reply.code(200).send({ ok: true });
    } catch (error) {
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
      request.log.error(error);
      return reply.code(500).send({
        error: "post_ledger_write_failed",
        message: "Unable to update post ledger."
      });
    }
  });

  app.get("/v1/ledger/export", async (request, reply) => {
    const parsedQuery = ledgerExportQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid ledger export query payload",
        details: parsedQuery.error.issues
      });
    }

    const rateKey = normalizedRateKey(request.ip);
    const nowMs = Date.now();
    pruneExportRateCounters(exportRateCounters, nowMs);
    const counter = exportRateCounters.get(rateKey);
    if (!counter || nowMs - counter.windowStartMs >= LEDGER_EXPORT_WINDOW_MS) {
      exportRateCounters.set(rateKey, {
        windowStartMs: nowMs,
        count: 1
      });
    } else {
      if (counter.count >= LEDGER_EXPORT_MAX_PER_WINDOW) {
        return reply.code(429).send({
          error: "rate_limited",
          message: "Ledger export rate limit reached. Please retry shortly.",
          retry_after_ms: Math.max(1, LEDGER_EXPORT_WINDOW_MS - (nowMs - counter.windowStartMs))
        });
      }
      counter.count += 1;
    }

    try {
      const [profileLedgerSnapshot, rawPostPopularityLedger] = await Promise.all([
        profileLedger.getLedgerSnapshot(),
        postLedger.getLedgerSnapshot()
      ]);
      const publicProfileLedger = toPublicProfileLedger(profileLedgerSnapshot);
      const publicPostPopularityLedger = toPublicPostPopularityLedger(rawPostPopularityLedger);
      const usersPage = pickRecordPage(
        publicProfileLedger.users,
        parsedQuery.data.usersOffset,
        parsedQuery.data.usersLimit
      );
      const postsPage = pickRecordPage(
        publicPostPopularityLedger.posts,
        parsedQuery.data.postsOffset,
        parsedQuery.data.postsLimit
      );
      const rankingByTimeframe = Object.fromEntries(
        Object.entries(publicPostPopularityLedger.ranking_indexes.by_timeframe).map(([timeframe, rankings]) => [
          timeframe,
          {
            likes: rankings.likes.slice(0, parsedQuery.data.rankLimit),
            approval: rankings.approval.slice(0, parsedQuery.data.rankLimit)
          }
        ])
      ) as PostPopularityLedger["ranking_indexes"]["by_timeframe"];
      const publicPostPopularityLedgerPage: PostPopularityLedger = {
        ...publicPostPopularityLedger,
        posts: postsPage.page,
        hashtag_ledger: {
          ...publicPostPopularityLedger.hashtag_ledger,
          likes_24h: publicPostPopularityLedger.hashtag_ledger.likes_24h.slice(0, parsedQuery.data.hashtagLimit)
        },
        ranking_indexes: {
          by_timeframe: rankingByTimeframe,
          hashtag_posts_24h: publicPostPopularityLedger.ranking_indexes.hashtag_posts_24h.slice(
            0,
            parsedQuery.data.rankLimit
          )
        }
      };
      const publicProfileLedgerPage: PublicProfileLedgerExport = {
        ...publicProfileLedger,
        users: usersPage.page
      };
      return reply.code(200).send({
        profile_ledger: publicProfileLedgerPage,
        post_popularity_ledger: publicPostPopularityLedgerPage,
        hashtag_ledger: publicPostPopularityLedgerPage.hashtag_ledger,
        commitments: {
          raw_post_popularity_ledger_sha256: sha256Of(rawPostPopularityLedger),
          public_post_popularity_ledger_sha256: sha256Of(publicPostPopularityLedger),
          hashtag_ledger_sha256: sha256Of(rawPostPopularityLedger.hashtag_ledger)
        },
        pagination: {
          users: {
            offset: parsedQuery.data.usersOffset,
            limit: parsedQuery.data.usersLimit,
            page_size: usersPage.pageSize,
            total: usersPage.total,
            next_offset: usersPage.nextOffset
          },
          posts: {
            offset: parsedQuery.data.postsOffset,
            limit: parsedQuery.data.postsLimit,
            page_size: postsPage.pageSize,
            total: postsPage.total,
            next_offset: postsPage.nextOffset
          },
          rank_limit: parsedQuery.data.rankLimit,
          hashtag_limit: parsedQuery.data.hashtagLimit
        }
      });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: "ledger_export_failed",
        message: "Unable to export ledgers."
      });
    }
  });

  app.get("/v1/ledger/hashtags", async (request, reply) => {
    const parsed = hashtagQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid hashtag ledger query payload",
        details: parsed.error.issues
      });
    }

    try {
      const snapshot = await postLedger.getHashtagSnapshot(parsed.data.limit);
      return reply.code(200).send(snapshot);
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: "hashtag_ledger_read_failed",
        message: "Unable to read hashtag ledger."
      });
    }
  });

  app.get("/v1/ledger/posts/:postId/comments", async (request, reply) => {
    const parsed = postParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post id payload",
        details: parsed.error.issues
      });
    }

    try {
      const identity = await readAuthenticatedIdentity(request, authSessions);
      const viewerProfile = identity
        ? await profileLedger.getByProviderSubject(identity.provider, identity.subject)
        : null;
      const comments = await postLedger.listPostComments(parsed.data.postId, viewerProfile?.handle);
      return reply.code(200).send({ comments });
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        error: "post_comment_read_failed",
        message: "Unable to load post comments."
      });
    }
  });

  app.post("/v1/ledger/posts/:postId/comments", async (request, reply) => {
    const viewerProfile = await requireViewerProfile(request, reply);
    if (!viewerProfile) {
      return;
    }
    const paramsParsed = postParamsSchema.safeParse(request.params);
    const bodyParsed = postCommentBodySchema.safeParse(request.body);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post comment payload",
        details: paramsParsed.error.issues
      });
    }
    if (!bodyParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post comment payload",
        details: bodyParsed.error.issues
      });
    }

    try {
      const comment = await postLedger.addPostComment({
        postId: paramsParsed.data.postId,
        author: viewerProfile.name,
        handle: viewerProfile.handle,
        text: bodyParsed.data.text
      });
      return reply.code(200).send({ ok: true, comment });
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "Unable to add post comment.";
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({
          error: "post_not_found",
          message
        });
      }
      return reply.code(500).send({
        error: "post_comment_write_failed",
        message: "Unable to add post comment."
      });
    }
  });

  app.post("/v1/ledger/posts/:postId/comments/:commentId/replies", async (request, reply) => {
    const viewerProfile = await requireViewerProfile(request, reply);
    if (!viewerProfile) {
      return;
    }
    const paramsParsed = postCommentParamsSchema.safeParse(request.params);
    const bodyParsed = postCommentBodySchema.safeParse(request.body);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post reply payload",
        details: paramsParsed.error.issues
      });
    }
    if (!bodyParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid post reply payload",
        details: bodyParsed.error.issues
      });
    }

    try {
      const replyRecord = await postLedger.addPostReply({
        postId: paramsParsed.data.postId,
        commentId: paramsParsed.data.commentId,
        author: viewerProfile.name,
        handle: viewerProfile.handle,
        text: bodyParsed.data.text
      });
      return reply.code(200).send({ ok: true, reply: replyRecord });
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "Unable to add post reply.";
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({
          error: "comment_not_found",
          message
        });
      }
      return reply.code(500).send({
        error: "post_reply_write_failed",
        message: "Unable to add post reply."
      });
    }
  });

  app.post("/v1/ledger/posts/:postId/comments/:commentId/reaction", async (request, reply) => {
    const viewerProfile = await requireViewerProfile(request, reply);
    if (!viewerProfile) {
      return;
    }
    const paramsParsed = postCommentParamsSchema.safeParse(request.params);
    const bodyParsed = reactionBodySchema.safeParse(request.body);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid comment reaction payload",
        details: paramsParsed.error.issues
      });
    }
    if (!bodyParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid comment reaction payload",
        details: bodyParsed.error.issues
      });
    }

    try {
      const comment = await postLedger.setCommentReaction({
        postId: paramsParsed.data.postId,
        commentId: paramsParsed.data.commentId,
        actorId: viewerProfile.handle,
        reaction: bodyParsed.data.reaction
      });
      return reply.code(200).send({ ok: true, comment });
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "Unable to set comment reaction.";
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({
          error: "comment_not_found",
          message
        });
      }
      return reply.code(500).send({
        error: "comment_reaction_write_failed",
        message: "Unable to set comment reaction."
      });
    }
  });

  app.post("/v1/ledger/posts/:postId/comments/:commentId/replies/:replyId/reaction", async (request, reply) => {
    const viewerProfile = await requireViewerProfile(request, reply);
    if (!viewerProfile) {
      return;
    }
    const paramsParsed = postReplyParamsSchema.safeParse(request.params);
    const bodyParsed = reactionBodySchema.safeParse(request.body);
    if (!paramsParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid reply reaction payload",
        details: paramsParsed.error.issues
      });
    }
    if (!bodyParsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid reply reaction payload",
        details: bodyParsed.error.issues
      });
    }

    try {
      const replyRecord = await postLedger.setReplyReaction({
        postId: paramsParsed.data.postId,
        commentId: paramsParsed.data.commentId,
        replyId: paramsParsed.data.replyId,
        actorId: viewerProfile.handle,
        reaction: bodyParsed.data.reaction
      });
      return reply.code(200).send({ ok: true, reply: replyRecord });
    } catch (error) {
      request.log.error(error);
      const message = error instanceof Error ? error.message : "Unable to set reply reaction.";
      if (message.toLowerCase().includes("not found")) {
        return reply.code(404).send({
          error: "reply_not_found",
          message
        });
      }
      return reply.code(500).send({
        error: "reply_reaction_write_failed",
        message: "Unable to set reply reaction."
      });
    }
  });
}
