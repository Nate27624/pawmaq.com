import { useEffect, useState } from "react";
import { API_BASE_URL } from "../config/api";

interface HashtagLedgerItem {
  hashtag: string;
  likes_24h: number;
}

interface HashtagSnapshot {
  timeframe: "24h";
  top_hashtags: HashtagLedgerItem[];
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}K`;
  }
  return value.toString();
}

export function RightRail() {
  const [snapshot, setSnapshot] = useState<HashtagSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/ledger/hashtags?limit=6`);
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as HashtagSnapshot;
        if (!cancelled) {
          setSnapshot(payload);
        }
      } catch {
        // Keep rail usable even if API is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const topHashtags = snapshot?.top_hashtags ?? [];

  return (
    <aside className="panel right-rail reveal">
      <h2>Trending</h2>
      {topHashtags.length > 0 ? (
        <ul>
          {topHashtags.slice(0, 6).map((entry) => (
            <li key={entry.hashtag}>
              <span>{entry.hashtag}</span>
              <strong>{formatCompact(entry.likes_24h)} likes</strong>
            </li>
          ))}
        </ul>
      ) : (
        <div className="right-rail__empty">
          <p className="right-rail__empty-title">No trending hashtags yet</p>
          <p className="right-rail__empty-copy">Trending will show hashtag likes once users start voting.</p>
        </div>
      )}
    </aside>
  );
}
