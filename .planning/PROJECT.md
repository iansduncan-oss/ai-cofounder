# AI Cofounder

## What This Is

AI Cofounder is a multi-agent AI assistant platform that orchestrates specialist agents (Researcher, Coder, Reviewer, Planner, Debugger, DocWriter, Verifier) to execute software engineering goals. It's accessible via Discord bot, Slack bot, web dashboard, and voice UI — all backed by a Fastify API server with PostgreSQL persistence, BullMQ job queues, and Docker sandboxed code execution.

## Core Value

Users can visualize, monitor, and trigger multi-stage agent pipelines from the dashboard with real-time progress feedback.

## Current Milestone: v1.1 Pipeline Dashboard UI

**Goal:** Build dashboard pages for visualizing, monitoring, and triggering pipeline runs with real-time stage progress.

**Target features:**
- Pipeline list page showing all runs with status, progress, and timing
- Pipeline detail view with stage-by-stage progress, logs, and timing
- Trigger pipelines from the dashboard UI (custom stages or goal-based)
- Real-time stage progress updates via polling/SSE

## Requirements

### Validated

- ✓ Multi-agent orchestration with 20+ tools and agentic tool loop — existing
- ✓ Discord bot with 8 slash commands — existing
- ✓ Slack bot with 8 slash commands (Bolt + Socket Mode) — existing
- ✓ Web dashboard with streaming chat, conversation persistence, sidebar — existing
- ✓ Voice UI served at /voice/ — existing
- ✓ PostgreSQL persistence via Drizzle ORM (goals, tasks, memories, conversations, events) — existing
- ✓ Docker sandboxed code execution (TS, JS, Python, Bash) — existing
- ✓ Multi-LLM provider abstraction with task-based routing and health tracking — existing
- ✓ Cron scheduler with daily briefing — existing
- ✓ Goal verification via VerifierAgent — existing
- ✓ Prometheus metrics, request tracing, tool execution tracking — existing
- ✓ Git tools (clone, status, diff, add, commit, log, pull, branch, checkout, push) — existing
- ✓ Workspace file operations (read, write, list, delete) — existing
- ✓ Cost guardrails (DAILY_TOKEN_LIMIT) and exponential backoff — existing
- ✓ CI/CD with auto-deploy on green tests — existing
- ✓ Message queue infrastructure (Redis + BullMQ) with separate worker process — v1.0
- ✓ Real-time SSE streaming via Redis pub/sub — v1.0
- ✓ JWT authentication for dashboard (login, refresh, logout) — v1.0
- ✓ E2E integration tests (goal lifecycle) — v1.0
- ✓ Conversation export, OpenAPI docs, agent roles endpoint — v1.0

### Active

- [ ] Pipeline list page with status/progress overview
- [ ] Pipeline detail view with stage-by-stage progress and logs
- [ ] Trigger pipelines from dashboard (custom and goal-based)
- [ ] Real-time pipeline stage progress updates

### Out of Scope

- OAuth / SSO providers — JWT sufficient for single-user; defer to future milestone
- Horizontal scaling — message queue enables this but actual multi-instance is future work
- Circuit breaker pattern — existing exponential backoff and provider fallback is adequate for now
- Database read replicas — current load doesn't warrant this complexity
- WebSocket support — SSE streaming is working well for current needs
- Pipeline CRUD (create/edit/delete pipeline definitions) — this milestone covers execution monitoring, not pipeline template management
- Pipeline scheduling/recurring runs — deferred to future milestone

## Context

- **Monorepo** (Turborepo): apps/agent-server, apps/discord-bot, apps/slack-bot, apps/dashboard, apps/voice-ui, packages/db, packages/llm, packages/sandbox, packages/api-client, packages/bot-handlers, packages/shared, packages/test-utils
- **VPS**: Hetzner at 168.119.162.59, deployed via Docker Compose, CI auto-deploys on green tests
- **Test coverage**: ~958 tests across 65 files, all passing — but zero E2E/integration tests
- **Current pain point**: Agent tasks (especially multi-step goals with tool loops) run synchronously in request handlers, blocking the Fastify event loop during long executions
- **Dashboard**: Currently no auth — anyone with the URL can access chat, goals, workspace

## Constraints

- **Stack**: Must integrate with existing Turborepo + Fastify + Drizzle + PostgreSQL stack
- **Redis**: New dependency — needs Docker Compose addition for both dev and production
- **Backwards compatible**: Bot commands and API endpoints must continue working during migration
- **Single user**: Auth is single-user (Ian) for now — don't over-engineer multi-tenant

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| BullMQ over raw Redis pub/sub | BullMQ provides job queues, retries, priorities, and dashboard out of the box | — Pending |
| JWT over OAuth for v1 auth | Single user, no need for OAuth complexity; JWT is fast to implement | — Pending |
| Redis added as Docker Compose service | Keeps infrastructure self-contained, matches existing Docker-based deploy | — Pending |
| E2E tests use test database | Isolation from production data, can reset between test runs | — Pending |

---
*Last updated: 2026-03-09 after v1.1 Pipeline Dashboard UI milestone started*
