import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  HashtagLedgerEntry,
  HashtagPostRankEntry,
  PostLedgerCommentRecord,
  PostPopularityLedger,
  PostLedgerClientPayload,
  PostLedgerReplyRecord,
  PostLedgerRankEntry,
  LedgerTimeframe
} from "./types.js";

const TIMEFRAMES: LedgerTimeframe[] = ["10m", "1h", "12h", "24h", "1w", "1m", "3m", "1y"];
const HOUR_MS = 60 * 60 * 1000;

const TIMEFRAME_MAX_MS: Record<LedgerTimeframe, number> = {
  "10m": 10 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
  "3m": 90 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000
};

function normalizedUserIdFromHandle(handle: string): string {
  const token = handle.replace(/^@+/, "").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 48);
  return `u_${token || "member"}`;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function approvalScore(likes: number, neutral: number, dislikes: number): number {
  const total = likes + neutral + dislikes;
  if (total <= 0) {
    return 0.5;
  }
  const weightedPositive = likes + neutral * 0.5;
  return clampPercent((weightedPositive / total) * 100) / 100;
}

function emptyRanking(): PostPopularityLedger["ranking_indexes"]["by_timeframe"] {
  return {
    "10m": { likes: [], approval: [] },
    "1h": { likes: [], approval: [] },
    "12h": { likes: [], approval: [] },
    "24h": { likes: [], approval: [] },
    "1w": { likes: [], approval: [] },
    "1m": { likes: [], approval: [] },
    "3m": { likes: [], approval: [] },
    "1y": { likes: [], approval: [] }
  };
}

function safeIsoDate(createdAtMs: number): string {
  if (Number.isFinite(createdAtMs) && createdAtMs > 0) {
    return new Date(createdAtMs).toISOString();
  }
  return new Date().toISOString();
}

function extractHashtags(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  const tags = new Set<string>();
  const pattern = /(^|[^a-z0-9_])#([a-z0-9_]{1,64})/gi;
  let match = pattern.exec(value);
  while (match) {
    const rawTag = match[2]?.trim().toLowerCase();
    if (rawTag) {
      tags.add(`#${rawTag}`);
    }
    match = pattern.exec(value);
  }
  return [...tags];
}

function textBlockValue(post: PostPopularityLedger["posts"][string]): string {
  const block = post.content_blocks.find((candidate) => candidate.type === "text");
  return block && typeof block.text === "string" ? block.text : "";
}

function captionPreview(caption: string): string {
  const compact = caption.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}

function emptyHashtagLedger(): PostPopularityLedger["hashtag_ledger"] {
  return {
    likes_by_hour: {},
    likes_24h: []
  };
}

function normalizeHandle(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) {
    return "@member";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function normalizeActorId(value: string): string {
  return value.trim().toLowerCase().slice(0, 120);
}

function normalizeReplyRecords(raw: unknown): PostLedgerReplyRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const replies: PostLedgerReplyRecord[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const candidate = value as Partial<PostLedgerReplyRecord>;
    if (typeof candidate.reply_id !== "string" || candidate.reply_id.trim().length === 0) {
      continue;
    }
    if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) {
      continue;
    }
    replies.push({
      reply_id: candidate.reply_id.trim(),
      author: typeof candidate.author === "string" && candidate.author.trim() ? candidate.author.trim() : "Member",
      handle: normalizeHandle(typeof candidate.handle === "string" ? candidate.handle : "@member"),
      text: candidate.text,
      created_at:
        typeof candidate.created_at === "string" && candidate.created_at.trim().length > 0
          ? candidate.created_at
          : new Date().toISOString(),
      likes: typeof candidate.likes === "number" ? Math.max(0, Math.floor(candidate.likes)) : 0,
      dislikes: typeof candidate.dislikes === "number" ? Math.max(0, Math.floor(candidate.dislikes)) : 0,
      reaction_by_actor:
        candidate.reaction_by_actor && typeof candidate.reaction_by_actor === "object"
          ? Object.fromEntries(
              Object.entries(candidate.reaction_by_actor as Record<string, unknown>).filter(
                (entry): entry is [string, "up" | "down"] => entry[1] === "up" || entry[1] === "down"
              )
            )
          : {}
    });
  }
  return replies;
}

