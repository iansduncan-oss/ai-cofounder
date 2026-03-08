---
phase: 01-queue-foundation
plan: 02
subsystem: agent-server/execution
tags: [queue, worker, bullmq, non-blocking, sigterm, graceful-shutdown]
dependency-graph:
  requires: [01-01-PLAN.md]
  provides: [standalone-worker-process, non-blocking-execution-route]
  affects: [apps/agent-server, packages/queue]
tech-stack:
  added: []
  patterns: [standalone-worker-entry-point, graceful-drain-on-sigterm, queue-backed-http-202]
key-files:
  created:
    - apps/agent-server/src/worker.ts
    - apps/agent-server/src/__tests__/worker.test.ts
    - apps/agent-server/src/__tests__/execution-queue.test.ts
  modified:
    - apps/agent-server/src/routes/execution.ts
    - apps/agent-server/src/plugins/queue.ts
    - apps/agent-server/src/__tests__/routes.test.ts
    - apps/agent-server/src/__tests__/e2e-execution.test.ts
decisions:
  - "Worker process is a standalone Node.js entry point (not Fastify) — bootstraps same services but no HTTP"
  - "Worker registers ONLY agentTask processor — monitoring/notification/briefing/pipeline stay in HTTP server"
  - "SSE streaming endpoint kept as-is for Phase 1 — Phase 2 will bridge via Redis pub/sub"
  - "updateGoalMetadata() used to store queueJobId in goal.metadata for later status lookup"
metrics:
  duration: "8 minutes"
  completed: "2026-03-08"
  tasks-completed: 2
  files-created: 3
  files-modified: 4
  tests-added: 15
requirements-satisfied: [QUEUE-02, QUEUE-03, QUEUE-04, QUEUE-07]
---

# Phase 1 Plan 02: Worker Process and Non-Blocking Execution — Summary

**One-liner:** Standalone BullMQ worker bootstraps all services and processes agent-task jobs; HTTP execution route returns 202 immediately with jobId via enqueueAgentTask().

## What Was Built

### Task 1: Standalone Worker Entry Point (`worker.ts`)

Created `apps/agent-server/src/worker.ts` as a standalone Node.js process (same Docker image, different CMD):

- Bootstraps all required services: DB (with migrations), LlmRegistry, EmbeddingService, SandboxService, WorkspaceService, NotificationService, VerificationService, TaskDispatcher
- Registers ONLY the `agentTask` processor via `startWorkers()` — monitoring/notification/briefing/pipeline processors stay in the HTTP server
- Handles SIGTERM/SIGINT with graceful drain: `stopWorkers()` then `closeAllQueues()` then `process.exit(0)`
- Re-throws processor errors so BullMQ handles retry logic
- Exports `main()` function for testability

### Task 2: Non-Blocking Execution Route + Queue Plugin Update

Converted `POST /api/goals/:id/execute` from blocking to non-blocking:

- Now calls `enqueueAgentTask({ goalId, prompt, userId, priority })` from `@ai-cofounder/queue`
- Returns `{ jobId, status: "queued", goalId }` with HTTP 202 immediately
- Stores `queueJobId` (and optional `webhookUrl`) in `goal.metadata` via `updateGoalMetadata()` for later status lookup
- Supports `priority` field (`critical | high | normal | low`) passed through to BullMQ
- SSE streaming endpoint (`GET /:id/execute/stream`) kept as-is — will be upgraded in Phase 2
- Queue plugin updated with explicit comment: agentTask is intentionally NOT registered in the HTTP server

## Test Coverage

- `worker.test.ts`: 7 tests — processor registration (QUEUE-03), runGoal delegation, error re-throw, SIGTERM handler registration, graceful shutdown sequence (QUEUE-07), Redis/DB bootstrap, service instantiation
- `execution-queue.test.ts`: 8 tests — 202 response (QUEUE-02), enqueueAgentTask call args, queueJobId in metadata, webhookUrl in metadata, 404 when goal not found, priority passthrough (QUEUE-09)
- `routes.test.ts` and `e2e-execution.test.ts`: Updated to reflect 202 non-blocking behavior

**All 546 agent-server tests pass after changes.**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing mock] routes.test.ts missing @ai-cofounder/queue mock**
- **Found during:** Task 2 verification
- **Issue:** routes.test.ts and e2e-execution.test.ts had no `@ai-cofounder/queue` mock; `enqueueAgentTask` would fail/hang
- **Fix:** Added `vi.mock("@ai-cofounder/queue", ...)` to both test files; also added `updateGoalMetadata` to db mocks
- **Files modified:** `routes.test.ts`, `e2e-execution.test.ts`

**2. [Rule 1 - Behavior change] routes.test.ts/e2e-execution.test.ts expected old blocking 200 response**
- **Found during:** Task 2 verification
- **Issue:** Existing tests expected `res.statusCode === 200` with full task results (old behavior)
- **Fix:** Updated tests to expect 202 with `{ jobId, status: "queued" }` — accurately reflects new non-blocking contract

**3. [Rule 1 - Bug] worker.test.ts: module-level main() call caused double invocation**
- **Found during:** Task 1 testing
- **Issue:** `worker.ts` calls `main()` at module scope; dynamic import caused double-execution
- **Fix:** Exported `main()` as named export; tests call `main()` directly with `vi.clearAllMocks()` before each test

## Self-Check: PASSED

- `apps/agent-server/src/worker.ts` — FOUND
- `apps/agent-server/src/__tests__/worker.test.ts` — FOUND
- `apps/agent-server/src/__tests__/execution-queue.test.ts` — FOUND
- `apps/agent-server/src/routes/execution.ts` — FOUND (modified)
- Commit `9f200b8` (Task 1: worker.ts) — FOUND
- Commit `254a4de` (Task 2: execution route) — FOUND
- All 546 agent-server tests pass
