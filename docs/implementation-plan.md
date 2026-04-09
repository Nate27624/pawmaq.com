# Implementation Plan

## Delivery Approach

- Monorepo with `apps/` + `packages/`
- API-first backend with strict contracts and idempotent writes
- Open-source, self-hosted AI moderation from day one
- Ship thin vertical slices every 1-2 weeks

## Milestones

### M1: Platform Core (Weeks 1-2)

- Workspace/toolchain setup (`pnpm`, TypeScript, lint/typecheck)
- API skeleton with health, auth, and content modules
- PostgreSQL schema v1 and migration pipeline
- Event bus baseline (`NATS`) and job worker shell

### M2: Social Foundation (Weeks 3-4)

- Users/profiles
- Communities and memberships
- Posts/replies CRUD with idempotency keys
- Follows, blocks, mutes

### M3: Feed + Search v1 (Weeks 5-6)

- Home/community feed endpoints with cursor pagination
- Chronological + simple scored ranking
- Search v1 with PostgreSQL FTS or OpenSearch

### M4: Moderation + AI (Weeks 7-8)

- Report intake and moderator action API
- Rule-based moderation checks
- Open-source AI moderation inference service integration
- Audit trail and review queue UI contracts

### M5: Reliability + Beta (Weeks 9-12)

- Load/perf tuning and caching
- Alerting, dashboards, and incident runbooks
- Security review and abuse simulation tests
- Closed beta release gate

## Issue-Ready Backlog

1. `infra`: initialize monorepo workspace and CI typecheck pipeline
2. `db`: define schema for users/profiles/communities/posts/replies/reports
3. `auth`: implement register/login/session rotation endpoints
4. `content`: implement post create/read/update/delete with policy hooks
5. `social`: implement follow/block/mute commands and queries
6. `feed`: implement cursor-based home feed query
7. `moderation`: implement report submission and triage queue
8. `ai-mod`: add open-source model gateway interface and adapters
9. `ai-mod`: build policy evaluator and threshold config store
10. `ops`: add observability (logs/metrics/traces) and SLO alerts
11. `security`: implement rate limits, abuse heuristics, and audit checks
12. `docs`: publish public model cards and moderation policy matrix

## Definition of Done (Per Feature)

- Contract tests for API endpoint behavior
- Idempotency and authorization checks
- Structured logs and metrics
- Audit-safe moderation metadata for relevant actions
- Documentation update in `docs/`

## Risks and Mitigations

- Model false positives:
  - Mitigation: shadow mode + conservative auto-action thresholds
- Operational overhead of self-hosted AI:
  - Mitigation: start with CPU-friendly models and scale GPU later
- Abuse evasion:
  - Mitigation: layered deterministic + model + human review controls
