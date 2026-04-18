import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "./config/api";

interface LedgerExportPayload {
  profile_ledger: Record<string, unknown>;
  post_popularity_ledger: Record<string, unknown>;
  hashtag_ledger: Record<string, unknown>;
  commitments?: Record<string, unknown>;
  pagination?: {
    users?: {
      offset?: number;
      limit?: number;
      total?: number;
      next_offset?: number | null;
    };
    posts?: {
      offset?: number;
      limit?: number;
      total?: number;
      next_offset?: number | null;
    };
  };
}

interface FlatLedgerRow {
  ledger: "profile_ledger" | "post_popularity_ledger" | "hashtag_ledger";
  path: string;
  value: string;
}

interface TargetPostRankingRow {
  timeframe: string;
  likesRank: number | null;
  approvalRank: number | null;
  likes: number | null;
  approval: number | null;
}

const TIMEFRAME_ORDER = ["10m", "1h", "12h", "24h", "1w", "1m", "3m", "1y"] as const;
const LEDGER_EXPORT_PAGE_SIZE = 100;
const LEDGER_EXPORT_RANK_LIMIT = 250;
const LEDGER_EXPORT_HASHTAG_LIMIT = 250;

function toValuePreview(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function flattenLedger(value: unknown, prefix: string, rows: FlatLedgerRow[], ledger: FlatLedgerRow["ledger"]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenLedger(item, `${prefix}[${index}]`, rows, ledger);
    });
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      flattenLedger(nested, nextPath, rows, ledger);
    }
    return;
  }

  rows.push({
    ledger,
    path: prefix || "(root)",
    value: toValuePreview(value)
  });
}

function readTargetPostIdFromUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const value = new URLSearchParams(window.location.search).get("postId") ?? "";
  return value.trim();
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function mergeLedgerPayload(base: LedgerExportPayload, next: LedgerExportPayload): LedgerExportPayload {
  const baseProfileLedger = asObject(base.profile_ledger);
  const nextProfileLedger = asObject(next.profile_ledger);
  const baseProfileUsers = asObject(baseProfileLedger.users);
  const nextProfileUsers = asObject(nextProfileLedger.users);

  const basePostLedger = asObject(base.post_popularity_ledger);
  const nextPostLedger = asObject(next.post_popularity_ledger);
  const basePosts = asObject(basePostLedger.posts);
  const nextPosts = asObject(nextPostLedger.posts);

  return {
    ...base,
    profile_ledger: {
      ...baseProfileLedger,
      users: {
        ...baseProfileUsers,
        ...nextProfileUsers
      }
    },
    post_popularity_ledger: {
      ...basePostLedger,
      posts: {
        ...basePosts,
        ...nextPosts
      }
    },
    pagination: next.pagination
  };
}

async function fetchLedgerExportPage(
  usersOffset: number,
  postsOffset: number
): Promise<LedgerExportPayload> {
  const params = new URLSearchParams({
    usersOffset: String(usersOffset),
    usersLimit: String(LEDGER_EXPORT_PAGE_SIZE),
    postsOffset: String(postsOffset),
    postsLimit: String(LEDGER_EXPORT_PAGE_SIZE),
    rankLimit: String(LEDGER_EXPORT_RANK_LIMIT),
    hashtagLimit: String(LEDGER_EXPORT_HASHTAG_LIMIT)
  });
  const response = await fetch(`${API_BASE_URL}/v1/ledger/export?${params.toString()}`);
  const nextPayload = (await response.json()) as LedgerExportPayload;
  if (!response.ok) {
    throw new Error("Unable to load ledger export.");
  }
  return nextPayload;
}

function extractTargetPostRankings(payload: LedgerExportPayload | null, postId: string): TargetPostRankingRow[] {
  if (!payload || !postId) {
    return [];
  }

  const postLedger = payload.post_popularity_ledger as {
    ranking_indexes?: {
      by_timeframe?: Record<
        string,
        {
          likes?: Array<{ post_id?: string; likes?: number }>;
          approval?: Array<{ post_id?: string; approval_score?: number }>;
        }
      >;
    };
  };
  const byTimeframe = postLedger.ranking_indexes?.by_timeframe;
  if (!byTimeframe || typeof byTimeframe !== "object") {
    return [];
  }

  const rows: TargetPostRankingRow[] = [];
  for (const [timeframe, ranking] of Object.entries(byTimeframe)) {
    const likesList = Array.isArray(ranking?.likes) ? ranking.likes : [];
    const approvalList = Array.isArray(ranking?.approval) ? ranking.approval : [];

    const likesIndex = likesList.findIndex((entry) => entry?.post_id === postId);
    const approvalIndex = approvalList.findIndex((entry) => entry?.post_id === postId);

    if (likesIndex === -1 && approvalIndex === -1) {
      continue;
    }

    rows.push({
      timeframe,
      likesRank: likesIndex >= 0 ? likesIndex + 1 : null,
      approvalRank: approvalIndex >= 0 ? approvalIndex + 1 : null,
      likes: likesIndex >= 0 ? (likesList[likesIndex]?.likes ?? null) : null,
      approval: approvalIndex >= 0 ? (approvalList[approvalIndex]?.approval_score ?? null) : null
    });
  }

  return rows.sort((left, right) => {
    const leftOrder = TIMEFRAME_ORDER.indexOf(left.timeframe as (typeof TIMEFRAME_ORDER)[number]);
    const rightOrder = TIMEFRAME_ORDER.indexOf(right.timeframe as (typeof TIMEFRAME_ORDER)[number]);
    const safeLeft = leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder;
    const safeRight = rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder;
    return safeLeft - safeRight;
  });
}

