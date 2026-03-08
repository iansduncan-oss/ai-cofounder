---
phase: 02-sse-migration
plan: 01
subsystem: queue
tags: [redis, pubsub, worker, events, real-time]
requirements: [QUEUE-10]

dependency_graph:
  requires: []
  provides:
    - RedisPubSub class (packages/queue)
    - AgentEvent types (AgentProgressEvent, AgentLifecycleEvent, AgentEvent)
    - Worker publishes lifecycle + progress events to Redis pub/sub
  affects:
    - apps/agent-server/src/worker.ts (pub/sub event publishing wired)
    - packages/queue/src/index.ts (new exports added)

tech_stack:
  added:
    - ioredis@5.9.3 (direct dependency in packages/queue)
  patterns:
    - Redis pub/sub with dedicated publisher + subscriber connections
    - Redis LIST for event history with 1-hour TTL for late-joining SSE clients
    - onProgress callback pattern threads through dispatcher → worker → pubsub

key_files:
  created:
    - packages/queue/src/pubsub.ts
    - packages/queue/src/__tests__/pubsub.test.ts
  modified:
    - packages/queue/src/index.ts
    - packages/queue/package.json
    - apps/agent-server/src/worker.ts
    - apps/agent-server/src/__tests__/worker.test.ts

decisions:
  - "class syntax in vi.mock() factory required for constructable mocks — vi.fn().mockImplementation() does not create constructors in Vitest"
  - "RedisPubSub uses separate ioredis connection from BullMQ — Redis protocol requires dedicated connections for subscribe mode"
  - "HISTORY_TTL_SECONDS=3600 — 1-hour window sufficient for SSE late joiners; lifecycle event marks job boundaries"
  - "Promise.all for publish+rpush+expire — all three are non-atomic but concurrent for performance"

metrics:
  duration: "~12 minutes"
  completed_date: "2026-03-08"
  tasks: 2
  files: 6
---

# Phase 02 Plan 01: Redis Pub/Sub Infrastructure and Worker Event Publishing Summary

**One-liner:** ioredis-based RedisPubSub class with PUBLISH+RPUSH+EXPIRE pattern, wired into worker via dispatcher's onProgress callback for real-time agent progress events.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| 1 | RedisPubSub class + tests in packages/queue | c9d16e8 | Complete |
| 2 | Wire worker.ts to publish events via RedisPubSub | 7cce0de | Complete |

## What Was Built

### Task 1: RedisPubSub class (packages/queue/src/pubsub.ts)

Created the Redis pub/sub infrastructure module:

**Types exported:**
- `AgentProgressEvent` — task-level event (goalId, goalTitle, taskId, taskTitle, agent, status, completedTasks, totalTasks, output?, timestamp)
- `AgentLifecycleEvent` — job-level event (goalId, type: "job_started" | "job_completed" | "job_failed", timestamp, error?)
- `AgentEvent` — union of both

**Constants:** `CHANNEL_PREFIX`, `HISTORY_PREFIX`, `HISTORY_TTL_SECONDS=3600`

**Helper functions:** `goalChannel(goalId)` → "agent-events:goal:{goalId}", `historyKey(goalId)` → "agent-events:history:{goalId}"

**RedisPubSub class:**
- Constructor takes `ConnectionOptions` (BullMQ-compatible), creates one ioredis publisher instance
- `publish(goalId, event)` — concurrent PUBLISH + RPUSH + EXPIRE via `Promise.all`
- `getHistory(goalId)` — reads from LRANGE and parses JSON events
- `close()` — calls `publisher.quit()`

**createSubscriber(connectionOptions)** — factory for dedicated subscriber connections (separate from publisher as required by Redis protocol)

**Tests:** 14 passing tests covering all methods and helper functions.

### Task 2: Worker event publishing (apps/agent-server/src/worker.ts)

Wired worker to publish 3 event types during goal execution:

1. `job_started` — published immediately before `dispatcher.runGoal()` is called
2. Task progress events — published via `onProgress` callback passed to `dispatcher.runGoal()`, which the dispatcher calls on each task start/complete/fail
3. `job_completed` — published after successful `dispatcher.runGoal()` return
4. `job_failed` — published in catch block (before re-throw) with error message

`redisPubSub.close()` added to graceful shutdown handler after `closeAllQueues()`.

**Tests:** 6 new passing tests + 7 existing tests (all 13 pass), including invocation order assertions.

## Verification

```
@ai-cofounder/queue: 24 tests passed (2 test files)
@ai-cofounder/agent-server: 13 worker tests passed (7 original + 6 new)
packages/queue builds cleanly with ioredis@5.9.3 types
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vitest mock constructors require class syntax, not vi.fn().mockImplementation()**
- **Found during:** Task 1 (pubsub.test.ts) and Task 2 (worker.test.ts)
- **Issue:** The plan suggested `vi.fn().mockImplementation(() => ({...}))` for mocking `ioredis` and `RedisPubSub` constructors, but Vitest throws "is not a constructor" when `new` is called on a plain function implementation
- **Fix:** Used `class MockRedis { ... constructor() { mockInstances.push(this) } }` in the ioredis mock and `class { publish = ...; close = ...; }` in the queue mock — standard ES6 class syntax that Vitest can construct with `new`
- **Files modified:** `packages/queue/src/__tests__/pubsub.test.ts`, `apps/agent-server/src/__tests__/worker.test.ts`
- **Commits:** c9d16e8, 7cce0de

**2. [Rule 1 - Bug] Existing worker test expected runGoal() called with 2 args**
- **Found during:** Task 2 test run
- **Issue:** Existing test `"calls dispatcher.runGoal with goalId and userId from job data"` asserted `expect(mockRunGoal).toHaveBeenCalledWith("g-1", "u-1")` — this fails after adding the 3rd `onProgress` callback argument
- **Fix:** Updated assertion to `expect(mockRunGoal).toHaveBeenCalledWith("g-1", "u-1", expect.any(Function))`
- **Files modified:** `apps/agent-server/src/__tests__/worker.test.ts`
- **Commit:** 7cce0de

## Self-Check: PASSED

- FOUND: packages/queue/src/pubsub.ts
- FOUND: packages/queue/src/__tests__/pubsub.test.ts
- FOUND: apps/agent-server/src/worker.ts
- FOUND: apps/agent-server/src/__tests__/worker.test.ts
- FOUND commit: c9d16e8 (Task 1)
- FOUND commit: 7cce0de (Task 2)