function normalizeCommentRecords(raw: unknown): PostLedgerCommentRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const comments: PostLedgerCommentRecord[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const candidate = value as Partial<PostLedgerCommentRecord>;
    if (typeof candidate.comment_id !== "string" || candidate.comment_id.trim().length === 0) {
      continue;
    }
    if (typeof candidate.text !== "string" || candidate.text.trim().length === 0) {
      continue;
    }
    comments.push({
      comment_id: candidate.comment_id.trim(),
      author: typeof candidate.author === "string" && candidate.author.trim() ? candidate.author.trim() : "Member",
      handle: normalizeHandle(typeof candidate.handle === "string" ? candidate.handle : "@member"),
      text: candidate.text,
      created_at:
        typeof candidate.created_at === "string" && candidate.created_at.trim().length > 0
          ? candidate.created_at
          : new Date().toISOString(),
      likes: typeof candidate.likes === "number" ? Math.max(0, Math.floor(candidate.likes)) : 0,
      dislikes: typeof candidate.dislikes === "number" ? Math.max(0, Math.floor(candidate.dislikes)) : 0,
      reaction_by_actor:
        candidate.reaction_by_actor && typeof candidate.reaction_by_actor === "object"
          ? Object.fromEntries(
              Object.entries(candidate.reaction_by_actor as Record<string, unknown>).filter(
                (entry): entry is [string, "up" | "down"] => entry[1] === "up" || entry[1] === "down"
              )
            )
          : {},
      replies: normalizeReplyRecords(candidate.replies)
    });
  }
  return comments;
}

function toClientReply(reply: PostLedgerReplyRecord, actorId?: string): PostLedgerReplyRecord {
  const normalizedActorId = actorId ? normalizeActorId(actorId) : "";
  const viewerReaction = normalizedActorId ? reply.reaction_by_actor?.[normalizedActorId] ?? null : null;
  return {
    reply_id: reply.reply_id,
    author: reply.author,
    handle: reply.handle,
    text: reply.text,
    created_at: reply.created_at,
    likes: reply.likes,
    dislikes: reply.dislikes,
    viewer_reaction: viewerReaction
  };
}

function toClientComment(comment: PostLedgerCommentRecord, actorId?: string): PostLedgerCommentRecord {
  const normalizedActorId = actorId ? normalizeActorId(actorId) : "";
  const viewerReaction = normalizedActorId ? comment.reaction_by_actor?.[normalizedActorId] ?? null : null;
  return {
    comment_id: comment.comment_id,
    author: comment.author,
    handle: comment.handle,
    text: comment.text,
    created_at: comment.created_at,
    likes: comment.likes,
    dislikes: comment.dislikes,
    viewer_reaction: viewerReaction,
    replies: comment.replies.map((reply) => toClientReply(reply, actorId))
  };
}

export class PostPopularityLedgerService {
  private readonly ledgerPath: string;

  private ledgerCache: PostPopularityLedger | null = null;

  private loadingPromise: Promise<PostPopularityLedger> | null = null;

  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(ledgerPath: string) {
    this.ledgerPath = resolve(process.cwd(), ledgerPath);
  }

  async getLedgerSnapshot(): Promise<PostPopularityLedger> {
    const ledger = await this.getLedger();
    this.rebuildRankingIndexes(ledger);
    return structuredClone(ledger);
  }

  async getHashtagSnapshot(limit: number): Promise<{
    timeframe: "24h";
    top_hashtags: HashtagLedgerEntry[];
    top_posts: HashtagPostRankEntry[];
  }> {
    const ledger = await this.getLedger();
    this.rebuildRankingIndexes(ledger);
    const safeLimit = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 10;
    return {
      timeframe: "24h",
      top_hashtags: ledger.hashtag_ledger.likes_24h.slice(0, safeLimit),
      top_posts: ledger.ranking_indexes.hashtag_posts_24h.slice(0, safeLimit)
    };
  }

