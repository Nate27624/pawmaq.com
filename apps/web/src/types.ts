export type ThemeMode = "light" | "dark";

export type FeedTab = "following" | "world" | "controversial";

export interface FeedPost {
  id: string;
  author: string;
  handle: string;
  caption: string;
  countryCode: string;
  countryName: string;
  createdAt: string;
  videoUrl?: string;
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
