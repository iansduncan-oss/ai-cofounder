# Roadmap: AI Cofounder — Infrastructure & Reliability

## Overview

This milestone decouples long-running agent work from HTTP request handlers via Redis + BullMQ, secures the dashboard with JWT authentication, and closes the gap on zero E2E integration tests. Work is split into four phases: queue foundation (Redis, BullMQ, worker process), the hardest integration (SSE streaming over Redis pub/sub), JWT authentication, and a cleanup phase covering E2E tests and quick-win features.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Queue Foundation** - Redis container, BullMQ module, worker process, job lifecycle management (completed 2026-03-08)
- [ ] **Phase 2: SSE Migration** - Move agent execution to workers with real-time streaming via Redis pub/sub
- [ ] **Phase 3: Authentication** - JWT login, refresh tokens, protected routes, bot endpoint isolation
- [ ] **Phase 4: Tests & Quick Wins** - E2E test suite, workspace delete tools, API docs, export endpoint

## Phase Details

### Phase 1: Queue Foundation
**Goal**: Agent tasks can be enqueued and processed by a separate worker process with full job lifecycle management
**Depends on**: Nothing (first phase)
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, QUEUE-05, QUEUE-06, QUEUE-07, QUEUE-08, QUEUE-09, QUEUE-12, QUEUE-13
**Success Criteria** (what must be TRUE):
  1. Redis container starts with the rest of the stack via `docker compose up` in both dev and production
  2. A goal submitted via the API enqueues a BullMQ job and returns immediately (non-blocking HTTP response)
  3. The worker process picks up the job, executes it via the orchestrator, and records completion status
  4. A failed job retries automatically with exponential backoff; GET /api/goals/:id/queue-status shows waiting/active/completed/failed
  5. GET /health includes Redis connection status; sending SIGTERM to the worker lets the active job finish before exit
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md — Queue config hardening (lockDuration, TTL cleanup) + Redis in production Docker Compose
- [x] 01-02-PLAN.md — Worker entry point + non-blocking execution route
- [x] 01-03-PLAN.md — Job status API endpoint + Redis health monitoring

### Phase 2: SSE Migration
**Goal**: Dashboard clients receive real-time agent execution events after execution moves to the background worker
**Depends on**: Phase 1
**Requirements**: QUEUE-10, QUEUE-11
**Success Criteria** (what must be TRUE):
  1. While a goal executes in the worker, the dashboard SSE stream receives tool-execution and progress events in real time
  2. Opening the SSE endpoint for a job that is already in progress replays missed events from the Redis pub/sub channel
  3. The existing bot commands (Discord/Slack) and dashboard streaming behavior are unchanged from the user's perspective
**Plans**: 2 plans

Plans:
- [ ] 02-01-PLAN.md — RedisPubSub class in packages/queue + worker event publishing via onProgress callback
- [ ] 02-02-PLAN.md — Fastify pubsub plugin + SSE endpoint rewrite with Redis subscribe and history replay

### Phase 3: Authentication
**Goal**: The dashboard is secured behind JWT login; bot endpoints continue working without disruption
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTH-10
**Success Criteria** (what must be TRUE):
  1. Visiting the dashboard without a valid token redirects to a login page; submitting correct credentials grants access
  2. Access token expires after 15 minutes; the dashboard silently refreshes it using the HttpOnly refresh cookie without logging the user out
  3. Logging out clears the refresh cookie and immediately invalidates access to protected routes
  4. All Discord and Slack bot commands continue working without any changes after JWT middleware is applied
  5. The admin account is auto-created on first server startup from ADMIN_EMAIL + ADMIN_PASSWORD env vars
**Plans**: 2 plans

Plans:
- [ ] 03-01-PLAN.md — Auth foundation: admin_users DB table, @fastify/jwt + @fastify/cookie plugin, login/refresh/logout routes, admin seed, auth tests
- [ ] 03-02-PLAN.md — Route protection via JWT guard plugin, server route restructuring, dashboard login UI + in-memory token management + silent refresh

### Phase 4: Tests & Quick Wins
**Goal**: The goal lifecycle is covered by E2E integration tests and the API surface is complete with utility features
**Depends on**: Phase 2, Phase 3
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, QWIN-01, QWIN-02, QWIN-03, QWIN-04, QWIN-05, QWIN-06
**Success Criteria** (what must be TRUE):
  1. Running `npm test` includes an E2E suite that executes a full goal lifecycle (create → dispatch → orchestrator tool loop → completion) against an isolated test database with mocked LLM responses
  2. The E2E suite runs in GitHub Actions CI alongside existing unit tests without requiring external services
  3. The orchestrator can delete a file or directory within the workspace; path traversal attempts are rejected
  4. GET /api/conversations/:id/export returns the full conversation as downloadable JSON
  5. Swagger UI is accessible at a configurable URL and reflects all current API routes
**Plans**: TBD

Plans:
- [ ] 04-01: E2E test infrastructure (test database isolation, Fastify inject harness, CI integration)
- [ ] 04-02: E2E test suite (goal lifecycle test, MockLlmRegistry integration)
- [ ] 04-03: Quick wins (deleteFile, deleteDirectory, GET /api/agents/roles, export endpoint, OpenAPI + Swagger UI)

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Queue Foundation | 3/3 | Complete   | 2026-03-08 |
| 2. SSE Migration | 0/2 | Not started | - |
| 3. Authentication | 1/2 | In Progress|  |
| 4. Tests & Quick Wins | 0/3 | Not started | - |

---
*Roadmap created: 2026-03-07*
*Phase 1 planned: 2026-03-07*
*Phase 2 planned: 2026-03-08*
*Phase 3 planned: 2026-03-08*
