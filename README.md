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

- `apps/web`: frontend UI (X + YouTube inspired feed, world tab, video upload)
- `apps/api`: backend API scaffold with moderation pipeline interface
- `docs/`: architecture and delivery docs

## Local Development

```bash
corepack pnpm install
corepack pnpm dev
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
