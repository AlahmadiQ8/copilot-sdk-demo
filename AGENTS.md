# AGENTS.md

## Overview

Copilot SDK service template — API + web UI deployed to Azure Container Apps.

- **`src/api/`** — Express API (TypeScript, Node 24). AI endpoints (chat with SSE streaming + one-shot summarize) via `@github/copilot-sdk`.
- **`src/web/`** — Chat UI with SSE streaming support. React + Vite.
- **`infra/`** — Azure infrastructure (Bicep). Two container apps (API internal + Web external) + ACR + Key Vault + monitoring.

## Key Files

| File | Purpose |
|------|---------|
| `src/api/index.ts` | Express server setup, CORS, route registration |
| `src/api/model-config.ts` | Three-path model configuration with per-request token refresh for Azure BYOM |
| `src/api/routes/chat.ts` | POST `/chat` — multi-turn chat with token-level SSE streaming |
| `src/api/routes/summarize.ts` | POST `/summarize` — one-shot text summarization |
| `src/api/routes/health.ts` | GET `/health` — health check |
| `src/web/hooks/useService.ts` | Chat hook — SSE streaming client |
| `src/web/components/ChatWindow.tsx` | Message display with markdown rendering |
| `infra/main.bicep` | Bicep orchestration — includes optional BYOM resources |
| `infra/resources.bicep` | Azure resources (Container Apps, ACR, Key Vault, optional OpenAI) |
| `scripts/get-github-token.mjs` | azd hook — injects GITHUB_TOKEN from `gh auth token` |

## Model Configuration

Three model paths via environment variables:

| Variable | Values | Effect |
|----------|--------|--------|
| `MODEL_PROVIDER` | unset or `azure` | GitHub models or Azure BYOM |
| `MODEL_NAME` | model name (e.g., `gpt-4o`) | Specific model selection |
| `AZURE_OPENAI_ENDPOINT` | Azure endpoint URL | Required when `MODEL_PROVIDER=azure` |

Default: no env vars set → SDK picks default GitHub model.

## Environment

- Node ≥ 24, pnpm for package management. **Always use `pnpm`, never `npm` or `yarn`.**
- `gh` CLI required for provisioning (provides `GITHUB_TOKEN` via `scripts/get-github-token.mjs`).

## Commands

| Task | Directory | Command |
|---|---|---|
| Run service | root | `azd app run` |
| Install API deps | `src/api` | `pnpm install` |
| Install Web deps | `src/web` | `pnpm install` |
| Build | `src/api` | `pnpm run build` |
| Dev | `src/api` | `pnpm run dev` |
| Deploy to Azure | root | `azd up` |

[`azd app run`](https://github.com/jongio/azd-app) is the recommended way to run locally.

## Coding Conventions

- ESM throughout (`"type": "module"`). Use `.js` extensions in imports.
- Routes go in `src/api/routes/`.
- File names: kebab-case for configs, camelCase for source files.

## Safety

- Never commit secrets. `GITHUB_TOKEN` is injected at deploy time via Key Vault.
- Dockerfile runs as non-root user (`app`).
