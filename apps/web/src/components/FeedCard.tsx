import { useState } from "react";
import type { FeedPost } from "../types";

interface FeedCardProps {
  post: FeedPost;
  rankScore?: number;
  rankLabel?: string;
}

function ReplyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H10C6 3 3 6 3 10V14C3 18 6 21 10 21H12L16 17H14C11 17 9 15 9 12V10C9 7 11 5 14 5H21V10C21 13 19 15 16 15H13L11 17H16C20 17 23 14 23 10V8C23 5 20 3 16 3H14Z" />
    </svg>
  );
}

function RepostIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17 2L22 7L17 12V9H8V7H17V2ZM7 12V15H16V17H7V22L2 17L7 12Z" />
    </svg>
  );
}

function ViewsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 19H21V21H3V19ZM5 10H8V17H5V10ZM10 6H13V17H10V6ZM15 12H18V17H15V12Z" />
    </svg>
  );
}

function ThumbUpIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 10H6V22H2V10ZM22 11.5C22 10.12 20.88 9 19.5 9H13.22L14.17 4.43L14.2 4.11C14.2 3.7 14.03 3.33 13.76 3.05L12.7 2L6.12 8.59C5.74 8.97 5.5 9.48 5.5 10V20.5C5.5 21.88 6.62 23 8 23H17.5C18.54 23 19.44 22.37 19.82 21.46L22 14.84V11.5Z" />
    </svg>
  );
}

function ThumbDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2 2H6V14H2V2ZM22 12.5C22 13.88 20.88 15 19.5 15H13.22L14.17 19.57L14.2 19.89C14.2 20.3 14.03 20.67 13.76 20.95L12.7 22L6.12 15.41C5.74 15.03 5.5 14.52 5.5 14V3.5C5.5 2.12 6.62 1 8 1H17.5C18.54 1 19.44 1.63 19.82 2.54L22 9.16V12.5Z" />
    </svg>
  );
}

type ReactionState = "up" | "neutral" | "down" | null;
type CommentReaction = "up" | "down" | null;

interface ThreadReply {
  id: string;
  author: string;
  handle: string;
  age: string;
  text: string;
  likes: number;
  dislikes: number;
  reaction: CommentReaction;
}

interface ThreadComment {
  id: string;
  author: string;
  handle: string;
  age: string;
  text: string;
  likes: number;
  dislikes: number;
  reaction: CommentReaction;
  replies: ThreadReply[];
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 1).toUpperCase();
  }
  return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
}

function createSeedComments(post: FeedPost): ThreadComment[] {
  return [
    {
      id: `${post.id}-c1`,
      author: "Jordan Hale",
      handle: "@jordanh",
      age: "1h ago",
      text: `The point about ${post.countryName} creator momentum is solid. Data needs better context though.`,
      likes: 168,
      dislikes: 9,
      reaction: null,
      replies: [
        {
          id: `${post.id}-c1-r1`,
          author: "Nia Carter",
          handle: "@niac",
          age: "49m ago",
          text: "Agree. Trend is real but this month might be an outlier.",
          likes: 54,
          dislikes: 3,
          reaction: null
        },
        {
          id: `${post.id}-c1-r2`,
          author: "Omar Lin",
          handle: "@omarlin",
          age: "37m ago",
          text: "Would like to see retention numbers too, not just growth.",
          likes: 21,
          dislikes: 1,
          reaction: null
        }
      ]
    },
    {
      id: `${post.id}-c2`,
      author: "Cami Ruiz",
      handle: "@camiruiz",
      age: "2h ago",
      text: "Editing quality is good here. Feels like old YouTube documentary energy.",
      likes: 96,
      dislikes: 6,
      reaction: null,
      replies: [
        {
          id: `${post.id}-c2-r1`,
          author: "Theo Park",
          handle: "@theop",
          age: "1h ago",
          text: "Exactly, long-form storytelling but adapted for short feeds.",
          likes: 33,
          dislikes: 2,
          reaction: null
        }
      ]
    }
  ];
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.?0+$/, "");
}

