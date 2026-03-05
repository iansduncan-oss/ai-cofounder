# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Cofounder — a multi-agent system built as a Turborepo monorepo. Orchestrates AI agents that collaborate on business tasks, exposed through Discord and automated via n8n workflows.

## Monorepo Structure

- **apps/agent-server** — Fastify server, multi-agent orchestration (port 3100)
- **apps/discord-bot** — Discord bot with `/ask` and `/status` slash commands, calls agent-server
- **apps/n8n** — n8n workflow automation (Docker-based)
- **packages/shared** — Types (AgentMessage, AgentRun, Conversation), pino logger, env config helpers
- **packages/db** — Drizzle ORM schema (users, conversations, messages, agent_runs) + postgres.js client

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
- n8n: http://localhost:5678 (admin / localdev)

## Architecture

- **TypeScript**: Strict mode, ES2022 target, Node16 module resolution. Shared `tsconfig.base.json` extended by each workspace.
- **Testing**: Vitest with root config (`vitest.config.ts`). Tests live in `src/__tests__/` (excluded from tsc build). Run from source (not compiled JS). Mock Anthropic SDK with `vi.mock()`.
- **Agent Server**: Fastify + pino logging. Routes in `src/routes/`, agents in `src/agents/`. `buildServer()` returns `{ app, logger }` — use `app.inject()` for testing. Dev mode uses `tsx watch`.
- **Database**: Drizzle ORM with PostgreSQL. App uses `ai_cofounder` database; n8n uses separate `n8n` database (created by `infra/init-n8n-db.sh`). Use `db:push` for dev, `db:generate`/`db:migrate` for production.
- **Shared Package**: All cross-cutting types and utilities. Import as `@ai-cofounder/shared`. Logger: `createLogger("service-name")`. Config: `requireEnv()` / `optionalEnv()`.

## Discord Bot

- `/ask <message>` — sends user message to agent-server orchestrator, returns response in an embed
- `/status` — hits agent-server `/health`, shows system uptime
- Per-channel conversation tracking (in-memory)
- `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` required in `.env`
- `AGENT_SERVER_URL` optional (defaults to `http://localhost:3100`)
- Slash commands auto-registered on startup via Discord REST API

## Production Infrastructure

Deployed on Hetzner VPS at `168.119.162.59`. Project path: `/opt/ai-cofounder`.

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

**Database:** PostgreSQL with two databases: `ai_cofounder` (app) and `n8n`. Nightly backups at `/opt/backups/postgres/` (14-day retention, cron at 3 AM).

**Security:** UFW firewall (ports 22, 80, 443 open). fail2ban on SSH.

**Docker:** Global log rotation configured in `/etc/docker/daemon.json` (10MB, 3 files).

**Deploy:** Push to `main` triggers CI → deploy to VPS via GHCR + Fly.io. Discord notification on deploy via `DISCORD_DEPLOY_WEBHOOK_URL` secret.

## Environment

- Node.js v24.12.0, npm 11.6.2
- Docker + Docker Compose required for n8n and Postgres
- `DATABASE_URL` env var required for db operations
- `PORT` (default 3100), `HOST` (default 0.0.0.0) for agent-server
- `LOG_LEVEL` (default "info") for pino logger
- `ANTHROPIC_API_KEY` required for Claude API (orchestrator)
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` required for Discord bot
- `AGENT_SERVER_URL` (default `http://localhost:3100`) for bot → server communication
