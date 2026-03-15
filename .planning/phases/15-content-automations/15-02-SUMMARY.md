---
phase: 15-content-automations
plan: 02
subsystem: agent-server, db
tags: [pipeline-templates, n8n, journal, content-automations, routes, tdd]
dependency_graph:
  requires: [15-01]
  provides: [pipeline-template-routes, n8n-executions-route, PipelineExecutor-journal, youtube-shorts-seed]
  affects: [apps/agent-server, packages/test-utils]
tech_stack:
  added: []
  patterns: [FastifyPluginAsync, TDD, journal-integration, seed-on-startup]
key_files:
  created:
    - apps/agent-server/src/routes/pipeline-templates.ts
    - apps/agent-server/src/__tests__/pipeline-templates.test.ts
  modified:
    - apps/agent-server/src/routes/n8n.ts
    - apps/agent-server/src/plugins/jwt-guard.ts
    - apps/agent-server/src/services/pipeline.ts
    - apps/agent-server/src/plugins/queue.ts
    - apps/agent-server/src/__tests__/n8n-service.test.ts
    - packages/test-utils/src/mocks/db.ts
decisions:
  - clearAllMocks + explicit re-setup in beforeEach to handle mock isolation across tests that share getPipelineTemplateByName mock with queue seed logic
  - mockResolvedValue (not Once) for trigger-success test so setImmediate seed call does not exhaust mock
  - afterAll cleanup of REDIS_URL scoped to trigger describe block — avoids interfering with CRUD tests
metrics:
  duration: 7 min
  completed: "2026-03-15"
  tasks: 2/2
  files: 8
---

# Phase 15 Plan 02: Content Automations Backend Summary

**One-liner:** Pipeline template CRUD + trigger REST API, n8n execution history route, PipelineExecutor journal integration, YouTube Shorts template seeded on startup.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Pipeline template routes + n8n execution route + tests | bc6d6fd | pipeline-templates.ts, n8n.ts, jwt-guard.ts, pipeline-templates.test.ts, n8n-service.test.ts, test-utils/db.ts |
| 2 | PipelineExecutor journal + n8n integration, YouTube template seed | 30caaca | pipeline.ts, queue.ts, pipeline-templates.test.ts |

## What Was Built

### Pipeline Template Routes (pipeline-templates.ts)
- `GET /api/pipeline-templates` — lists active templates via `listPipelineTemplates(db, true)`
- `GET /api/pipeline-templates/:id` — gets single template by UUID, 404 if not found
- `POST /api/pipeline-templates` — creates template, returns 201
- `PATCH /api/pipeline-templates/:id` — partial update, 404 if not found
- `DELETE /api/pipeline-templates/:id` — hard delete, 404 if not found
- `POST /api/pipeline-templates/:name/trigger` — looks up by name (not UUID), validates isActive, checks REDIS_URL, calls `enqueuePipeline()`, returns 202 with `{ jobId, template }`

### N8n Execution History (n8n.ts)
- `GET /api/n8n/executions` — proxies to `app.n8nService.listExecutions()` with optional `workflowId`, `status`, `limit` query params, returns `{ data: N8nExecution[] }`

### Route Registration (jwt-guard.ts)
- Registered `pipelineTemplateRoutes` at `/api/pipeline-templates` inside the JWT-guarded scope

### PipelineExecutor Journal Integration (pipeline.ts)
- Added optional `journalService` (6th param) and `n8nService` (7th param) to constructor
- At pipeline completion: writes `content_pipeline` journal entry with title, summary, stage results, templateName
- At pipeline completion (when status === "completed" and context.n8nWorkflow set): dynamically imports `getN8nWorkflowByName`, looks up webhook URL, calls `n8nService.trigger()` fire-and-forget

### Queue Plugin Wiring (queue.ts)
- Pipeline processor now passes `app.journalService` and `app.n8nService` to `PipelineExecutor`
- `setImmediate` seed block on plugin startup:
  - Seeds `youtube-shorts` pipeline template (researcher + reviewer stages, defaultContext with n8nWorkflow key)
  - Registers `youtube-shorts-publish` n8n workflow record with placeholder webhook URL from `N8N_BASE_URL`

### Tests
- `pipeline-templates.test.ts` — 11 tests: GET list, GET by id (found/404), POST create, PATCH (updated/404), DELETE (deleted/404), trigger (202), trigger (404 unknown), trigger (404 inactive)
- `n8n-service.test.ts` extended — 3 new tests: listExecutions success, no API key returns empty array, network error returns empty array

### Test Utils
- Added pipelineTemplate mock functions to `mockDbModule()`: `createPipelineTemplate`, `getPipelineTemplate`, `getPipelineTemplateByName`, `listPipelineTemplates`, `updatePipelineTemplate`, `deletePipelineTemplate`, `pipelineTemplates: {}`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing createSubscriber and RedisPubSub in queue mock**
- **Found during:** Task 1 test run
- **Issue:** pipeline-templates tests set REDIS_URL which activates the pubsub plugin; pubsub.ts imports `createSubscriber` and `RedisPubSub` from `@ai-cofounder/queue` — both were missing from the queue mock
- **Fix:** Added `createSubscriber`, `RedisPubSub` (with `subscribe`, `publish`, `publishBroadcast`, `on`, `quit`, `close`, `getAgentMessageHistory`) to the `@ai-cofounder/queue` mock in the test file
- **Files modified:** pipeline-templates.test.ts
- **Commit:** bc6d6fd

**2. [Rule 1 - Bug] Mock isolation: queue seed setImmediate consumed mockResolvedValueOnce**
- **Found during:** Task 2 test run (trigger success test returned 404)
- **Issue:** The queue plugin's new seed logic called `getPipelineTemplateByName` in `setImmediate`, which consumed the `mockResolvedValueOnce(sampleTemplate)` before the route handler could use it
- **Fix:** Changed trigger-success test to use `mockResolvedValue(sampleTemplate)` (persistent mock) + added `clearAllMocks()` with explicit re-setup in `beforeEach`, scoped `REDIS_URL` env var to trigger `describe` block via `beforeAll`/`afterAll`
- **Files modified:** pipeline-templates.test.ts
- **Commit:** 30caaca

## Decisions Made

1. `clearAllMocks()` + explicit re-setup in `beforeEach` rather than `resetAllMocks()` — `resetAllMocks` was too aggressive, clearing implementations on top-level vi.fn() declarations that the module factories proxy through
2. `mockResolvedValue` (not `Once`) for the trigger-success test to handle both the seed call and the route call returning `sampleTemplate`
3. `afterAll` cleanup of `REDIS_URL` scoped to the trigger `describe` block — CRUD tests don't need Redis active

## Self-Check: PASSED

- FOUND: apps/agent-server/src/routes/pipeline-templates.ts
- FOUND: apps/agent-server/src/__tests__/pipeline-templates.test.ts
- FOUND: apps/agent-server/src/routes/n8n.ts (extended)
- FOUND: apps/agent-server/src/plugins/jwt-guard.ts (pipelineTemplateRoutes registered)
- FOUND: apps/agent-server/src/services/pipeline.ts (journalService + n8nService)
- FOUND: apps/agent-server/src/plugins/queue.ts (youtube-shorts seed)
- FOUND: commit bc6d6fd (Task 1)
- FOUND: commit 30caaca (Task 2)
- 11/11 pipeline-templates tests pass
- 7/7 n8n-service tests pass
- TypeScript build: PASSED
