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

The moderation service is wired for self-hosted open-source AI runtimes (`ollama`, `vllm`, `tgi`).

For containerized local infra, run from repo root:

```bash
docker compose up --build
```
