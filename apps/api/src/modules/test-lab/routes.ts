import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PostPopularityLedgerService } from "../ledger/service.js";
import type { PostLedgerClientPayload, PostPopularityLedger } from "../ledger/types.js";

const userSchema = z.object({
  handle: z.string().min(2).max(33),
  displayName: z.string().min(1).max(120),
  countryCode: z.string().min(2).max(8).default("US"),
  countryName: z.string().min(2).max(120).default("United States")
});

const postSchema = z.object({
  handle: z.string().min(2).max(33),
  caption: z.string().min(1).max(20000),
  createdAtMs: z.number().int().positive().optional(),
  countryCode: z.string().min(2).max(8).optional(),
  countryName: z.string().min(2).max(120).optional(),
  upvotes: z.number().int().min(0).default(0),
  neutralVotes: z.number().int().min(0).default(0),
  downvotes: z.number().int().min(0).default(0),
  mediaType: z.enum(["video", "gif", "png"]).optional(),
  mediaUrl: z.string().url().optional(),
  anonymous: z.boolean().default(false)
});

const commentSchema = z.object({
  handle: z.string().min(2).max(33),
  postId: z.string().min(1).max(220),
  text: z.string().min(1).max(10000)
});

const replySchema = z.object({
  handle: z.string().min(2).max(33),
  postId: z.string().min(1).max(220),
  commentId: z.string().min(1).max(220),
  text: z.string().min(1).max(10000)
});

const scenarioSchema = z.object({
  scenarioId: z.enum(["post-comment-reply", "ranking-likes-24h", "hashtag-trending-24h"])
});

const postListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

interface TestLabUser {
  handle: string;
  displayName: string;
  countryCode: string;
  countryName: string;
  createdAt: string;
}

interface ScenarioAssertion {
  name: string;
  pass: boolean;
  details: string;
}

function normalizeHandle(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "@member";
  }
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function defaultDisplayNameFromHandle(handle: string): string {
  return handle.replace(/^@+/, "") || "Member";
}

function textBlock(post: PostPopularityLedger["posts"][string]): string {
  const block = post.content_blocks.find((item) => item.type === "text");
  return block?.type === "text" ? block.text : "";
}

