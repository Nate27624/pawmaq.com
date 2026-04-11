# pawmaq.com

Open-source social platform workspace for a Reddit/Twitter-style network with a video-first UI.

## Vision

Build a free, open-source community platform that combines:

- Topic communities and threaded discussions (Reddit-like)
- Follow graph and short-form feed (Twitter-like)
- Transparent moderation and healthy defaults

## Design Docs

- [Platform Blueprint](docs/platform-blueprint.md)
- [Open-Source AI Moderation Architecture](docs/ai-moderation-oss-architecture.md)
- [Implementation Plan](docs/implementation-plan.md)
- [Security Controls](docs/security-controls.md)

## Project Principles

- Free and open-source (AGPLv3 recommended for network software)
- Privacy-forward with clear consent and minimal tracking
- Moderation-first architecture, not moderation as an afterthought
- Scale from a single-node deployment to multi-region clusters
- AI moderation is open-source and self-hosted by default

## Workspace

- `apps/web`: frontend UI (X + YouTube inspired feed, world tab, video/gif/png posting)
- `apps/api`: backend API scaffold with moderation pipeline interface
- `docs/`: architecture and delivery docs

## Current Frontend State

- Feed tabs: `Following` and `World`
- Time windows: `10 min`, `1 hr`, `12 hrs`, `24 hrs`, `1 week`, `1 month`, `3 months`, `1 year`
- Sort mode is configured from the top-right account menu:
  - `Most likes`
  - `Highest approval`
- World map is clickable for country filtering in `World` feed mode
- Infinite scroll with client-side "seen post" tracking to avoid repeat posts
- Composer supports text-only posts, plus optional `video`, `gif`, and `png` uploads
- `.jpg`/`.jpeg` uploads are converted to `.png` in-browser
- Post budget limit is `200MB` total (`text + media`)
- Posting, commenting, voting, and media uploads require sign-in (Google OAuth supported)
- Hidden ledger route at `/ledger` (not linked in the main UI) with searchable profile + post ledger export
- Interactive test dashboard at `/test-lab` for custom test users/posts/comments/replies and scenario execution
- Optional RSS bot ingestion (Mastodon-compatible RSS) to seed feed content into the ledgers

## Local Development

```bash
corepack pnpm install
corepack pnpm dev:api
# in another terminal
corepack pnpm dev:web
```

Then open:

```text
http://localhost:5173
```

`dev:api` is required for server-persisted profile customization and follow state.

To enable RSS bot seeding, set API env vars (for example in `.env`):

```bash
RSS_BOTS_ENABLED=true
RSS_BOTS_INTERVAL_MINUTES=15
RSS_BOTS_MAX_ITEMS_PER_FEED_PER_RUN=0
RSS_BOTS_FEEDS='[{"feedUrl":"https://feeds.washingtonpost.com/rss/world","handle":"@washpost_world_rss","name":"Washington Post World","countryCode":"US","countryName":"United States"},{"feedUrl":"https://feeds.npr.org/1001/rss.xml","handle":"@npr_news_rss","name":"NPR News","countryCode":"US","countryName":"United States"},{"feedUrl":"https://feeds.bbci.co.uk/news/world/rss.xml","handle":"@bbc_world_rss","name":"BBC World News","countryCode":"GB","countryName":"United Kingdom"},{"feedUrl":"https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml","handle":"@nytimes_top_rss","name":"NYT Top Stories","countryCode":"US","countryName":"United States"},{"feedUrl":"https://www.theguardian.com/world/rss","handle":"@guardian_world_rss","name":"The Guardian World","countryCode":"WW","countryName":"Worldwide"}]'
```

Defaults now enable RSS bots in local development with these curated mainstream feeds. Session storage defaults to in-memory, so
local startup does not require Redis.

To run the automated API test-lab suite:

```bash
corepack pnpm test:lab
```

To run the repository security checks:

```bash
corepack pnpm security:full
```

## Google Sign-In Setup

1. Create a Web OAuth client in Google Cloud Console.
2. Add authorized JavaScript origins:
   - `http://localhost:5173` (web dev)
   - your production web origin (for example `https://pawmaq.com`)
3. Set environment variables:
   - `VITE_GOOGLE_CLIENT_ID` in the web app env.
   - `GOOGLE_OAUTH_CLIENT_IDS` in the API env (comma-separated allowlist).
4. Configure persistent auth sessions:
   - `AUTH_SESSION_STORE=redis`
   - `REDIS_URL=redis://...`
5. In production:
   - `GOOGLE_OAUTH_CLIENT_IDS` is required.
   - `AUTH_SESSION_STORE` must be `redis`.
   - API startup fails fast if these are missing.

Auth/session hardening now includes:
- Google access token audience validation against `GOOGLE_OAUTH_CLIENT_IDS`.
- Rate limiting for `POST /v1/auth/google/session`.
- Redis-backed session persistence (survives API restarts).
- Periodic session validity checks in the client with automatic sign-out on expiry.

## Notes

- Docker setup remains in repo but is not required for current UI-first development.
- Current priority is frontend experience and video posting flow.
