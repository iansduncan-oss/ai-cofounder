# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Session Workflow

At the **start** of each session:
1. Read `.claude/primer.md` for context from the previous session
2. Read `.claude/git-state.md` for current repository state (includes staleness warnings and session metadata)
3. Read `.claude/commit-log.md` for recent commit history
4. If git-state.md has **staleness warnings**, mention them proactively to the user
5. If `~/.claude/projects-overview.md` exists, it has cross-project status (read if relevant)

At the **end** of each session (**MANDATORY** — always do this before the session ends):
1. Completely rewrite `.claude/primer.md` with all sections below
2. The first line after the `# Session Primer` heading MUST be the metadata line:
   `**Session #N** | **Last Updated:** YYYY-MM-DD HH:MM UTC`
   (increment N from previous value, or start at 1 for first session)
3. Required sections:
   - **Current State** — branch, milestone, what the project looks like right now
   - **Last Session Work** — what was accomplished this session
   - **Next Steps** — exact next actions to take
   - **Open Blockers** — anything unresolved or stuck
   - **Files Modified** — key files changed this session

**Session-end detection**: If the user says "bye", "done", "that's it", "thanks", wraps up, or seems to be ending the conversation, **proactively offer to update the primer** before the session ends. Do not wait to be asked.

## Project Overview

AI Cofounder — a multi-agent system built as a Turborepo monorepo. Orchestrates AI agents that collaborate on business tasks, exposed through Discord, Slack, a voice UI, and a React dashboard. Automated via n8n workflows and BullMQ job queues.

## Monorepo Structure

- **apps/agent-server** — Fastify server, multi-agent orchestration (port 3100)
- **apps/discord-bot** — Discord bot with 8 slash commands, uses `@ai-cofounder/api-client` + `@ai-cofounder/bot-handlers`
- **apps/slack-bot** — Slack bot (Bolt + Socket Mode) with 8 slash commands, uses `@ai-cofounder/api-client` + `@ai-cofounder/bot-handlers`
- **apps/dashboard** — React + Vite + TanStack Query + React Router + Tailwind v4
- **apps/voice-ui** — Static HTML/CSS/JS voice interface served at `/voice/` by agent-server
- **apps/n8n** — n8n workflow automation (Docker-based)
- **packages/db** — Drizzle ORM schema + repositories + migrations, postgres.js client, auto-migrations at startup
- **packages/llm** — Multi-LLM provider abstraction (Anthropic, Groq, Gemini, OpenRouter) with task-based routing and fallback chains
- **packages/queue** — BullMQ + Redis task queue (agent-tasks, monitoring, briefings, notifications, pipelines)
- **packages/sandbox** — Docker-based isolated code execution (TS, JS, Python, Bash)
- **packages/api-client** — Typed fetch-based API client for all agent-server endpoints
- **packages/bot-handlers** — Platform-agnostic command handlers (shared by Discord + Slack bots)
- **packages/rag** — RAG pipeline for document retrieval
- **packages/shared** — Shared types, pino logger (`createLogger`), env config helpers (`requireEnv`, `optionalEnv`)
- **packages/test-utils** — Shared test fixtures (mockSharedModule, mockLlmModule, mockDbModule)
- **packages/mcp-server** — MCP server wrapping ApiClient (12 tools for Claude Code integration)

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
npm run docker:up      # Start Postgres + n8n + Redis
npm run db:push        # Push schema to Postgres
npm run dev            # Start all services in watch mode
```

Services available at:

- Agent Server: http://localhost:3100
- Dashboard: http://localhost:5173
- Voice UI: http://localhost:3100/voice/
- OpenAPI docs: http://localhost:3100/docs
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

- **Orchestrator** — agentic tool loop (up to 5 rounds) with tools: `create_plan`, `create_milestone`, `request_approval`, `save_memory`, `recall_memories`, `search_web`, `browse_web`, `trigger_workflow`, `list_workflows`, `execute_code`, `create/list/delete_schedule`, `read_file`, `write_file`, `delete_file`, `delete_directory`, `list_directory`, `git_clone`, `git_status`, `git_diff`, `git_add`, `git_commit`, `git_log`, `git_pull`, `git_branch`, `git_checkout`, `git_push`, `run_tests`, `create_pr`, `submit_verification`
- **Specialist agents** — `ResearcherAgent`, `CoderAgent` (with self-review), `ReviewerAgent`, `PlannerAgent`, `DebuggerAgent`, `DocWriterAgent`, `VerifierAgent`
- **Base class** — `SpecialistAgent` with tool loop (max 3 rounds) and `completeWithRetry()` (single retry, 2s backoff on 429/timeout/ECONNRESET/503)
- **TaskDispatcher** — executes goal tasks in orderIndex, passes outputs as context chain, checks pending approvals before each task, post-execution self-improvement analysis

## Adding New Orchestrator Tools

1. **Define the tool** — Create/update a file in `apps/agent-server/src/agents/tools/` exporting an `LlmTool` constant
2. **Add service method** — Add the method to the relevant service (e.g., `WorkspaceService`)
3. **Import in orchestrator** — Import the tool constant in `orchestrator.ts`
4. **Register conditionally** — Push to the `tools` array if the required service is available
5. **Handle execution** — Add a `case` in `executeTool()` switch statement
6. **Add route (optional)** — Create REST endpoint in `apps/agent-server/src/routes/`
7. **Write tests** — Add tests in `apps/agent-server/src/__tests__/` with proper mocking

## Test Mocking Patterns

Tests must mock three packages before importing the module under test:

```typescript
// 1. Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// 2. Mock @ai-cofounder/db with individual mock fns
const mockCreateGoal = vi.fn().mockResolvedValue({ id: "goal-1" });
vi.mock("@ai-cofounder/db", () => ({
  createGoal: (...args: unknown[]) => mockCreateGoal(...args),
}));

