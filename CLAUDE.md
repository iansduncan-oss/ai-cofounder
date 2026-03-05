# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Cofounder — a multi-agent system built as a Turborepo monorepo. Orchestrates AI agents that collaborate on business tasks, exposed through Discord and automated via n8n workflows.

## Monorepo Structure

- **apps/agent-server** — Fastify server, multi-agent orchestration (port 3100)
- **apps/discord-bot** — Discord bot with 8 slash commands, calls agent-server
- **apps/voice-ui** — Static HTML/CSS/JS voice interface served at `/voice/` by agent-server
- **apps/n8n** — n8n workflow automation (Docker-based)
- **packages/db** — Drizzle ORM schema + repositories + migrations, postgres.js client, auto-migrations at startup
- **packages/llm** — Multi-LLM provider abstraction (Anthropic, Groq, Gemini, OpenRouter) with task-based routing and fallback chains
- **packages/shared** — Shared types, pino logger (`createLogger`), env config helpers (`requireEnv`, `optionalEnv`)

## Commands

```bash
# Monorepo (from root)
npm run build          # Build all packages (turbo, respects dependency graph)
npm run dev            # Dev mode, all packages
npm run test           # Test all packages (vitest)
npm run clean          # Clean dist/ and .turbo/

# Single workspace
npm run build -w @ai-cofounder/agent-server
npm run test -w @ai-cofounder/shared

# Docker (Postgres + n8n)
npm run docker:up      # Start Postgres + n8n containers
npm run docker:down    # Stop containers
npm run docker:logs    # Tail container logs

# Database (from root or packages/db)
npm run db:push        # Push schema to DB (dev, no migration files)
npm run db:generate    # Generate Drizzle migrations
npm run db:migrate     # Run migrations
npm run db:studio      # Open Drizzle Studio
```

## Local Dev Setup

```bash
cp .env.example .env   # Copy and fill in secrets
npm run docker:up      # Start Postgres + n8n
npm run db:push        # Push schema to Postgres
npm run dev            # Start all services in watch mode
```

Services available at:

- Agent Server: http://localhost:3100
- Voice UI: http://localhost:3100/voice/
- n8n: http://localhost:5678 (admin / localdev)

## Architecture

- **TypeScript**: Strict mode, ES2022 target, Node16 module resolution. Shared `tsconfig.base.json` extended by each workspace.
- **Testing**: Vitest with root config (`vitest.config.ts`). Tests live in `src/__tests__/` (excluded from tsc build). Run from source (not compiled JS). Mock `@ai-cofounder/db` with individual mock fns AND `@ai-cofounder/llm` with MockLlmRegistry.
- **Agent Server**: Fastify + pino logging. Routes in `src/routes/`, agents in `src/agents/`, plugins in `src/plugins/`. `buildServer(registry?)` accepts optional LlmRegistry; creates one via `createLlmRegistry()` if not provided. `app.llmRegistry` Fastify decorator. Use `app.inject()` for testing. Dev mode uses `tsx watch`.
- **Multi-LLM**: `LlmRegistry` routes by task category (planning→Opus, conversation→Sonnet, simple→Groq, research→Gemini, code→Sonnet) with automatic fallback chains. Providers share an OpenAI-compatible base class.
- **Database**: Drizzle ORM with PostgreSQL + pgvector. Auto-migrations run at startup via `runMigrations()`. Use `db:push` for dev, `db:generate`/`db:migrate` for production.
- **Semantic Memory**: Memories stored with 768-dim vector embeddings (Gemini `text-embedding-004`). Recall uses cosine similarity with ILIKE fallback.
- **Shared Package**: Import as `@ai-cofounder/shared`. Logger: `createLogger("service-name")`. Config: `requireEnv()` / `optionalEnv()` (note: `optionalEnv` requires 2 args — name + defaultValue).

## Agent System

- **Orchestrator** — agentic tool loop (up to 5 rounds) with tools: `create_plan`, `request_approval`, `save_memory`, `recall_memories`, `search_web`, `trigger_workflow`, `list_workflows`
- **Specialist agents** — `ResearcherAgent`, `CoderAgent` (with self-review), `ReviewerAgent`, `PlannerAgent`
- **Base class** — `SpecialistAgent` with tool loop (max 3 rounds) and `completeWithRetry()` (single retry, 2s backoff on 429/timeout/ECONNRESET/503)
- **TaskDispatcher** — executes goal tasks in orderIndex, passes outputs as context chain, checks pending approvals before each task

## Discord Bot

All 8 commands:

- `/ask <message>` — send message to orchestrator
- `/status` — health check + uptime
- `/goals` — list goals for current channel's conversation
- `/tasks` — list pending tasks
- `/memory` — display user's stored memories (ephemeral)
- `/clear` — clear channel conversation mapping
- `/execute <goal_id>` — execute a goal via TaskDispatcher
- `/approve <approval_id>` — resolve a pending approval

Per-channel conversation tracking (in-memory). Slash commands auto-registered on startup via Discord REST API.

## Security & Rate Limiting

- `API_SECRET` env var enables bearer token auth on `/api/*` routes (internal/localhost requests bypass)
- Two-bucket rate limiting: general (`RATE_LIMIT_MAX`, default 60) and expensive (`RATE_LIMIT_EXPENSIVE_MAX`, default 10) for `/api/agents/run`, `/api/n8n/webhook`, `/api/goals/`
- Honeypot path blocking (`.env`, `.git`, `/wp-admin`, etc.) with IP banning after 10 hits
- Global error handler normalizes all errors to `{ error, statusCode }`, hides internals on 500s

## Production Infrastructure

Deployed on Hetzner VPS behind Nginx Proxy Manager with TLS termination. Project path: `/opt/ai-cofounder`.

**Services:**

- **Agent Server** — https://api.aviontechs.com (Fastify, port 3100)
- **Discord Bot** — running, connected to agent-server
- **n8n** — https://n8n.aviontechs.com (`docker-compose.n8n.yml`)
- **Uptime Kuma** — https://status.aviontechs.com (`docker-compose.uptimekuma.yml`)

**Monitoring:**

- **Grafana** — https://grafana.aviontechs.com (port 3200)
- **Prometheus** — localhost:9090
- **Alertmanager** — localhost:9093 (sends alerts to Discord webhook)
- All three in `docker-compose.monitoring.yml`

**Reverse Proxy:** Nginx Proxy Manager (NPM) — admin UI on port 8181 (SSH tunnel only). Docker network: `avion_avion_net`.

**Database:** PostgreSQL 16 with pgvector extension. Nightly backups to Hetzner Storage Box (7-day local retention, rsync offsite).

**Security:** UFW firewall (ports 22, 80, 443 open). fail2ban on SSH. Docker ports 81, 3100, 3200 bound to 127.0.0.1.

**Docker:** Global log rotation configured in `/etc/docker/daemon.json` (10MB, 3 files).

**Deploy:** Push to `main` triggers CI → deploy to VPS via Tailscale SSH. Pulls latest code, builds Docker images on VPS, restarts via Docker Compose. Discord webhook notification on success/failure.

## Environment

- Node.js v24+, npm 11+
- Docker + Docker Compose required for n8n and Postgres
- Dev scripts use `tsx watch --env-file=../../.env` to load root .env
- Key env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY` (required); `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (optional fallback providers)
- Discord: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` (required for bot)
- Security: `API_SECRET`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `RATE_LIMIT_EXPENSIVE_MAX`
- Scheduler: `DISCORD_FOLLOWUP_WEBHOOK_URL`, `BRIEFING_HOUR`, `BRIEFING_TIMEZONE`
- See `.env.example` for full list
