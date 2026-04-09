# Platform Blueprint

## 1. Product Scope

### Core interaction model

- `Communities` for topic-centric discussion (public, private, restricted)
- `Posts` as either:
  - `Link/Text` posts (Reddit style)
  - `Short` posts (tweet style)
- `Replies` with nesting up to configurable depth
- `Votes/Reactions`:
  - Upvote/downvote for communities
  - Like/repost for feed posts
- `Follow graph` for users and communities

### Non-goals (MVP)

- No live audio/video rooms
- No long-form newsletters
- No algorithm marketplace or ads platform

## 2. Technical Architecture

### High-level services

- `API Gateway` (REST + GraphQL, auth, rate limits)
- `Identity Service` (users, sessions, OAuth)
- `Social Graph Service` (follows, blocks, mutes)
- `Content Service` (posts, replies, edits, media refs)
- `Feed Service` (home, local, trending, community feeds)
- `Moderation Service` (reports, actions, audit trail)
- `AI Moderation Service` (open-source model inference, policy scoring)
- `Search Service` (full-text + ranking)
- `Notification Service` (in-app, email, push)
- `Media Service` (uploads, image/video transform, CDN)

### Suggested stack (pragmatic defaults)

- Backend: `TypeScript + NestJS` (or `Go + Fiber` if optimizing for low memory)
- Database: `PostgreSQL` (primary source of truth)
- Cache/queues: `Redis` (cache, jobs, rate-limit counters)
- Search: `OpenSearch` (or PostgreSQL FTS for early MVP)
- Object storage: `S3-compatible` (MinIO in local/self-hosted)
- Event bus: `NATS` or `Kafka` (start with NATS for simpler ops)
- AI inference: self-hosted `vLLM`/`Ollama`/`TGI` with open-source safety models
- Frontend: `Next.js` web + `React Native` optional mobile
- Infra: Docker + Kubernetes (single-node Docker Compose for local)

## 3. Data Model (MVP)

### Key tables

- `users` (id, handle, email_hash, password_hash, status, created_at)
- `profiles` (user_id, display_name, bio, avatar_url, locale)
- `communities` (id, slug, title, visibility, rules_json, created_by)
- `community_memberships` (community_id, user_id, role)
- `posts` (id, author_id, community_id nullable, type, body, link_url, visibility)
- `post_stats` (post_id, score, reply_count, repost_count, like_count)
- `replies` (id, post_id, parent_reply_id nullable, author_id, body)
- `follows` (follower_id, target_type, target_id)
- `votes` (user_id, post_id, value)
- `reactions` (user_id, post_id, type)
- `reports` (id, reporter_id, target_type, target_id, reason_code, state)
- `moderation_actions` (id, actor_id, action_type, target_type, target_id, note)
- `blocks` (blocker_id, blocked_id)
- `mutes` (muter_id, muted_id, expires_at nullable)

### Storage notes

- Use `UUIDv7` for primary IDs
- Soft-delete content with tombstones for federation/mod logs
- Partition high-volume tables (`posts`, `replies`, `notifications`) by month

## 4. Feed and Ranking

### Feed types

- `Home`: followed users + followed communities
- `Community`: recency + score in a community
- `Global/Explore`: personalized but diversity-constrained
- `Chronological`: strict time order fallback

### Ranking formula (initial)

Use a transparent weighted score:

`rank = quality + recency_decay + relationship + diversity_boost - policy_penalties`

Where:

- `quality`: votes/likes/replies adjusted by author trust
- `recency_decay`: half-life decay to prevent stale lock-in
- `relationship`: follower/community affinity
- `diversity_boost`: avoid feed monoculture
- `policy_penalties`: spam/toxicity/duplicate detections

## 5. Moderation & Safety

### Multi-layer moderation

- User tools: block, mute, keyword filters, NSFW controls
- Community tools: role-based moderation (owner/admin/mod)
- Platform tools: trust & safety queue, abuse automation
- AI tools: open-source model classifiers for toxicity, spam, harassment, and CSAM handoff signals

### Open-source AI requirement

- AI moderation must run on self-hosted open-source models only
- No dependency on closed hosted moderation APIs for core enforcement decisions
- Model cards, eval sets, thresholds, and version history are documented publicly
- Every AI decision is explainable via policy labels and confidence metadata

### Enforcement model

- Every action creates immutable `moderation_actions` audit entries
- Progressive penalties: warning -> temporary limits -> suspension
- Appeals pipeline with SLA targets and decision transparency

### Anti-abuse baseline

- Rate limits by IP + account age + reputation
- Risk scoring on signup/login/content actions
- Link reputation checks + duplicate-content detection
- Optional bot challenge on suspicious actions
- AI-assisted triage with human-review routing for high-risk actions

## 6. API Surface (MVP)

### Representative endpoints

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/feed/home`
- `GET /v1/communities/:slug`
- `POST /v1/posts`
- `POST /v1/posts/:id/vote`
- `POST /v1/posts/:id/reply`
- `POST /v1/reports`
- `POST /v1/mod/actions`
- `GET /v1/search?q=...`

### API quality requirements

- Cursor pagination only (no offset on feeds)
- Idempotency keys on create/mutation endpoints
- Consistent error shape and machine-readable codes

## 7. Privacy, Security, and Compliance

- Data minimization by default; no invasive telemetry
- Signed media URLs and private bucket policies
- Encryption in transit and at rest
- Session rotation and device-aware revocation
- Configurable data retention for logs/content metadata
- Keep moderation inference in first-party infrastructure to avoid third-party content sharing

## 8. Open Source & Governance

- License: `AGPLv3` for server components; `MIT/Apache-2.0` for SDKs
- Public roadmap and issue triage policies
- Contributor Covenant and clear code-of-conduct enforcement
- Reproducible local dev environment with one-command bootstrap

## 9. MVP Delivery Plan (12 Weeks)

### Phase 1 (Weeks 1-4): foundation

- Auth, profiles, communities, post creation
- Basic feed (chronological), votes/replies
- Basic moderation reports

### Phase 2 (Weeks 5-8): reliability

- Ranking v1, notifications, search v1
- Anti-abuse controls + rate-limits
- Audit logs and admin/mod dashboards

### Phase 3 (Weeks 9-12): hardening

- Performance tuning and cache strategy
- Security review and incident runbooks
- Beta launch checklist + observability SLOs

## 10. Immediate Next Build Targets

- Define final domain model and migration strategy
- Implement auth + user/profile service
- Implement post/reply pipeline with idempotent writes
- Stand up moderation report ingestion, AI scoring pipeline, and action log
- Deliver home/community feeds with cursor pagination
