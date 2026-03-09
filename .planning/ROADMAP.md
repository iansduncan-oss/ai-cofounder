# Roadmap: AI Cofounder

## Milestones

- ✅ **v1.0 Infrastructure & Reliability** - Phases 1-4 (complete 2026-03-09)
- 🚧 **v1.1 Pipeline Dashboard UI** - Phases 5-7 (in progress)

## Phases

<details>
<summary>✅ v1.0 Infrastructure & Reliability (Phases 1-4) — COMPLETE 2026-03-09</summary>

- [x] **Phase 1: Queue Foundation** - Redis container, BullMQ module, worker process, job lifecycle management (completed 2026-03-08)
- [x] **Phase 2: SSE Migration** - Move agent execution to workers with real-time streaming via Redis pub/sub (completed 2026-03-08)
- [x] **Phase 3: Authentication** - JWT login, refresh tokens, protected routes, bot endpoint isolation (completed 2026-03-08)
- [x] **Phase 4: Tests & Quick Wins** - E2E test suite, workspace delete tools, API docs, export endpoint (completed 2026-03-09)

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
- [x] 02-01-PLAN.md — RedisPubSub class in packages/queue + worker event publishing via onProgress callback
- [x] 02-02-PLAN.md — Fastify pubsub plugin + SSE endpoint rewrite with Redis subscribe and history replay

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
- [x] 03-01-PLAN.md — Auth foundation: admin_users DB table, @fastify/jwt + @fastify/cookie plugin, login/refresh/logout routes, admin seed, auth tests
- [x] 03-02-PLAN.md — Route protection via JWT guard plugin, server route restructuring, dashboard login UI + in-memory token management + silent refresh

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
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — E2E goal lifecycle test with real DB isolation, truncation, Fastify inject, and MockLlmRegistry scripted responses
- [x] 04-02-PLAN.md — Quick win tests: deleteFile/deleteDirectory workspace tests + route tests for roles, export, and Swagger endpoints

</details>

### v1.1 Pipeline Dashboard UI (In Progress)

**Milestone Goal:** Users can visualize, monitor, and trigger multi-stage agent pipelines from the dashboard with real-time progress feedback.

- [x] **Phase 5: Pipeline List + Navigation** - Sidebar nav entry, list page with filtering and auto-refresh, click-through to detail (completed 2026-03-09)
- [x] **Phase 6: Pipeline Detail** - Per-stage status, expandable outputs, timing, metadata, auto-refresh on active runs (completed 2026-03-09)
- [ ] **Phase 7: Pipeline Trigger** - Goal-based and custom-stage submission forms with confirmation and redirect

## Phase Details

### Phase 5: Pipeline List + Navigation
**Goal**: Users can reach the pipelines section from the sidebar and see all pipeline runs with status, filtering, and auto-refresh
**Depends on**: Phase 4
**Requirements**: NAV-01, NAV-02, LIST-01, LIST-02, LIST-03, LIST-04
**Success Criteria** (what must be TRUE):
  1. User can click "Pipelines" in the dashboard sidebar and arrive at the pipeline list page
  2. User can see all pipeline runs with their state, stage count, and timing displayed on the list page
  3. User can filter the list to show only runs in a selected state (waiting, active, completed, failed)
  4. User can see the list auto-refresh every 10 seconds without any manual action
  5. User can click a pipeline row to navigate to its detail view, with the URL updating to /pipelines/:jobId
**Plans**: 1 plan

Plans:
- [x] 05-01-PLAN.md — Rewrite pipeline list page with state filter, timing, clickable rows + detail route stub + tests

### Phase 6: Pipeline Detail
**Goal**: Users can inspect a specific pipeline run's per-stage progress, outputs, timing, and overall metadata
**Depends on**: Phase 5
**Requirements**: DETAIL-01, DETAIL-02, DETAIL-03, DETAIL-04, DETAIL-05
**Success Criteria** (what must be TRUE):
  1. User can see each stage listed with a status indicator (pending, active, completed, failed, skipped)
  2. User can expand a stage to read its output text and any error details
  3. User can see the overall pipeline duration for completed pipelines displayed in the metadata card
  4. User can see the pipeline's overall state, linked goal reference, and created/finished timestamps
  5. User can see an active pipeline's detail page auto-refresh every 5 seconds
**Plans**: 2 plans

Plans:
- [x] 06-01-PLAN.md — Full pipeline detail page with metadata card, expandable stage rows, and tests
- [ ] 06-02-PLAN.md — Gap closure: align ROADMAP SC3 and REQUIREMENTS DETAIL-03 with implemented overall pipeline duration

### Phase 7: Pipeline Trigger
**Goal**: Users can submit new pipeline runs — goal-based or custom-stage — and be taken directly to the resulting run
**Depends on**: Phase 5
**Requirements**: TRIGGER-01, TRIGGER-02, TRIGGER-03, TRIGGER-04
**Success Criteria** (what must be TRUE):
  1. User can enter a goal description and submit a 3-stage pipeline (planner → coder → reviewer) with one action
  2. User can build a custom pipeline by configuring each stage's agent role, prompt, and dependency flag before submitting
  3. User sees a confirmation message showing the newly created job ID after successful submission
  4. User is automatically redirected to the pipeline detail view for the new run immediately after submission
**Plans**: TBD

## Progress

**Execution Order:** 5 → 6 → 7

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Queue Foundation | v1.0 | 3/3 | Complete | 2026-03-08 |
| 2. SSE Migration | v1.0 | 2/2 | Complete | 2026-03-08 |
| 3. Authentication | v1.0 | 2/2 | Complete | 2026-03-08 |
| 4. Tests & Quick Wins | v1.0 | 2/2 | Complete | 2026-03-09 |
| 5. Pipeline List + Navigation | v1.1 | 1/1 | Complete | 2026-03-09 |
| 6. Pipeline Detail | v1.1 | 2/2 | Complete | 2026-03-09 |
| 7. Pipeline Trigger | v1.1 | 0/TBD | Not started | - |

---
*v1.0 roadmap created: 2026-03-07*
*v1.1 roadmap created: 2026-03-09*