  async listPostComments(postId: string, actorId?: string): Promise<PostLedgerCommentRecord[]> {
    const ledger = await this.getLedger();
    const record = ledger.posts[postId];
    if (!record) {
      return [];
    }
    const comments = normalizeCommentRecords(record.engagement.comments);
    return structuredClone(comments.map((comment) => toClientComment(comment, actorId)));
  }

  async addPostComment(input: {
    postId: string;
    author: string;
    handle: string;
    text: string;
  }): Promise<PostLedgerCommentRecord> {
    const result = await this.mutateLedger((ledger) => {
      const record = ledger.posts[input.postId];
      if (!record) {
        throw new Error("Post not found in ledger.");
      }
      const comments = normalizeCommentRecords(record.engagement.comments);
      const created: PostLedgerCommentRecord = {
        comment_id: `comment_${crypto.randomUUID()}`,
        author: input.author.trim() || "Member",
        handle: normalizeHandle(input.handle),
        text: input.text,
        created_at: new Date().toISOString(),
        likes: 0,
        dislikes: 0,
        reaction_by_actor: {},
        replies: []
      };
      comments.unshift(created);
      record.engagement.comments = comments;
      record.engagement.comments_count = comments.length;
      return created;
    });
    return structuredClone(toClientComment(result));
  }

  async addPostReply(input: {
    postId: string;
    commentId: string;
    author: string;
    handle: string;
    text: string;
  }): Promise<PostLedgerReplyRecord> {
    const result = await this.mutateLedger((ledger) => {
      const record = ledger.posts[input.postId];
      if (!record) {
        throw new Error("Post not found in ledger.");
      }
      const comments = normalizeCommentRecords(record.engagement.comments);
      const comment = comments.find((item) => item.comment_id === input.commentId);
      if (!comment) {
        throw new Error("Comment not found in ledger.");
      }
      const created: PostLedgerReplyRecord = {
        reply_id: `reply_${crypto.randomUUID()}`,
        author: input.author.trim() || "Member",
        handle: normalizeHandle(input.handle),
        text: input.text,
        created_at: new Date().toISOString(),
        likes: 0,
        dislikes: 0,
        reaction_by_actor: {}
      };
      comment.replies = [created, ...comment.replies];
      record.engagement.comments = comments;
      record.engagement.comments_count = comments.length;
      return created;
    });
    return structuredClone(toClientReply(result));
  }

  async setCommentReaction(input: {
    postId: string;
    commentId: string;
    actorId: string;
    reaction: "up" | "down" | "none";
  }): Promise<PostLedgerCommentRecord> {
    const result = await this.mutateLedger((ledger) => {
      const record = ledger.posts[input.postId];
      if (!record) {
        throw new Error("Post not found in ledger.");
      }
      const comments = normalizeCommentRecords(record.engagement.comments);
      const comment = comments.find((item) => item.comment_id === input.commentId);
      if (!comment) {
        throw new Error("Comment not found in ledger.");
      }
      const actorId = normalizeActorId(input.actorId);
      if (!actorId) {
        throw new Error("Actor id is required.");
      }
      const map = comment.reaction_by_actor ?? {};
      const previous = map[actorId] ?? null;
      const next = input.reaction === "none" ? null : input.reaction;
      if (previous !== next) {
        if (previous === "up") {
          comment.likes = Math.max(0, comment.likes - 1);
        } else if (previous === "down") {
          comment.dislikes = Math.max(0, comment.dislikes - 1);
        }
        if (next === "up") {
          comment.likes += 1;
          map[actorId] = "up";
        } else if (next === "down") {
          comment.dislikes += 1;
          map[actorId] = "down";
        } else {
          delete map[actorId];
        }
      }
      comment.reaction_by_actor = map;
      record.engagement.comments = comments;
      record.engagement.comments_count = comments.length;
      return toClientComment(comment, actorId);
    });
    return structuredClone(result);
  }

