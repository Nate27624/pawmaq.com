export type ThemeMode = "light" | "dark";

export type FeedTab = "following" | "world";

export interface FeedPost {
  id: string;
  author: string;
  handle: string;
  isAnonymous?: boolean;
  anonymousKey?: string;
  caption: string;
  originalLanguage: string;
  translatedCaptions?: Record<string, string>;
  countryCode: string;
  countryName: string;
  createdAt: string;
  createdAtHoursAgo: number;
  createdAtMs: number;
  videoUrl?: string;
  mediaType?: "video" | "gif" | "png";
  posterUrl?: string;
  likes: number;
  comments: number;
  reposts: number;
  views: number;
  upvotes: number;
  neutralVotes: number;
  downvotes: number;
}

export interface CountrySupport {
  iso2: string;
  country: string;
  population: number;
  supporters: number;
}