function captionPreview(caption: string): string {
  const compact = caption.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function toUserList(users: Map<string, TestLabUser>): TestLabUser[] {
  return [...users.values()].sort((left, right) => left.handle.localeCompare(right.handle));
}

export async function registerTestLabRoutes(
  app: FastifyInstance,
  postLedgerPath: string
): Promise<void> {
  const postLedger = new PostPopularityLedgerService(postLedgerPath);
  const users = new Map<string, TestLabUser>();

  function upsertUser(input: z.infer<typeof userSchema>): TestLabUser {
    const handle = normalizeHandle(input.handle);
    const existing = users.get(handle);
    const nextUser: TestLabUser = {
      handle,
      displayName: input.displayName.trim() || defaultDisplayNameFromHandle(handle),
      countryCode: input.countryCode.trim().toUpperCase(),
      countryName: input.countryName.trim(),
      createdAt: existing?.createdAt ?? new Date().toISOString()
    };
    users.set(handle, nextUser);
    return nextUser;
  }

  function requireUser(handleRaw: string): TestLabUser {
    const handle = normalizeHandle(handleRaw);
    const existing = users.get(handle);
    if (existing) {
      return existing;
    }
    const created = upsertUser({
      handle,
      displayName: defaultDisplayNameFromHandle(handle),
      countryCode: "US",
      countryName: "United States"
    });
    return created;
  }

  function toPostPayload(input: z.infer<typeof postSchema>): PostLedgerClientPayload {
    const user = requireUser(input.handle);
    return {
      id: `post-test-${Date.now()}-${crypto.randomUUID()}`,
      author: user.displayName,
      handle: user.handle,
      isAnonymous: input.anonymous,
      anonymousKey: input.anonymous ? `anon_test_${crypto.randomUUID().slice(0, 16)}` : undefined,
      caption: input.caption,
      createdAtMs: input.createdAtMs ?? Date.now(),
      countryCode: (input.countryCode ?? user.countryCode).trim().toUpperCase(),
      countryName: (input.countryName ?? user.countryName).trim(),
      mediaType: input.mediaType,
      mediaUrl: input.mediaUrl,
      upvotes: input.upvotes,
      neutralVotes: input.neutralVotes,
      downvotes: input.downvotes,
      comments: 0
    };
  }

  async function postSummaries(limit: number): Promise<Array<{
    postId: string;
    handle: string;
    author: string;
    captionPreview: string;
    hashtags: string[];
    likes: number;
    neutral: number;
    dislikes: number;
    commentsCount: number;
    createdAt: string;
    commentIds: string[];
  }>> {
    const snapshot = await postLedger.getLedgerSnapshot();
    const rows = Object.values(snapshot.posts)
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice(0, limit)
      .map((post) => ({
        postId: post.post_id,
        handle: post.author.mode === "named" ? post.author.usertag : "@anonymous",
        author: post.author.mode === "named" ? post.author.username : "Anonymous",
        captionPreview: captionPreview(textBlock(post)),
        hashtags: [...post.hashtags],
        likes: post.engagement.likes,
        neutral: post.engagement.neutral,
        dislikes: post.engagement.dislikes,
        commentsCount: post.engagement.comments_count,
        createdAt: post.created_at,
        commentIds: post.engagement.comments.map((comment) => comment.comment_id)
      }));
    return rows;
  }

  async function runScenario(scenarioId: z.infer<typeof scenarioSchema>["scenarioId"]): Promise<{
    scenarioId: string;
    ok: boolean;
    assertions: ScenarioAssertion[];
  }> {
    const assertions: ScenarioAssertion[] = [];

    if (scenarioId === "post-comment-reply") {
      const alice = upsertUser({
        handle: "@test_alice",
        displayName: "Test Alice",
        countryCode: "US",
        countryName: "United States"
      });
      const bob = upsertUser({
        handle: "@test_bob",
        displayName: "Test Bob",
        countryCode: "CA",
        countryName: "Canada"
      });

      const payload = toPostPayload({
        handle: alice.handle,
        caption: "test-lab scenario: post + comment + reply",
        upvotes: 5,
        neutralVotes: 1,
        downvotes: 0,
        anonymous: false
      });
      await postLedger.upsertPost(payload);
      const comment = await postLedger.addPostComment({
        postId: payload.id,
        author: bob.displayName,
        handle: bob.handle,
        text: "Looks good from test suite."
      });
      await postLedger.addPostReply({
        postId: payload.id,
        commentId: comment.comment_id,
        author: alice.displayName,
        handle: alice.handle,
        text: "Acknowledged."
      });
      const comments = await postLedger.listPostComments(payload.id);
      const firstComment = comments[0];
      assertions.push({
        name: "comment_created",
        pass: Boolean(firstComment),
        details: firstComment ? `created comment ${firstComment.comment_id}` : "no comment returned"
      });
      assertions.push({
        name: "reply_created",
        pass: Boolean(firstComment?.replies?.length && firstComment.replies.length > 0),
        details: firstComment?.replies?.length ? `reply count ${firstComment.replies.length}` : "no replies returned"
      });
    }

    if (scenarioId === "ranking-likes-24h") {
      const nowMs = Date.now();
      const baseUsers = [
        upsertUser({ handle: "@rank_a", displayName: "Rank A", countryCode: "US", countryName: "United States" }),
        upsertUser({ handle: "@rank_b", displayName: "Rank B", countryCode: "US", countryName: "United States" }),
        upsertUser({ handle: "@rank_c", displayName: "Rank C", countryCode: "US", countryName: "United States" })
      ];
      const posts = [
        { user: baseUsers[0]!, likes: 4, offsetMs: 5 * 60 * 1000 },
        { user: baseUsers[1]!, likes: 11, offsetMs: 8 * 60 * 1000 },
        { user: baseUsers[2]!, likes: 7, offsetMs: 6 * 60 * 1000 }
      ];
      for (const item of posts) {
        await postLedger.upsertPost({
          id: `post-test-rank-${crypto.randomUUID()}`,
          author: item.user.displayName,
          handle: item.user.handle,
          caption: `ranking scenario ${item.likes}`,
          createdAtMs: nowMs - item.offsetMs,
          countryCode: item.user.countryCode,
          countryName: item.user.countryName,
          upvotes: item.likes,
          neutralVotes: 0,
          downvotes: 0,
          comments: 0
        });
      }
      const snapshot = await postLedger.getLedgerSnapshot();
      const likes24h = snapshot.ranking_indexes.by_timeframe["24h"].likes.slice(0, 3).map((entry) => entry.likes);
      assertions.push({
        name: "ranking_desc_by_likes",
        pass: likes24h.length >= 2 && likes24h[0]! >= likes24h[1]!,
        details: `top likes: ${likes24h.join(", ")}`
      });
    }

    if (scenarioId === "hashtag-trending-24h") {
      const user = upsertUser({
        handle: "@hash_tester",
        displayName: "Hash Tester",
        countryCode: "US",
        countryName: "United States"
      });
      await postLedger.upsertPost({
        id: `post-test-hash-${crypto.randomUUID()}`,
        author: user.displayName,
        handle: user.handle,
        caption: "load #testlab #quality",
        createdAtMs: Date.now() - 60_000,
        countryCode: user.countryCode,
        countryName: user.countryName,
        upvotes: 9,
        neutralVotes: 0,
        downvotes: 0,
        comments: 0
      });
      const hashtags = await postLedger.getHashtagSnapshot(10);
      const top = hashtags.top_hashtags[0];
      assertions.push({
        name: "hashtag_ledger_populated",
        pass: Boolean(top),
        details: top ? `top hashtag ${top.hashtag} with ${top.likes_24h}` : "no hashtags in top list"
      });
    }

    return {
      scenarioId,
      ok: assertions.every((assertion) => assertion.pass),
      assertions
    };
  }

  app.get("/v1/test-lab/health", async () => {
    return {
      ok: true,
      suite: "test-lab-v1",
      users_count: users.size
    };
  });

  app.get("/v1/test-lab/users", async () => {
    return { users: toUserList(users) };
  });

  app.post("/v1/test-lab/users/upsert", async (request, reply) => {
    const parsed = userSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid test lab user payload.",
        details: parsed.error.issues
      });
    }
    const user = upsertUser(parsed.data);
    return reply.code(200).send({ ok: true, user });
  });

  app.get("/v1/test-lab/posts", async (request, reply) => {
    const parsed = postListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid test lab post query payload.",
        details: parsed.error.issues
      });
    }
    const posts = await postSummaries(parsed.data.limit);
    return reply.code(200).send({ posts });
  });

  app.post("/v1/test-lab/posts", async (request, reply) => {
    const parsed = postSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid test lab post payload.",
        details: parsed.error.issues
      });
    }
    const payload = toPostPayload(parsed.data);
    await postLedger.upsertPost(payload);
    return reply.code(200).send({
      ok: true,
      postId: payload.id
    });
  });

  app.post("/v1/test-lab/comments", async (request, reply) => {
    const parsed = commentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid test lab comment payload.",
        details: parsed.error.issues
      });
    }
    const user = requireUser(parsed.data.handle);
    try {
      const comment = await postLedger.addPostComment({
        postId: parsed.data.postId,
        author: user.displayName,
        handle: user.handle,
        text: parsed.data.text
      });
      return reply.code(200).send({ ok: true, comment });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add test lab comment.";
      const statusCode = /not found/i.test(message) ? 404 : 400;
      return reply.code(statusCode).send({
        error: "test_lab_comment_failed",
        message
      });
    }
  });

  app.post("/v1/test-lab/replies", async (request, reply) => {
    const parsed = replySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid test lab reply payload.",
        details: parsed.error.issues
      });
    }
    const user = requireUser(parsed.data.handle);
    try {
      const replyRecord = await postLedger.addPostReply({
        postId: parsed.data.postId,
        commentId: parsed.data.commentId,
        author: user.displayName,
        handle: user.handle,
        text: parsed.data.text
      });
      return reply.code(200).send({ ok: true, reply: replyRecord });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add test lab reply.";
      const statusCode = /not found/i.test(message) ? 404 : 400;
      return reply.code(statusCode).send({
        error: "test_lab_reply_failed",
        message
      });
    }
  });

  app.get("/v1/test-lab/scenarios", async () => {
    return {
      scenarios: [
        {
          id: "post-comment-reply",
          label: "Post + Comment + Reply",
          description: "Creates one post, then adds a comment and a reply."
        },
        {
          id: "ranking-likes-24h",
          label: "Ranking by Likes (24h)",
          description: "Creates posts with different likes and verifies descending order."
        },
        {
          id: "hashtag-trending-24h",
          label: "Hashtag Trending (24h)",
          description: "Creates hashtag posts and verifies hashtag ledger population."
        }
      ]
    };
  });

  app.post("/v1/test-lab/scenarios/run", async (request, reply) => {
    const parsed = scenarioSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "validation_error",
        message: "Invalid test lab scenario payload.",
        details: parsed.error.issues
      });
    }
    try {
      const result = await runScenario(parsed.data.scenarioId);
      return reply.code(200).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Test scenario failed unexpectedly.";
      return reply.code(500).send({
        error: "test_lab_scenario_failed",
        message
      });
    }
  });

  app.get("/v1/test-lab/bootstrap", async () => {
    const [posts, snapshot] = await Promise.all([
      postSummaries(100),
      postLedger.getLedgerSnapshot()
    ]);
    const recentComments = posts
      .slice(0, 20)
      .flatMap((post) => {
        const sourcePost = snapshot.posts[post.postId];
        if (!sourcePost) {
          return [];
        }
        return sourcePost.engagement.comments.map((comment) => ({
          postId: post.postId,
          commentId: comment.comment_id,
          author: comment.author,
          handle: comment.handle,
          text: comment.text
        }));
      })
      .slice(0, 200);

    return {
      users: toUserList(users),
      posts,
      comments: recentComments
    };
  });
}
