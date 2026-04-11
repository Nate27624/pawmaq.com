# @pawmaq/api

Minimal API scaffold for the pawmaq platform.

## Run

```bash
corepack pnpm install
corepack pnpm dev
```

## Endpoints

- `GET /healthz`
- `GET /v1/moderation/health`
- `POST /v1/moderation/analyze`
- `POST /v1/auth/google/session`
- `GET /v1/auth/session`
- `POST /v1/auth/sign-out`
- `PUT /v1/profiles/self`
- `POST /v1/profiles/follow`
- `POST /v1/profiles/post-interactions`
- `POST /v1/profiles/posts`
- `GET /v1/profiles/by-handle/:handle`
- `POST /v1/media/upload`
- `GET /v1/media/files/:mediaId`
- `POST /v1/ledger/posts`
- `GET /v1/ledger/export`
- `GET /v1/test-lab/bootstrap` (non-production, when `TEST_LAB_ENABLED=true`)
- `POST /v1/test-lab/users/upsert`
- `POST /v1/test-lab/posts`
- `POST /v1/test-lab/comments`
- `POST /v1/test-lab/replies`
- `GET /v1/test-lab/scenarios`
- `POST /v1/test-lab/scenarios/run`

The moderation service is wired for self-hosted open-source AI runtimes (`ollama`, `vllm`, `tgi`).

Profile ledger data is persisted at `PROFILE_LEDGER_PATH` (default: `.context/profile-ledger.json`).
Post popularity ledger data is persisted at `POST_LEDGER_PATH` (default: `.context/post-popularity-ledger.json`).
Uploaded media metadata is persisted at `MEDIA_INDEX_PATH` (default: `.context/media-index.json`).
Uploaded media files are persisted under `MEDIA_STORAGE_DIR` (default: `.context/media-uploads`).

## Pre-Ledger Queue

`POST /v1/ledger/posts` and `POST /v1/media/upload` are now gated by a pre-ledger queue to validate inputs and apply
IP-based rate limits before persistence.

- `PRE_LEDGER_QUEUE_MAX_PENDING` (default `80`)
- `PRE_LEDGER_POSTS_PER_MINUTE_PER_IP` (default `90`)
- `PRE_LEDGER_MEDIA_UPLOADS_PER_10M_PER_IP` (default `20`)

When throttled, the API returns `429 rate_limited` (with `retry_after_ms`). When overloaded, it returns
`503 queue_busy`.

## Auth Environment

- `GOOGLE_OAUTH_CLIENT_IDS` (comma-separated OAuth web client IDs allowed by the API)
- `AUTH_SESSION_TTL_HOURS` (defaults to `168`)
- `AUTH_SESSION_STORE` (`auto`, `memory`, or `redis`; defaults to `auto`)
- `AUTH_SESSION_REDIS_PREFIX` (defaults to `pawmaq:session:`)
- `REDIS_URL` (required when `AUTH_SESSION_STORE=redis`)
- `TEST_LAB_ENABLED` (`true`/`false`, defaults `false`; ignored in production)

Security behavior:
- In `production`, API startup fails if `GOOGLE_OAUTH_CLIENT_IDS` is empty.
- In `production`, API startup fails unless `AUTH_SESSION_STORE=redis`.
- `POST /v1/auth/google/session` is rate-limited per IP.
- Google token audience is checked against `GOOGLE_OAUTH_CLIENT_IDS`.
- Session records are persisted in Redis when available, so sessions survive API restarts.

## RSS Bot Ingestion

The API can ingest public RSS feeds (including Mastodon profile feeds) and mirror them into the post ledger using
named bot accounts persisted in the profile ledger.

Environment:

- `RSS_BOTS_ENABLED` (`true`/`false`, default `false`)
- `RSS_BOTS_INTERVAL_MINUTES` (default `15`)
- `RSS_BOTS_MAX_ITEMS_PER_FEED_PER_RUN` (default `0`; `0` means import all available feed items)
- `RSS_BOTS_USER_AGENT` (default `pawmaq-rss-bot/1.0 (+https://pawmaq.com)`)
- `RSS_BOTS_FEEDS`:
  - JSON format:
    - `[{"feedUrl":"https://mastodon.social/@TechCrunch.rss","handle":"@techcrunch_rss","name":"TechCrunch RSS","countryCode":"US","countryName":"United States"}]`
  - or line/semicolon format:
    - `feedUrl|handle|name|countryCode|countryName|bio`

When enabled, RSS sync runs once at API startup, then on the configured interval.

## Test Lab Suite

Run the scenario suite without starting an external server:

```bash
corepack pnpm --filter @pawmaq/api test:lab
```

Repository-level security controls (hooks + secret/vuln scanning) are documented in:

- `docs/security-controls.md`

For containerized local infra, run from repo root:

```bash
docker compose up --build
```
