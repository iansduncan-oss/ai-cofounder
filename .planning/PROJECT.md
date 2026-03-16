# AI Cofounder

## What This Is

AI Cofounder is a multi-agent AI assistant platform that orchestrates specialist agents (Researcher, Coder, Reviewer, Planner, Debugger, DocWriter, Verifier) to execute software engineering goals. It's accessible via Discord bot, Slack bot, web dashboard, and voice UI — all backed by a Fastify API server with PostgreSQL persistence, BullMQ job queues, and Docker sandboxed code execution. The dashboard includes a full pipeline management UI for visualizing, monitoring, and triggering multi-stage agent pipelines.

## Core Value

An AI-powered engineering partner that autonomously plans, executes, and verifies software tasks — accessible from any interface.

## Current State

**Shipped:** v1.1 Pipeline Dashboard UI (2026-03-09)

The platform is fully operational with:
- Multi-agent orchestration (20+ tools, agentic tool loop)
- BullMQ job queue with worker process and SSE streaming
- JWT-authenticated dashboard with pipeline management
- Discord + Slack bots (8 commands each)
- Voice UI with ElevenLabs TTS
- ~960 tests across 65+ files, all passing
- CI/CD with auto-deploy on green tests

## Requirements

### Validated

- ✓ Multi-agent orchestration with 20+ tools and agentic tool loop — existing
- ✓ Discord bot with 8 slash commands — existing
- ✓ Slack bot with 8 slash commands (Bolt + Socket Mode) — existing
- ✓ Web dashboard with streaming chat, conversation persistence, sidebar — existing
- ✓ Voice UI served at /voice/ — existing
- ✓ PostgreSQL persistence via Drizzle ORM — existing
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
- ✓ Pipeline list page with state filtering, timing, clickable navigation — v1.1
- ✓ Pipeline detail view with stage-by-stage progress, expandable outputs — v1.1
- ✓ Pipeline trigger from dashboard (goal-based + custom stages) — v1.1
- ✓ Real-time pipeline progress via polling auto-refresh — v1.1

### Active

#### Current Milestone: v3.0 Production-Grade

**Goal:** Harden the AI Cofounder for daily reliable use — improve test infrastructure, deploy confidence, data scaling, and operational visibility.

**Requirements:** [v3.0-REQUIREMENTS.md](milestones/v3.0-REQUIREMENTS.md) — 24 requirements, 6 categories
**Roadmap:** [v3.0-ROADMAP.md](milestones/v3.0-ROADMAP.md) — 5 phases (18–22)

**Categories:**
- STAB (5) — Stabilization & tech debt (orchestrator refactor, type fixes, pagination, docs)
- INTEG (4) — Integration testing (E2E harness, goal lifecycle, approval flow, API contracts)
- DEPLOY (4) — Deploy pipeline (local CI, health checks, rollback, dry-run)
- OPS (4) — Operational hardening (pagination, queue health, budget validation, error reporting)
- DASH-Q (4) — Dashboard quality (test environments, hook coverage, accessibility)
- DOC (2) — Documentation (summaries, ADRs)

#### Shipped: v2.0 Autonomous Cofounder (2026-03-15)

43 requirements, 10 phases, 24 plans — all delivered. See [v2.0-REQUIREMENTS.md](milestones/v2.0-REQUIREMENTS.md).

### Out of Scope

- OAuth / SSO providers — JWT sufficient for single-user; defer to future milestone
- Horizontal scaling — message queue enables this but actual multi-instance is future work
- Circuit breaker pattern — existing exponential backoff and provider fallback is adequate
- Database read replicas — current load doesn't warrant this complexity
- WebSocket support — SSE streaming is working well for current needs
- Pipeline scheduling/recurring runs — deferred to future milestone
- Pipeline SSE streaming — polling sufficient; SSE requires new backend endpoint

## Context

- **Monorepo** (Turborepo): apps/agent-server, apps/discord-bot, apps/slack-bot, apps/dashboard, apps/voice-ui, packages/db, packages/llm, packages/sandbox, packages/api-client, packages/bot-handlers, packages/shared, packages/test-utils, packages/queue, packages/rag, packages/mcp-server
- **VPS**: Hetzner at 168.119.162.59, deployed via Docker Compose, CI auto-deploys on green tests
- **Test coverage**: ~960 tests across 65+ files (108 dashboard tests), all passing
- **Dashboard**: JWT-authenticated, pipeline management (list/detail/trigger), streaming chat, goals, workspace

## Constraints

- **Stack**: Turborepo + Fastify + Drizzle + PostgreSQL + BullMQ + Redis
- **Backwards compatible**: Bot commands and API endpoints must continue working
- **Single user**: Auth is single-user (Ian) for now — don't over-engineer multi-tenant

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| BullMQ over raw Redis pub/sub | Built-in retries, priorities, job dashboard | ✓ Good — reliable job processing |
| JWT over OAuth for v1 auth | Single user, fast to implement | ✓ Good — working well |
| Redis added as Docker Compose service | Self-contained infrastructure | ✓ Good — clean deploy |
| E2E tests use test database | Isolation from production data | ✓ Good — safe CI runs |
| Polling over SSE for pipeline progress | SSE deferred, polling simpler | ✓ Good — adequate for v1.1 |
| 3-phase structure for v1.1 (list → detail → trigger) | Natural delivery boundaries | ✓ Good — clean execution |
| formatDuration duplicated across routes | Avoids route-to-route circular deps | ✓ Good — pragmatic |

---
*Last updated: 2026-03-09 after v2.0 requirements and roadmap defined*
