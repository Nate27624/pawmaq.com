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
- `POST /v1/auth/human-challenge`
- `POST /v1/auth/passkey/register/options`
- `POST /v1/auth/passkey/register/verify`
- `POST /v1/auth/passkey/authenticate/options`
- `POST /v1/auth/passkey/authenticate/verify`
- `POST /v1/auth/pairing/start`
- `POST /v1/auth/pairing/approve`
- `POST /v1/auth/pairing/status`
- `POST /v1/auth/pairing/complete`
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

- `AUTH_SESSION_TTL_HOURS` (defaults to `168`)
- `AUTH_SESSION_STORE` (`auto`, `memory`, or `redis`; defaults to `memory`)
- `AUTH_SESSION_REDIS_PREFIX` (defaults to `pawmaq:session:`)
- `REDIS_URL` (required when `AUTH_SESSION_STORE=redis`)
- `AUTH_COOKIE_SAME_SITE` (`strict`, `lax`, or `none`; defaults `strict`)
- `AUTH_COOKIE_SECURE` (`true`/`false`; defaults `false`, forced secure in production)
- `AUTH_COOKIE_DOMAIN` (optional cookie domain, defaults empty)
- `PASSKEY_LEDGER_PATH` (default `.context/passkey-ledger.json`)
- `WEBAUTHN_RP_NAME` (default `pawmaq.com`)
- `WEBAUTHN_RP_ID` (default `localhost`)
- `WEBAUTHN_EXPECTED_ORIGINS` (comma-separated, required for your web origins)
- `GUEST_PASSKEY_SESSION_TTL_MINUTES` (default `15`)
- `TEST_LAB_ENABLED` (`true`/`false`, defaults `false`; ignored in production)

Security behavior:
- In `production`, API startup fails unless `AUTH_SESSION_STORE=redis`.
- `AUTH_COOKIE_SAME_SITE=none` requires `AUTH_COOKIE_SECURE=true`.
- `POST /v1/auth/passkey/*/options` requires a valid proof from `POST /v1/auth/human-challenge`.
- Human verification challenges are short-lived, one-time-use, and IP-bound.
- Session records are persisted in Redis when available, so sessions survive API restarts.

Device pairing:
- `/v1/auth/pairing/start` accepts optional `intent`:
  - `sign_in` (default): QR pairs a signed-in phone to sign in this device.
  - `link`: QR links another authenticated identity into the current account.

## RSS Bot Ingestion

The API can ingest public RSS feeds (including Mastodon profile feeds) and mirror them into the post ledger using
named bot accounts persisted in the profile ledger.

Environment:

- `RSS_BOTS_ENABLED` (`true`/`false`, default `true`)
- `RSS_BOTS_INTERVAL_MINUTES` (default `15`)
- `RSS_BOTS_MAX_ITEMS_PER_FEED_PER_RUN` (default `0`; `0` means import all available feed items)
- `RSS_BOTS_USER_AGENT` (default `pawmaq-rss-bot/1.0 (+https://pawmaq.com)`)
- `RSS_BOTS_FEEDS` (defaults to a curated mainstream news set):
  - JSON format:
    - `[{"feedUrl":"https://feeds.washingtonpost.com/rss/world","handle":"@washpost_world_rss","name":"Washington Post World","countryCode":"US","countryName":"United States"},{"feedUrl":"https://feeds.npr.org/1001/rss.xml","handle":"@npr_news_rss","name":"NPR News","countryCode":"US","countryName":"United States"},{"feedUrl":"https://feeds.bbci.co.uk/news/world/rss.xml","handle":"@bbc_world_rss","name":"BBC World News","countryCode":"GB","countryName":"United Kingdom"},{"feedUrl":"https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml","handle":"@nytimes_top_rss","name":"NYT Top Stories","countryCode":"US","countryName":"United States"},{"feedUrl":"https://www.theguardian.com/world/rss","handle":"@guardian_world_rss","name":"The Guardian World","countryCode":"WW","countryName":"Worldwide"}]`
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