  async setReplyReaction(input: {
    postId: string;
    commentId: string;
    replyId: string;
    actorId: string;
    reaction: "up" | "down" | "none";
  }): Promise<PostLedgerReplyRecord> {
    const result = await this.mutateLedger((ledger) => {
      const record = ledger.posts[input.postId];
      if (!record) {
        throw new Error("Post not found in ledger.");
      }
      const comments = normalizeCommentRecords(record.engagement.comments);
      const comment = comments.find((item) => item.comment_id === input.commentId);
      if (!comment) {
        throw new Error("Comment not found in ledger.");
      }
      const reply = comment.replies.find((item) => item.reply_id === input.replyId);
      if (!reply) {
        throw new Error("Reply not found in ledger.");
      }
      const actorId = normalizeActorId(input.actorId);
      if (!actorId) {
        throw new Error("Actor id is required.");
      }
      const map = reply.reaction_by_actor ?? {};
      const previous = map[actorId] ?? null;
      const next = input.reaction === "none" ? null : input.reaction;
      if (previous !== next) {
        if (previous === "up") {
          reply.likes = Math.max(0, reply.likes - 1);
        } else if (previous === "down") {
          reply.dislikes = Math.max(0, reply.dislikes - 1);
        }
        if (next === "up") {
          reply.likes += 1;
          map[actorId] = "up";
        } else if (next === "down") {
          reply.dislikes += 1;
          map[actorId] = "down";
        } else {
          delete map[actorId];
        }
      }
      reply.reaction_by_actor = map;
      record.engagement.comments = comments;
      record.engagement.comments_count = comments.length;
      return toClientReply(reply, actorId);
    });
    return structuredClone(result);
  }

  async upsertPost(payload: PostLedgerClientPayload): Promise<void> {
    await this.mutateLedger((ledger) => {
      const createdAtIso = safeIsoDate(payload.createdAtMs);
      const postId = payload.id.trim();
      if (!postId) {
        return;
      }

      const existing = ledger.posts[postId];
      const authorHandle = payload.handle.startsWith("@") ? payload.handle : `@${payload.handle}`;
      const isAnonymous = payload.isAnonymous === true;
      const anonymousKey =
        typeof payload.anonymousKey === "string" && payload.anonymousKey.trim().length > 0
          ? payload.anonymousKey.trim()
          : `anon_${postId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32)}`;
      const likes = Math.max(0, Math.floor(payload.upvotes));
      const neutral = Math.max(0, Math.floor(payload.neutralVotes));
      const dislikes = Math.max(0, Math.floor(payload.downvotes));
      const existingComments = normalizeCommentRecords(existing?.engagement?.comments);
      const commentsCount = existingComments.length;
      const score = approvalScore(likes, neutral, dislikes);
      const hashtags = extractHashtags(payload.caption);

      const blocks: PostPopularityLedger["posts"][string]["content_blocks"] = [
        {
          type: "text",
          text: payload.caption,
          encoding: "UTF-8"
        }
      ];
      if (payload.mediaType && payload.mediaUrl && !payload.mediaUrl.startsWith("blob:")) {
        blocks.push({
          type: "media",
          media_kind: payload.mediaType,
          url: payload.mediaUrl
        });
      }

      ledger.posts[postId] = {
        post_id: postId,
        created_at: createdAtIso,
        author: isAnonymous
          ? {
              mode: "anonymous",
              anonymous_key: anonymousKey
            }
          : {
              mode: "named",
              user_id: normalizedUserIdFromHandle(authorHandle),
              username: payload.author,
              usertag: authorHandle
        },
        content_blocks: blocks,
        hashtags,
        location: {
          country: payload.countryName,
          country_code: payload.countryCode
        },
        engagement: {
          likes,
          neutral,
          dislikes,
          comments_count: commentsCount,
          comments: existingComments,
          approval_score: score
        }
      };

      this.rebuildRankingIndexes(ledger);
    });
  }

