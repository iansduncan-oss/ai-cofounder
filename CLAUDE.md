# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Cofounder — a multi-agent system built as a Turborepo monorepo. Orchestrates AI agents that collaborate on business tasks, exposed through Discord and automated via n8n workflows.

## Monorepo Structure

- **apps/agent-server** — Fastify server, multi-agent orchestration (port 3100)
- **apps/discord-bot** — Discord bot (not yet implemented)
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

# Database (from packages/db)
npm run db:generate    # Generate Drizzle migrations
npm run db:migrate     # Run migrations
npm run db:studio      # Open Drizzle Studio
```

## Architecture

- **TypeScript**: Strict mode, ES2022 target, Node16 module resolution. Shared `tsconfig.base.json` extended by each workspace.
- **Testing**: Vitest with root config (`vitest.config.ts`). Tests live in `src/__tests__/`. Run from source (not compiled JS).
- **Agent Server**: Fastify + pino logging. Routes in `src/routes/`, agents in `src/agents/`. `buildServer()` returns `{ app, logger }` — use `app.inject()` for testing.
- **Database**: Drizzle ORM with PostgreSQL. Schema defines pg enums for `agent_role` and `agent_run_status`. `createDb(connectionString)` returns typed client.
- **Shared Package**: All cross-cutting types and utilities. Import as `@ai-cofounder/shared`. Logger: `createLogger("service-name")`. Config: `requireEnv()` / `optionalEnv()`.

## Environment

- Node.js v24.12.0, npm 11.6.2
- Docker + Docker Compose required for n8n and Postgres
- `DATABASE_URL` env var required for db operations
- `PORT` (default 3100), `HOST` (default 0.0.0.0) for agent-server
- `LOG_LEVEL` (default "info") for pino logger
