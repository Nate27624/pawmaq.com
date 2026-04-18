export type LedgerTimeframe = "10m" | "1h" | "12h" | "24h" | "1w" | "1m" | "3m" | "1y";

export interface PostLedgerClientPayload {
  id: string;
  author: string;
  handle: string;
  isAnonymous?: boolean;
  anonymousKey?: string;
  caption: string;
  createdAtMs: number;
  countryCode: string;
  countryName: string;
  mediaType?: "video" | "gif" | "png";
  mediaUrl?: string;
  upvotes: number;
  neutralVotes: number;
  downvotes: number;
  comments: number;
}

export interface PostLedgerRankEntry {
  post_id: string;
  score: number;
  likes: number;
  approval_score: number;
  created_at: string;
}

export interface HashtagLedgerEntry {
  hashtag: string;
  likes_24h: number;
  updated_at: string;
}

export interface HashtagPostRankEntry extends PostLedgerRankEntry {
  hashtags: string[];
  caption_preview: string;
}

export interface PostLedgerReplyRecord {
  reply_id: string;
  author: string;
  handle: string;
  text: string;
  created_at: string;
  likes: number;
  dislikes: number;
  reaction_by_actor?: Record<string, "up" | "down">;
  viewer_reaction?: "up" | "down" | null;
}

export interface PostLedgerCommentRecord {
  comment_id: string;
  author: string;
  handle: string;
  text: string;
  created_at: string;
  likes: number;
  dislikes: number;
  reaction_by_actor?: Record<string, "up" | "down">;
  viewer_reaction?: "up" | "down" | null;
  replies: PostLedgerReplyRecord[];
}

export interface PostLedgerRecord {
  post_id: string;
  created_at: string;
  author:
    | {
        mode: "named";
        user_id: string;
        username: string;
        usertag: string;
      }
    | {
        mode: "anonymous";
        anonymous_key: string;
      };
  content_blocks: Array<
    | {
        type: "text";
        text: string;
        encoding: "UTF-8";
      }
    | {
        type: "media";
        media_kind: "video" | "gif" | "png";
        url: string;
      }
  >;
  hashtags: string[];
  location: {
    country: string;
    country_code: string;
  };
  engagement: {
    likes: number;
    neutral: number;
    dislikes: number;
    comments_count: number;
    comments: PostLedgerCommentRecord[];
    approval_score: number;
  };
}

export interface PostPopularityLedger {
  ledger_version: string;
  generated_at: string;
  approval_formula: string;
  timeframes: LedgerTimeframe[];
  posts: Record<string, PostLedgerRecord>;
  hashtag_ledger: {
    likes_by_hour: Record<string, Record<string, number>>;
    likes_24h: HashtagLedgerEntry[];
  };
  ranking_indexes: {
    by_timeframe: Record<
      LedgerTimeframe,
      {
        likes: PostLedgerRankEntry[];
        approval: PostLedgerRankEntry[];
      }
    >;
    hashtag_posts_24h: HashtagPostRankEntry[];
  };
}
