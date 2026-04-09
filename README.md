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

## Local Development

```bash
corepack pnpm install
corepack pnpm dev:web
```

Then open:

```text
http://localhost:5173
```

Run API separately if needed:

```bash
corepack pnpm dev:api
```

## Notes

- Docker setup remains in repo but is not required for current UI-first development.
- Current priority is frontend experience and video posting flow.