function formatCompact(value: number, maxFractionDigits = 1): string {
  if (value >= 1000000) {
    return `${trimTrailingZeros((value / 1000000).toFixed(maxFractionDigits))}M`;
  }
  if (value >= 1000) {
    return `${trimTrailingZeros((value / 1000).toFixed(maxFractionDigits))}K`;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

function formatLikeCompact(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(3)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(3)}K`;
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  });
}

function countryFlagFromIso2(code: string): string {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return "";
  }
  return String.fromCodePoint(
    normalized.charCodeAt(0) + 127397,
    normalized.charCodeAt(1) + 127397
  );
}

export function FeedCard({ post, rankScore, rankLabel = "Popularity" }: FeedCardProps) {
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [reposted, setReposted] = useState(false);
  const [reactionState, setReactionState] = useState<ReactionState>(null);
  const [commentInput, setCommentInput] = useState("");
  const [threadComments, setThreadComments] = useState<ThreadComment[]>(() => createSeedComments(post));
  const [repliesOpenByComment, setRepliesOpenByComment] = useState<Record<string, boolean>>({});
  const [replyComposerOpenByComment, setReplyComposerOpenByComment] = useState<Record<string, boolean>>({});
  const [replyDraftByComment, setReplyDraftByComment] = useState<Record<string, string>>({});

  const commentCount = post.comments + threadComments.length;
  const repostCount = post.reposts + (reposted ? 1 : 0);
  const upvoteCount = post.upvotes + (reactionState === "up" ? 1 : 0);
  const neutralCount = post.neutralVotes + (reactionState === "neutral" ? 1 : 0);
  const downvoteCount = post.downvotes + (reactionState === "down" ? 1 : 0);
  const totalVoteCount = upvoteCount + neutralCount + downvoteCount;
  const approvalPercent = totalVoteCount > 0 ? (upvoteCount / totalVoteCount) * 100 : 0;

  function submitComment() {
    const trimmed = commentInput.trim();
    if (!trimmed) {
      return;
    }
    setThreadComments((prev) => [
      {
        id: `c-${crypto.randomUUID()}`,
        author: "You",
        handle: "@you",
        age: "just now",
        text: trimmed,
        likes: 0,
        dislikes: 0,
        reaction: null,
        replies: []
      },
      ...prev
    ]);
    setCommentInput("");
    setCommentsOpen(true);
  }

  function toggleReaction(next: Exclude<ReactionState, null>) {
    setReactionState((current) => (current === next ? null : next));
  }

  function toggleCommentReaction(commentId: string, next: CommentReaction) {
    setThreadComments((prev) =>
      prev.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              reaction: comment.reaction === next ? null : next
            }
          : comment
      )
    );
  }

  function toggleReplies(commentId: string) {
    setRepliesOpenByComment((prev) => ({
      ...prev,
      [commentId]: !prev[commentId]
    }));
  }

  function replyEffectiveLikes(reply: ThreadReply): number {
    return reply.likes + (reply.reaction === "up" ? 1 : 0);
  }

  function toggleReplyReaction(commentId: string, replyId: string, next: CommentReaction) {
    setThreadComments((prev) =>
      prev.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: comment.replies.map((reply) =>
                reply.id === replyId
                  ? {
                      ...reply,
                      reaction: reply.reaction === next ? null : next
                    }
                  : reply
              )
            }
          : comment
      )
    );
  }

  function toggleReplyComposer(commentId: string) {
    setReplyComposerOpenByComment((prev) => ({
      ...prev,
      [commentId]: !prev[commentId]
    }));
  }

  function submitReply(commentId: string) {
    const draft = replyDraftByComment[commentId] ?? "";
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }

    setThreadComments((prev) =>
      prev.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              replies: [
                {
                  id: `r-${crypto.randomUUID()}`,
                  author: "You",
                  handle: "@you",
                  age: "now",
                  text: trimmed,
                  likes: 0,
                  dislikes: 0,
                  reaction: null
                },
                ...comment.replies
              ]
            }
          : comment
      )
    );

    setReplyDraftByComment((prev) => ({
      ...prev,
      [commentId]: ""
    }));
    setRepliesOpenByComment((prev) => ({
      ...prev,
      [commentId]: true
    }));
    setReplyComposerOpenByComment((prev) => ({
      ...prev,
      [commentId]: false
    }));
  }

  return (
    <article className="panel feed-card reveal">
      <header className="feed-card__header">
        <div className="feed-card__author">
          <h3>{post.author}</h3>
          <p className="feed-card__meta">
            {post.handle} • {post.createdAt}
          </p>
        </div>
        {rankScore !== undefined ? (
          <span className="rank-pill">
            {rankLabel} {rankScore.toFixed(1)}
          </span>
        ) : null}
      </header>
      <p className="feed-card__caption">{post.caption}</p>
      <div className="feed-card__media">
        {post.videoUrl ? (
          <video src={post.videoUrl} controls playsInline />
        ) : post.posterUrl ? (
          <img src={post.posterUrl} alt={post.caption} loading="lazy" />
        ) : (
          <div className="media-placeholder">No preview available.</div>
        )}
      </div>

      <nav className="feed-card__actions" aria-label="Post actions">
        <div className="feed-actions__left">
          <button
            className={`action-stat action-stat--button ${commentsOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => setCommentsOpen((current) => !current)}
            aria-label="Open comments"
          >
            <span className="action-stat__icon">
              <ReplyIcon />
            </span>
            <strong>{formatCompact(commentCount)}</strong>
          </button>
          <button
            className={`action-stat action-stat--button ${reposted ? "is-active" : ""}`}
            type="button"
            onClick={() => setReposted((current) => !current)}
            aria-label="Toggle repost"
          >
            <span className="action-stat__icon">
              <RepostIcon />
            </span>
            <strong>{formatCompact(repostCount)}</strong>
          </button>
          <button
            className={`action-stat action-stat--button action-stat--quiet ${viewsOpen ? "is-active" : ""}`}
            type="button"
            onClick={() => setViewsOpen((current) => !current)}
            aria-label="Toggle views details"
          >
            <span className="action-stat__icon">
              <ViewsIcon />
            </span>
            <strong>{formatCompact(post.views)}</strong>
          </button>
        </div>

        <div className="reaction-group">
          <button
            className={`reaction-button reaction-button--heart ${reactionState === "up" ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleReaction("up")}
            aria-label="Heart"
          >
            <span className="reaction-button__icon">♥</span>
            <span className="reaction-button__label">Like</span>
            <span className="reaction-button__count">{formatLikeCompact(upvoteCount)}</span>
          </button>
          <button
            className={`reaction-button reaction-button--neutral ${reactionState === "neutral" ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleReaction("neutral")}
            aria-label="Neutral"
          >
            <span className="reaction-button__icon">•</span>
            <span className="reaction-button__label">Neutral</span>
            <span className="reaction-button__count">{formatLikeCompact(neutralCount)}</span>
          </button>
          <button
            className={`reaction-button reaction-button--down ${reactionState === "down" ? "is-active" : ""}`}
            type="button"
            onClick={() => toggleReaction("down")}
            aria-label="Dislike"
          >
            <span className="reaction-button__icon">▼</span>
            <span className="reaction-button__label">Dislike</span>
            <span className="reaction-button__count">{formatLikeCompact(downvoteCount)}</span>
          </button>
        </div>
      </nav>

      {viewsOpen ? (
        <div className="feed-inline-info">
          <strong>{post.views.toLocaleString()} total views</strong>
          <span>{((commentCount / Math.max(1, post.views)) * 100).toFixed(2)}% comment-rate</span>
        </div>
      ) : null}

      {commentsOpen ? (
        <section className="comment-sheet">
          <header className="comment-sheet__header">
            <h4>{formatCompact(commentCount)} Comments</h4>
          </header>
          <div className="yt-compose">
            <div className="yt-avatar yt-avatar--self">Y</div>
            <div className="yt-compose__main">
              <input
                type="text"
                placeholder="Add a comment..."
                value={commentInput}
                onChange={(event) => setCommentInput(event.target.value)}
              />
              <div className="yt-compose__actions">
                <button type="button" className="yt-button-secondary" onClick={() => setCommentInput("")}>
                  Cancel
                </button>
                <button type="button" className="yt-button-primary" onClick={submitComment}>
                  Comment
                </button>
              </div>
            </div>
          </div>
          <div className="yt-comment-list">
            {threadComments.length === 0 ? (
              <p className="comment-empty">No comments yet.</p>
            ) : (
              threadComments.map((comment) => (
                <article key={comment.id} className="yt-comment">
                  <div className="yt-avatar">{initialsFromName(comment.author)}</div>
                  <div className="yt-comment__body">
                    <p className="yt-comment__meta">
                      <strong>{comment.author}</strong> {comment.handle} • {comment.age}
                    </p>
                    <p className="yt-comment__text">{comment.text}</p>
                    <div className="yt-comment__actions">
                      <button
                        className={`yt-comment-action ${comment.reaction === "up" ? "is-active" : ""}`}
                        type="button"
                        onClick={() => toggleCommentReaction(comment.id, "up")}
                      >
                        <ThumbUpIcon />
                        <span>{formatCompact(comment.likes + (comment.reaction === "up" ? 1 : 0))}</span>
                      </button>
                      <button
                        className={`yt-comment-action ${comment.reaction === "down" ? "is-active" : ""}`}
                        type="button"
                        onClick={() => toggleCommentReaction(comment.id, "down")}
                      >
                        <ThumbDownIcon />
                      </button>
                      <button
                        className="yt-comment-action yt-comment-action--text"
                        type="button"
                        onClick={() => toggleReplyComposer(comment.id)}
                      >
                        Reply
                      </button>
                    </div>
                    {replyComposerOpenByComment[comment.id] ? (
                      <div className="yt-reply-compose">
                        <input
                          type="text"
                          placeholder="Write a reply..."
                          value={replyDraftByComment[comment.id] ?? ""}
                          onChange={(event) =>
                            setReplyDraftByComment((prev) => ({
                              ...prev,
                              [comment.id]: event.target.value
                            }))
                          }
                        />
                        <button type="button" onClick={() => submitReply(comment.id)}>
                          Reply
                        </button>
                      </div>
                    ) : null}
                    {comment.replies.length > 0 ? (
                      <>
                        <button className="yt-replies-toggle" type="button" onClick={() => toggleReplies(comment.id)}>
                          {repliesOpenByComment[comment.id] ? "Hide" : "View"} {comment.replies.length} replies
                        </button>
                        {repliesOpenByComment[comment.id] ? (
                          <div className="yt-replies">
                            {[...comment.replies]
                              .sort((a, b) => replyEffectiveLikes(b) - replyEffectiveLikes(a))
                              .map((reply) => (
                              <article key={reply.id} className="yt-reply">
                                <div className="yt-avatar yt-avatar--reply">{initialsFromName(reply.author)}</div>
                                <div className="yt-reply__body">
                                  <p className="yt-comment__meta">
                                    <strong>{reply.author}</strong> {reply.handle} • {reply.age}
                                  </p>
                                  <p className="yt-comment__text">{reply.text}</p>
                                  <div className="yt-reply__actions">
                                    <button
                                      className={`yt-comment-action ${reply.reaction === "up" ? "is-active" : ""}`}
                                      type="button"
                                      onClick={() => toggleReplyReaction(comment.id, reply.id, "up")}
                                    >
                                      <ThumbUpIcon />
                                      <span>{formatCompact(reply.likes + (reply.reaction === "up" ? 1 : 0))}</span>
                                    </button>
                                    <button
                                      className={`yt-comment-action ${reply.reaction === "down" ? "is-active" : ""}`}
                                      type="button"
                                      onClick={() => toggleReplyReaction(comment.id, reply.id, "down")}
                                    >
                                      <ThumbDownIcon />
                                      <span>{formatCompact(reply.dislikes + (reply.reaction === "down" ? 1 : 0))}</span>
                                    </button>
                                  </div>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      ) : null}

      <footer className="feed-card__footer">
        <span className="country-with-flag">
          <span>{post.countryName}</span>
          <span aria-hidden="true">{countryFlagFromIso2(post.countryCode)}</span>
        </span>
        <span className="controversy-indicator">{approvalPercent.toFixed(3)}% approval</span>
      </footer>
    </article>
  );
}