// 3. Mock @ai-cofounder/llm with MockLlmRegistry
vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry };
});
```

**Critical**: `getProviderHealth = vi.fn().mockReturnValue([])` is required in MockLlmRegistry. Import the module AFTER mocks are set up using dynamic `await import()`.

## Milestones

Multi-step planning via `milestones` table. Goals can be linked to milestones via `goals.milestone_id`. Routes: `POST/GET/PATCH/DELETE /api/milestones`, `GET /:id/progress`, `POST /:id/goals`.

## Workspace & Git Integration

Scoped to `WORKSPACE_DIR` env (default `/tmp/ai-cofounder-workspace`). Path traversal protection via `resolveSafe()`. Tools conditionally added when `workspaceService` is provided to orchestrator constructor.

## Security & Rate Limiting

- `API_SECRET` env var enables bearer token auth on `/api/*` routes (internal/localhost requests bypass)
- Two-bucket rate limiting: general (`RATE_LIMIT_MAX`, default 60) and expensive (`RATE_LIMIT_EXPENSIVE_MAX`, default 10) for `/api/agents/run`, `/api/n8n/webhook`, `/api/goals/`
- Honeypot path blocking (`.env`, `.git`, `/wp-admin`, etc.) with IP banning after 10 hits
- Global error handler normalizes all errors to `{ error, statusCode }`, hides internals on 500s

## Claude Code Enhancements

**MCP servers** (5 in `.mcp.json`): `postgres` (direct DB), `docker`, `redis`, `bullmq`, `ai-cofounder` (12 tools wrapping ApiClient)

**Skills** (5 in `~/.claude/skills/`): `ai-cofounder-deploy`, `ai-cofounder-test`, `ai-cofounder-db`, `ai-cofounder-monitor`, `ai-cofounder-logs`

**Hooks** (in `.claude/settings.local.json`):
- Auto-lint on Edit/Write (eslint --fix)
- Auto-build on Edit/Write for: `packages/db`, `packages/llm`, `packages/shared`, `packages/queue`, `packages/api-client`, `packages/bot-handlers`, `packages/rag`

## Production Infrastructure

Deployed on Hetzner VPS behind Nginx Proxy Manager with TLS termination. Project path: `/opt/ai-cofounder`.

**Services:**

- **Agent Server** — https://api.aviontechs.com (Fastify, port 3100)
- **Discord Bot** — running, connected to agent-server
- **Slack Bot** — running, Socket Mode
- **n8n** — https://n8n.aviontechs.com (`docker-compose.n8n.yml`)
- **Uptime Kuma** — https://status.aviontechs.com (`docker-compose.uptimekuma.yml`)

**Monitoring:**

- **Grafana** — https://grafana.aviontechs.com (port 3200)
- **Prometheus** — localhost:9090 (metrics at `GET /metrics`)
- **Alertmanager** — localhost:9093 (sends alerts to Discord webhook)
- All three in `docker-compose.monitoring.yml`

**Reverse Proxy:** Nginx Proxy Manager (NPM) — admin UI on port 8181 (SSH tunnel only). Docker network: `avion_avion_net`.

**Database:** PostgreSQL 16 with pgvector extension. Nightly backups to Hetzner Storage Box (7-day local retention, rsync offsite).

**Security:** UFW firewall (ports 22, 80, 443 open). fail2ban on SSH. Docker ports 81, 3100, 3200 bound to 127.0.0.1.

**Docker:** Global log rotation configured in `/etc/docker/daemon.json` (10MB, 3 files).

**Deploy:** Push to `main` triggers CI → deploy to VPS via Tailscale SSH. Pulls latest code, builds Docker images on VPS, restarts via Docker Compose. Discord webhook notification on success/failure.

## Environment

- Node.js v24+, npm 11+
- Docker + Docker Compose required for n8n, Postgres, and Redis
- Dev scripts use `tsx watch --env-file=../../.env` to load root .env
- Key env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY` (required); `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` (optional fallback providers)
- Discord: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` (required for bot)
- Slack: `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`
- Queue: `REDIS_URL` (default `redis://localhost:6379`)
- Monitoring: `GITHUB_TOKEN`, `GITHUB_MONITORED_REPOS`, `VPS_HOST`, `VPS_USER`
- Voice/TTS: `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID`
- Security: `API_SECRET`, `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW`, `RATE_LIMIT_EXPENSIVE_MAX`
- Usage: `DAILY_TOKEN_LIMIT`
- Scheduler: `DISCORD_FOLLOWUP_WEBHOOK_URL`, `BRIEFING_HOUR`, `BRIEFING_TIMEZONE`
- See `.env.example` for full list
