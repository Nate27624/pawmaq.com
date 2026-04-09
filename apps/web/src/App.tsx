import { useMemo, useState } from "react";
import { FeedCard } from "./components/FeedCard";
import { RightRail } from "./components/RightRail";
import { SideNav } from "./components/SideNav";
import { ThemeToggle } from "./components/ThemeToggle";
import { VideoComposer } from "./components/VideoComposer";
import { WorldSupportMap } from "./components/WorldSupportMap";
import { starterPosts, worldSupportData } from "./data/mockData";
import type { FeedPost, FeedTab, ThemeMode } from "./types";

const FOLLOWING_HANDLES = new Set(["@linapark", "@mayachow"]);

function getCountrySupportRatio(countryCode: string): number {
  const country = worldSupportData.find((entry) => entry.iso2 === countryCode);
  if (!country) {
    return 0;
  }
  return country.supporters / country.population;
}

function popularityScore(post: FeedPost): number {
  const engagement =
    post.likes * 1 + post.comments * 2 + post.reposts * 2.8 + post.views * 0.04;
  const ratioBoost = getCountrySupportRatio(post.countryCode) * 500;
  return engagement / 1000 + ratioBoost;
}

function totalVoteInteractions(post: FeedPost): number {
  return post.upvotes + post.neutralVotes + post.downvotes;
}

function positiveRatio(post: FeedPost): number {
  const total = totalVoteInteractions(post);
  if (total === 0) {
    return 0;
  }
  return post.upvotes / total;
}

function controversyPercent(post: FeedPost): number {
  return (1 - positiveRatio(post)) * 100;
}

function dislikeRatio(post: FeedPost): number {
  const total = totalVoteInteractions(post);
  if (total === 0) {
    return 0;
  }
  return post.downvotes / total;
}

function controversyScore(post: FeedPost): number {
  // Weight mostly by non-positive share and slightly by explicit dislikes.
  return controversyPercent(post) * 0.8 + dislikeRatio(post) * 100 * 0.2;
}

function preferredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const stored = window.localStorage.getItem("pawmaq-theme");
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(preferredTheme);
  const [activeTab, setActiveTab] = useState<FeedTab>("following");
  const [posts, setPosts] = useState<FeedPost[]>(starterPosts);

  function toggleTheme() {
    const nextTheme: ThemeMode = themeMode === "dark" ? "light" : "dark";
    setThemeMode(nextTheme);
    window.localStorage.setItem("pawmaq-theme", nextTheme);
  }

  function publishPost(payload: {
    caption: string;
    countryCode: string;
    countryName: string;
    videoUrl?: string;
  }) {
    const newPost: FeedPost = {
      id: `post-${crypto.randomUUID()}`,
      author: "You",
      handle: "@you",
      caption: payload.caption,
      countryCode: payload.countryCode,
      countryName: payload.countryName,
      createdAt: "just now",
      videoUrl: payload.videoUrl,
      likes: 0,
      comments: 0,
      reposts: 0,
      views: 0,
      upvotes: 0,
      neutralVotes: 0,
      downvotes: 0
    };
    setPosts((prev) => [newPost, ...prev]);
    setActiveTab("following");
  }

  const worldTopCountry = useMemo(() => {
    if (worldSupportData.length === 0) {
      return null;
    }
    return worldSupportData.reduce((best, current) => {
      const bestRatio = best.supporters / best.population;
      const currentRatio = current.supporters / current.population;
      return currentRatio > bestRatio ? current : best;
    }, worldSupportData[0]!);
  }, []);

  const worldRankedPosts = useMemo(() => {
    return [...posts].sort((a, b) => popularityScore(b) - popularityScore(a));
  }, [posts]);

  const controversialRankedPosts = useMemo(() => {
    return [...posts].sort((a, b) => controversyScore(b) - controversyScore(a));
  }, [posts]);

  const highestControversyPost = useMemo(() => {
    if (posts.length === 0) {
      return null;
    }
    return [...posts].sort((a, b) => controversyPercent(b) - controversyPercent(a))[0]!;
  }, [posts]);

  const highestDislikePost = useMemo(() => {
    if (posts.length === 0) {
      return null;
    }
    return [...posts].sort((a, b) => dislikeRatio(b) - dislikeRatio(a))[0]!;
  }, [posts]);

  const visiblePosts = useMemo(() => {
    if (activeTab === "following") {
      return posts.filter((post) => FOLLOWING_HANDLES.has(post.handle) || post.handle === "@you");
    }
    if (activeTab === "world") {
      return worldRankedPosts;
    }
    if (activeTab === "controversial") {
      return controversialRankedPosts;
    }
    return posts.filter((post) => FOLLOWING_HANDLES.has(post.handle) || post.handle === "@you");
  }, [activeTab, posts, worldRankedPosts, controversialRankedPosts]);

  return (
    <div className={`app-shell mode-${themeMode}`}>
      <header className="top-bar reveal">
        <div>
          <p className="top-bar__title">Pawmaq Feed</p>
          <p className="top-bar__subtitle">Cross between pulse-driven X streams and video-native channels.</p>
        </div>
        <ThemeToggle mode={themeMode} onToggle={toggleTheme} />
      </header>

      <div className="layout-grid">
        <SideNav activeTab={activeTab} onTabChange={setActiveTab} />

        <main className="main-column">
          {activeTab === "world" && worldTopCountry ? (
            <section className="panel world-highlight reveal">
              <h2>Top Proportional Country Support</h2>
              <p>
                <strong>{worldTopCountry.country}</strong> leads with{" "}
                {((worldTopCountry.supporters / worldTopCountry.population) * 100).toFixed(2)}% of population
                supporting platform content.
              </p>
            </section>
          ) : null}
          {activeTab === "controversial" && highestControversyPost && highestDislikePost ? (
            <section className="panel world-highlight reveal">
              <h2>Controversial Heat</h2>
              <p>
                Highest non-positive share: <strong>{highestControversyPost.author}</strong> at{" "}
                {controversyPercent(highestControversyPost).toFixed(1)}%.
              </p>
              <p>
                Highest dislike share: <strong>{highestDislikePost.author}</strong> at{" "}
                {(dislikeRatio(highestDislikePost) * 100).toFixed(1)}%.
              </p>
            </section>
          ) : null}

          <VideoComposer countries={worldSupportData} onPublish={publishPost} />

          {activeTab === "world" ? <WorldSupportMap countries={worldSupportData} /> : null}

          <section className="feed-list">
            {visiblePosts.map((post) => (
              <FeedCard
                key={post.id}
                post={post}
                rankScore={
                  activeTab === "world"
                    ? popularityScore(post)
                    : activeTab === "controversial"
                      ? controversyScore(post)
                      : undefined
                }
                rankLabel={activeTab === "world" ? "Popularity" : "Controversy"}
              />
            ))}
          </section>
        </main>

        <RightRail />
      </div>
    </div>
  );
}
