import { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "./config/api";

interface TestLabUser {
  handle: string;
  displayName: string;
  countryCode: string;
  countryName: string;
  createdAt: string;
}

interface TestLabPostSummary {
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
}

interface TestLabCommentSummary {
  postId: string;
  commentId: string;
  author: string;
  handle: string;
  text: string;
}

interface TestLabScenario {
  id: "post-comment-reply" | "ranking-likes-24h" | "hashtag-trending-24h";
  label: string;
  description: string;
}

interface TestLabScenarioResult {
  scenarioId: string;
  ok: boolean;
  assertions: Array<{
    name: string;
    pass: boolean;
    details: string;
  }>;
}

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  if (!response.ok) {
    throw new ApiError(response.status, payload?.message ?? `Request failed with status ${response.status}.`);
  }
  return payload as T;
}

function prettyDate(iso: string): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) {
    return iso;
  }
  return value.toLocaleString();
}

export function TestLabPage() {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<TestLabUser[]>([]);
  const [posts, setPosts] = useState<TestLabPostSummary[]>([]);
  const [comments, setComments] = useState<TestLabCommentSummary[]>([]);
  const [scenarios, setScenarios] = useState<TestLabScenario[]>([]);
  const [scenarioResults, setScenarioResults] = useState<TestLabScenarioResult[]>([]);

  const [userHandle, setUserHandle] = useState("@test_user");
  const [userDisplayName, setUserDisplayName] = useState("Test User");
  const [userCountryCode, setUserCountryCode] = useState("US");
  const [userCountryName, setUserCountryName] = useState("United States");

  const [postHandle, setPostHandle] = useState("@test_user");
  const [postCaption, setPostCaption] = useState("test-lab custom post #qa");
  const [postLikes, setPostLikes] = useState(0);
  const [postNeutral, setPostNeutral] = useState(0);
  const [postDislikes, setPostDislikes] = useState(0);
  const [postCreatedAt, setPostCreatedAt] = useState("");

  const [commentHandle, setCommentHandle] = useState("@test_user");
  const [commentPostId, setCommentPostId] = useState("");
  const [commentText, setCommentText] = useState("test-lab comment");

  const [replyHandle, setReplyHandle] = useState("@test_user");
  const [replyPostId, setReplyPostId] = useState("");
  const [replyCommentId, setReplyCommentId] = useState("");
  const [replyText, setReplyText] = useState("test-lab reply");

  const commentsForReplyPost = useMemo(
    () => comments.filter((comment) => comment.postId === replyPostId),
    [comments, replyPostId]
  );

  async function loadAll(): Promise<void> {
    const [bootstrap, scenarioPayload] = await Promise.all([
      fetchApi<{
        users: TestLabUser[];
        posts: TestLabPostSummary[];
        comments: TestLabCommentSummary[];
      }>("/v1/test-lab/bootstrap"),
      fetchApi<{ scenarios: TestLabScenario[] }>("/v1/test-lab/scenarios")
    ]);
    setUsers(bootstrap.users);
    setPosts(bootstrap.posts);
    setComments(bootstrap.comments);
    setScenarios(scenarioPayload.scenarios);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        await loadAll();
        if (cancelled) {
          return;
        }
        setError(null);
      } catch (nextError) {
        if (!cancelled) {
          const message = nextError instanceof Error ? nextError.message : "Unable to load test lab.";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function upsertUser(): Promise<void> {
    setStatus("Saving test user...");
    setError(null);
    try {
      await fetchApi<{ ok: boolean }>("/v1/test-lab/users/upsert", {
        method: "POST",
        body: JSON.stringify({
          handle: userHandle,
          displayName: userDisplayName,
          countryCode: userCountryCode,
          countryName: userCountryName
        })
      });
      await loadAll();
      setPostHandle(userHandle);
      setCommentHandle(userHandle);
      setReplyHandle(userHandle);
      setStatus("Test user saved.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to save user.";
      setError(message);
      setStatus(null);
    }
  }

  async function createPost(): Promise<void> {
    setStatus("Creating test post...");
    setError(null);
    try {
      const createdAtMs = postCreatedAt ? new Date(postCreatedAt).getTime() : undefined;
      await fetchApi<{ ok: boolean; postId: string }>("/v1/test-lab/posts", {
        method: "POST",
        body: JSON.stringify({
          handle: postHandle,
          caption: postCaption,
          upvotes: postLikes,
          neutralVotes: postNeutral,
          downvotes: postDislikes,
          createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : undefined
        })
      });
      await loadAll();
      setStatus("Test post created.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to create post.";
      setError(message);
      setStatus(null);
    }
  }

  async function createComment(): Promise<void> {
    if (!commentPostId) {
      setError("Select a post for comment creation.");
      return;
    }
    setStatus("Adding comment...");
    setError(null);
    try {
      await fetchApi<{ ok: boolean }>("/v1/test-lab/comments", {
        method: "POST",
        body: JSON.stringify({
          handle: commentHandle,
          postId: commentPostId,
          text: commentText
        })
      });
      await loadAll();
      setStatus("Comment added.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to add comment.";
      setError(message);
      setStatus(null);
    }
  }

  async function createReply(): Promise<void> {
    if (!replyPostId || !replyCommentId) {
      setError("Select post and comment for reply creation.");
      return;
    }
    setStatus("Adding reply...");
    setError(null);
    try {
      await fetchApi<{ ok: boolean }>("/v1/test-lab/replies", {
        method: "POST",
        body: JSON.stringify({
          handle: replyHandle,
          postId: replyPostId,
          commentId: replyCommentId,
          text: replyText
        })
      });
      await loadAll();
      setStatus("Reply added.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to add reply.";
      setError(message);
      setStatus(null);
    }
  }

  async function runScenario(scenarioId: TestLabScenario["id"]): Promise<void> {
    setStatus(`Running scenario ${scenarioId}...`);
    setError(null);
    try {
      const result = await fetchApi<TestLabScenarioResult>("/v1/test-lab/scenarios/run", {
        method: "POST",
        body: JSON.stringify({ scenarioId })
      });
      setScenarioResults((current) => [result, ...current.filter((row) => row.scenarioId !== result.scenarioId)]);
      await loadAll();
      setStatus(result.ok ? `${scenarioId} passed.` : `${scenarioId} failed.`);
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "Unable to run scenario.";
      setError(message);
      setStatus(null);
    }
  }

  async function runAllScenarios(): Promise<void> {
    for (const scenario of scenarios) {
      await runScenario(scenario.id);
    }
  }

  function goToFeed() {
    window.location.assign("/");
  }

  return (
    <div className="ledger-shell mode-dark">
      <div className="test-lab-page">
        <header className="test-lab-page__header">
          <div>
            <h1>pawmaq test lab</h1>
            <p>Interactive QA dashboard for creating custom users, posts, comments, replies, and running scenarios.</p>
          </div>
          <div className="test-lab-page__header-actions">
            <button type="button" onClick={goToFeed}>Back to feed</button>
            <button type="button" onClick={() => void loadAll()}>Refresh</button>
          </div>
        </header>

        {loading ? <p className="test-lab-page__status">Loading test lab...</p> : null}
        {status ? <p className="test-lab-page__status">{status}</p> : null}
        {error ? <p className="test-lab-page__error">{error}</p> : null}

        <div className="test-lab-grid">
          <section className="test-lab-card">
            <h2>Test Users</h2>
            <div className="test-lab-form-grid">
              <label>
                Handle
                <input value={userHandle} onChange={(event) => setUserHandle(event.target.value)} />
              </label>
              <label>
                Name
                <input value={userDisplayName} onChange={(event) => setUserDisplayName(event.target.value)} />
              </label>
              <label>
                Country Code
                <input value={userCountryCode} onChange={(event) => setUserCountryCode(event.target.value.toUpperCase())} />
              </label>
              <label>
                Country Name
                <input value={userCountryName} onChange={(event) => setUserCountryName(event.target.value)} />
              </label>
            </div>
            <button type="button" onClick={() => void upsertUser()}>Save Test User</button>
            <div className="test-lab-list">
              {users.map((user) => (
                <button
                  key={user.handle}
                  type="button"
                  className="test-lab-list__item"
                  onClick={() => {
                    setUserHandle(user.handle);
                    setUserDisplayName(user.displayName);
                    setUserCountryCode(user.countryCode);
                    setUserCountryName(user.countryName);
                    setPostHandle(user.handle);
                    setCommentHandle(user.handle);
                    setReplyHandle(user.handle);
                  }}
                >
                  <strong>{user.handle}</strong>
                  <span>{user.displayName}</span>
                  <small>{user.countryCode} · {user.countryName}</small>
                </button>
              ))}
              {users.length === 0 ? <p>No test users yet.</p> : null}
            </div>
          </section>

          <section className="test-lab-card">
            <h2>Create Post</h2>
            <div className="test-lab-form-grid">
              <label>
                User Handle
                <input value={postHandle} onChange={(event) => setPostHandle(event.target.value)} />
              </label>
              <label>
                Created At (optional)
                <input
                  type="datetime-local"
                  value={postCreatedAt}
                  onChange={(event) => setPostCreatedAt(event.target.value)}
                />
              </label>
              <label>
                Likes
                <input
                  type="number"
                  value={postLikes}
                  min={0}
                  onChange={(event) => setPostLikes(Math.max(0, Number.parseInt(event.target.value || "0", 10)))}
                />
              </label>
              <label>
                Neutral
                <input
                  type="number"
                  value={postNeutral}
                  min={0}
                  onChange={(event) => setPostNeutral(Math.max(0, Number.parseInt(event.target.value || "0", 10)))}
                />
              </label>
              <label>
                Dislikes
                <input
                  type="number"
                  value={postDislikes}
                  min={0}
                  onChange={(event) => setPostDislikes(Math.max(0, Number.parseInt(event.target.value || "0", 10)))}
                />
              </label>
            </div>
            <label>
              Caption
              <textarea value={postCaption} onChange={(event) => setPostCaption(event.target.value)} rows={4} />
            </label>
            <button type="button" onClick={() => void createPost()}>Create Post</button>
          </section>

          <section className="test-lab-card">
            <h2>Create Comment</h2>
            <div className="test-lab-form-grid">
              <label>
                User Handle
                <input value={commentHandle} onChange={(event) => setCommentHandle(event.target.value)} />
              </label>
              <label>
                Post
                <select value={commentPostId} onChange={(event) => setCommentPostId(event.target.value)}>
                  <option value="">Select post</option>
                  {posts.map((post) => (
                    <option key={post.postId} value={post.postId}>{post.postId.slice(0, 18)} · {post.captionPreview}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Comment Text
              <textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} rows={3} />
            </label>
            <button type="button" onClick={() => void createComment()}>Add Comment</button>
          </section>

          <section className="test-lab-card">
            <h2>Create Reply</h2>
            <div className="test-lab-form-grid">
              <label>
                User Handle
                <input value={replyHandle} onChange={(event) => setReplyHandle(event.target.value)} />
              </label>
              <label>
                Post
                <select value={replyPostId} onChange={(event) => setReplyPostId(event.target.value)}>
                  <option value="">Select post</option>
                  {posts.map((post) => (
                    <option key={post.postId} value={post.postId}>{post.postId.slice(0, 18)} · {post.captionPreview}</option>
                  ))}
                </select>
              </label>
              <label>
                Comment
                <select value={replyCommentId} onChange={(event) => setReplyCommentId(event.target.value)}>
                  <option value="">Select comment</option>
                  {commentsForReplyPost.map((comment) => (
                    <option key={comment.commentId} value={comment.commentId}>
                      {comment.commentId.slice(0, 18)} · {comment.text.slice(0, 48)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Reply Text
              <textarea value={replyText} onChange={(event) => setReplyText(event.target.value)} rows={3} />
            </label>
            <button type="button" onClick={() => void createReply()}>Add Reply</button>
          </section>

          <section className="test-lab-card">
            <h2>Scenario Runner</h2>
            <div className="test-lab-scenarios">
              <button type="button" onClick={() => void runAllScenarios()}>Run All Scenarios</button>
              {scenarios.map((scenario) => (
                <div key={scenario.id} className="test-lab-scenarios__row">
                  <div>
                    <strong>{scenario.label}</strong>
                    <p>{scenario.description}</p>
                  </div>
                  <button type="button" onClick={() => void runScenario(scenario.id)}>Run</button>
                </div>
              ))}
            </div>
            <div className="test-lab-results">
              {scenarioResults.map((result) => (
                <div key={result.scenarioId} className={result.ok ? "test-lab-result pass" : "test-lab-result fail"}>
                  <h3>{result.scenarioId} · {result.ok ? "PASS" : "FAIL"}</h3>
                  {result.assertions.map((assertion) => (
                    <p key={assertion.name}>
                      <strong>{assertion.name}</strong>: {assertion.pass ? "pass" : "fail"} ({assertion.details})
                    </p>
                  ))}
                </div>
              ))}
              {scenarioResults.length === 0 ? <p>No scenarios run yet.</p> : null}
            </div>
          </section>

          <section className="test-lab-card">
            <h2>Recent Posts</h2>
            <div className="test-lab-list">
              {posts.map((post) => (
                <div key={post.postId} className="test-lab-list__item static">
                  <strong>{post.postId}</strong>
                  <span>{post.author} · {post.handle}</span>
                  <small>{post.captionPreview}</small>
                  <small>
                    👍 {post.likes} · 😐 {post.neutral} · 👎 {post.dislikes} · 💬 {post.commentsCount}
                  </small>
                  <small>{prettyDate(post.createdAt)}</small>
                </div>
              ))}
              {posts.length === 0 ? <p>No posts available.</p> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