  private rebuildRankingIndexes(ledger: PostPopularityLedger): void {
    const nowMs = Date.now();
    const allPosts = Object.values(ledger.posts);
    const nextIndexes = emptyRanking();

    for (const timeframe of TIMEFRAMES) {
      const candidates = allPosts.filter((post) => {
        const ageMs = nowMs - new Date(post.created_at).getTime();
        // Cumulative bins: each larger timeframe includes posts up to that age.
        return ageMs >= 0 && ageMs <= TIMEFRAME_MAX_MS[timeframe];
      });

      const ranked = candidates.map((post) => {
        const rank: Omit<PostLedgerRankEntry, "score"> = {
          post_id: post.post_id,
          likes: post.engagement.likes,
          approval_score: post.engagement.approval_score,
          created_at: post.created_at
        };
        return rank;
      });

      nextIndexes[timeframe].likes = [...ranked]
        .sort((left, right) => {
          if (right.likes !== left.likes) {
            return right.likes - left.likes;
          }
          return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        })
        .map((entry) => ({
          ...entry,
          score: entry.likes
        }));

      nextIndexes[timeframe].approval = [...ranked]
        .sort((left, right) => {
          if (right.approval_score !== left.approval_score) {
            return right.approval_score - left.approval_score;
          }
          if (right.likes !== left.likes) {
            return right.likes - left.likes;
          }
          return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        })
        .map((entry) => ({
          ...entry,
          score: entry.approval_score
        }));
    }

    ledger.ranking_indexes.by_timeframe = nextIndexes;
    this.rebuildHashtag24hIndexes(ledger, nowMs);
  }

  private rebuildHashtag24hIndexes(ledger: PostPopularityLedger, nowMs: number): void {
    const likesByHour: Record<string, Record<string, number>> = {};
    const totalsByHashtag = new Map<string, number>();

    for (const post of Object.values(ledger.posts)) {
      const createdAtMs = new Date(post.created_at).getTime();
      const ageMs = nowMs - createdAtMs;
      if (!Number.isFinite(createdAtMs) || ageMs < 0 || ageMs > TIMEFRAME_MAX_MS["24h"]) {
        continue;
      }
      if (!Array.isArray(post.hashtags) || post.hashtags.length === 0) {
        continue;
      }
      const likes = Math.max(0, Math.floor(post.engagement.likes));
      if (likes <= 0) {
        continue;
      }
      const hourIso = new Date(Math.floor(createdAtMs / HOUR_MS) * HOUR_MS).toISOString();
      if (!likesByHour[hourIso]) {
        likesByHour[hourIso] = {};
      }
      const bucket = likesByHour[hourIso]!;
      for (const hashtag of post.hashtags) {
        bucket[hashtag] = (bucket[hashtag] ?? 0) + likes;
        totalsByHashtag.set(hashtag, (totalsByHashtag.get(hashtag) ?? 0) + likes);
      }
    }

    const updatedAt = new Date(nowMs).toISOString();
    const likes24h: HashtagLedgerEntry[] = [...totalsByHashtag.entries()]
      .map(([hashtag, likes]) => ({
        hashtag,
        likes_24h: likes,
        updated_at: updatedAt
      }))
      .sort((left, right) => {
        if (right.likes_24h !== left.likes_24h) {
          return right.likes_24h - left.likes_24h;
        }
        return left.hashtag.localeCompare(right.hashtag);
      });

    ledger.hashtag_ledger.likes_by_hour = likesByHour;
    ledger.hashtag_ledger.likes_24h = likes24h;

    const hashtagPosts = Object.values(ledger.posts)
      .filter((post) => {
        const ageMs = nowMs - new Date(post.created_at).getTime();
        return ageMs >= 0 && ageMs <= TIMEFRAME_MAX_MS["24h"] && Array.isArray(post.hashtags) && post.hashtags.length > 0;
      })
      .sort((left, right) => {
        if (right.engagement.likes !== left.engagement.likes) {
          return right.engagement.likes - left.engagement.likes;
        }
        if (right.engagement.approval_score !== left.engagement.approval_score) {
          return right.engagement.approval_score - left.engagement.approval_score;
        }
        return new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
      })
      .map<HashtagPostRankEntry>((post) => ({
        post_id: post.post_id,
        score: post.engagement.likes,
        likes: post.engagement.likes,
        approval_score: post.engagement.approval_score,
        created_at: post.created_at,
        hashtags: post.hashtags,
        caption_preview: captionPreview(textBlockValue(post))
      }));

    ledger.ranking_indexes.hashtag_posts_24h = hashtagPosts;
  }