export function LedgerPage() {
  const [targetPostId] = useState<string>(() => readTargetPostIdFromUrl());
  const [query, setQuery] = useState<string>(() => readTargetPostIdFromUrl());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<LedgerExportPayload | null>(null);

  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      try {
        let usersOffset = 0;
        let postsOffset = 0;
        let mergedPayload: LedgerExportPayload | null = null;
        let requestCount = 0;
        while (requestCount < 50) {
          const pagePayload = await fetchLedgerExportPage(usersOffset, postsOffset);
          mergedPayload = mergedPayload ? mergeLedgerPayload(mergedPayload, pagePayload) : pagePayload;
          requestCount += 1;

          const nextUsersOffset = pagePayload.pagination?.users?.next_offset ?? null;
          const nextPostsOffset = pagePayload.pagination?.posts?.next_offset ?? null;
          if (nextUsersOffset === null && nextPostsOffset === null) {
            break;
          }
          usersOffset = nextUsersOffset ?? usersOffset;
          postsOffset = nextPostsOffset ?? postsOffset;
        }
        if (!mergedPayload) {
          throw new Error("Unable to load ledger export.");
        }
        if (!isCancelled) {
          setPayload(mergedPayload);
          setError(null);
        }
      } catch (nextError) {
        if (!isCancelled) {
          const message = nextError instanceof Error ? nextError.message : "Unable to load ledgers.";
          setError(message);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, []);

  const flatRows = useMemo(() => {
    if (!payload) {
      return [] as FlatLedgerRow[];
    }
    const rows: FlatLedgerRow[] = [];
    flattenLedger(payload.profile_ledger, "", rows, "profile_ledger");
    flattenLedger(payload.post_popularity_ledger, "", rows, "post_popularity_ledger");
    flattenLedger(payload.hashtag_ledger, "", rows, "hashtag_ledger");
    return rows;
  }, [payload]);

  const filteredRows = useMemo(() => {
    const token = query.trim().toLowerCase();
    if (!token) {
      return flatRows;
    }
    return flatRows.filter((row) => {
      return (
        row.path.toLowerCase().includes(token) ||
        row.value.toLowerCase().includes(token) ||
        row.ledger.toLowerCase().includes(token)
      );
    });
  }, [flatRows, query]);

  const targetPostRankings = useMemo(
    () => extractTargetPostRankings(payload, targetPostId),
    [payload, targetPostId]
  );

  useEffect(() => {
    if (!targetPostId || loading || error) {
      return;
    }
    const section = document.getElementById("target-post-rankings");
    section?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [targetPostId, loading, error]);

  function goToMainPage() {
    if (typeof window === "undefined") {
      return;
    }
    window.location.assign("/");
  }

  return (
    <div className="ledger-shell mode-dark">
      <div className="ledger-page">
        <header className="ledger-page__header">
          <button type="button" className="ledger-page__back" onClick={goToMainPage}>
            Back to feed
          </button>
          <h1>pawmaq.com ledger</h1>
          <p>
            This page is intentionally not linked from the main UI. It is visible only when you navigate directly to
            <code>/ledger</code>.
          </p>
          <p>Private profile fields are redacted from this export and represented as SHA-256 commitments.</p>
        </header>

        <section className="ledger-page__tools">
          <label>
            Search all ledgers
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search path, value, handle, post id, country, etc."
            />
          </label>
          {targetPostId ? <p>Focused post: <code>{targetPostId}</code></p> : null}
          <p>
            {loading
              ? "Loading ledgers..."
              : error
                ? error
                : `Showing ${filteredRows.length.toLocaleString()} of ${flatRows.length.toLocaleString()} rows`}
          </p>
        </section>

        {!loading && !error ? (
          <>
            {targetPostId ? (
              <section id="target-post-rankings" className="ledger-page__results">
                <h2>Target post rankings</h2>
                {targetPostRankings.length > 0 ? (
                  <div className="ledger-page__table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Timeframe</th>
                          <th>Likes Rank</th>
                          <th>Approval Rank</th>
                          <th>Likes</th>
                          <th>Approval</th>
                        </tr>
                      </thead>
                      <tbody>
                        {targetPostRankings.map((row) => (
                          <tr key={row.timeframe}>
                            <td>{row.timeframe}</td>
                            <td>{row.likesRank ?? "-"}</td>
                            <td>{row.approvalRank ?? "-"}</td>
                            <td>{row.likes ?? "-"}</td>
                            <td>{typeof row.approval === "number" ? `${row.approval.toFixed(3)}%` : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p>No ranking entries found for this post id yet.</p>
                )}
              </section>
            ) : null}
            <section className="ledger-page__results">
              <h2>Search results</h2>
              <div className="ledger-page__table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ledger</th>
                      <th>Path</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.slice(0, 1500).map((row, index) => (
                      <tr
                        key={`${row.ledger}:${row.path}:${index}`}
                        className={
                          targetPostId &&
                          (row.path.includes(targetPostId) || row.value.includes(targetPostId))
                            ? "ledger-page__row--focus"
                            : undefined
                        }
                      >
                        <td>{row.ledger}</td>
                        <td>{row.path}</td>
                        <td>{row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="ledger-page__raw">
              <h2>Full profile ledger</h2>
              <pre>{JSON.stringify(payload?.profile_ledger ?? {}, null, 2)}</pre>
            </section>

            <section className="ledger-page__raw">
              <h2>Full post popularity ledger</h2>
              <pre>{JSON.stringify(payload?.post_popularity_ledger ?? {}, null, 2)}</pre>
            </section>

            <section className="ledger-page__raw">
              <h2>Full hashtag ledger</h2>
              <pre>{JSON.stringify(payload?.hashtag_ledger ?? {}, null, 2)}</pre>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