  private async getLedger(): Promise<PostPopularityLedger> {
    if (this.ledgerCache) {
      return this.ledgerCache;
    }
    if (this.loadingPromise) {
      return this.loadingPromise;
    }
    this.loadingPromise = this.loadLedgerFromDisk().finally(() => {
      this.loadingPromise = null;
    });
    this.ledgerCache = await this.loadingPromise;
    return this.ledgerCache;
  }

  private async loadLedgerFromDisk(): Promise<PostPopularityLedger> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    try {
      const raw = await readFile(this.ledgerPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PostPopularityLedger> | null;
      if (
        !parsed ||
        typeof parsed !== "object" ||
        typeof parsed.ledger_version !== "string" ||
        typeof parsed.generated_at !== "string" ||
        !parsed.posts ||
        typeof parsed.posts !== "object"
      ) {
        throw new Error("Invalid post ledger shape.");
      }
      const normalized: PostPopularityLedger = {
        ledger_version: parsed.ledger_version,
        generated_at: parsed.generated_at,
        approval_formula: "(likes + 0.5*neutral) / (likes + neutral + dislikes)",
        timeframes: [...TIMEFRAMES],
        posts: parsed.posts as PostPopularityLedger["posts"],
        hashtag_ledger:
          parsed.hashtag_ledger &&
          typeof parsed.hashtag_ledger === "object" &&
          parsed.hashtag_ledger.likes_by_hour &&
          typeof parsed.hashtag_ledger.likes_by_hour === "object"
            ? {
                likes_by_hour: parsed.hashtag_ledger.likes_by_hour as Record<string, Record<string, number>>,
                likes_24h: []
              }
            : emptyHashtagLedger(),
        ranking_indexes: {
          by_timeframe: emptyRanking(),
          hashtag_posts_24h: []
        }
      };
      for (const post of Object.values(normalized.posts)) {
        if (!post.engagement || typeof post.engagement !== "object") {
          post.engagement = {
            likes: 0,
            neutral: 0,
            dislikes: 0,
            comments_count: 0,
            comments: [],
            approval_score: 0.5
          };
        }
        if (!Array.isArray(post.hashtags)) {
          post.hashtags = extractHashtags(textBlockValue(post));
        }
        post.engagement.comments = normalizeCommentRecords(post.engagement.comments);
        post.engagement.comments_count = post.engagement.comments.length;
      }
      this.rebuildRankingIndexes(normalized);
      return normalized;
    } catch {
      const initial: PostPopularityLedger = {
        ledger_version: "v1.0",
        generated_at: new Date().toISOString(),
        approval_formula: "(likes + 0.5*neutral) / (likes + neutral + dislikes)",
        timeframes: [...TIMEFRAMES],
        posts: {},
        hashtag_ledger: emptyHashtagLedger(),
        ranking_indexes: {
          by_timeframe: emptyRanking(),
          hashtag_posts_24h: []
        }
      };
      await this.persistLedger(initial);
      return initial;
    }
  }

  private async mutateLedger<T>(mutator: (ledger: PostPopularityLedger) => T): Promise<T> {
    return this.withMutationLock(async () => {
      const ledger = await this.getLedger();
      const result = mutator(ledger);
      ledger.generated_at = new Date().toISOString();
      await this.persistLedger(ledger);
      return result;
    });
  }

  private async persistLedger(ledger: PostPopularityLedger): Promise<void> {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    const tmpPath = `${this.ledgerPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.ledgerPath);
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
