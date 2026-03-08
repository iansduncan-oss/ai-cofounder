---
phase: 01-queue-foundation
plan: 03
subsystem: api
tags: [bullmq, redis, fastify, queue, health-check, job-status]

# Dependency graph
requires:
  - phase: 01-queue-foundation/01-01
    provides: Queue package with BullMQ config, getAgentTaskQueue()
  - phase: 01-queue-foundation/01-02
    provides: queueJobId stored in goal.metadata via updateGoalMetadata()
provides:
  - "GET /api/goals/:id/queue-status endpoint querying BullMQ job state"
  - "getJobStatus() helper in packages/queue/src/helpers.ts"
  - "pingRedis() TCP probe helper in packages/queue/src/helpers.ts"
  - "GET /health with database + redis status fields"
affects: [dashboard, api-client, phase-02]

# Tech tracking
tech-stack:
  added: ["Node.js net module for Redis TCP ping (no extra deps)"]
  patterns:
    - "Job status lookup: Job.fromId() + job.getState() via getJobStatus() helper"
    - "Redis health: TCP connect probe using Node net module (avoids ioredis import in queue package)"
    - "Graceful Redis optional: REDIS_URL not set -> redis=disabled -> health=ok"
    - "Degraded health: either DB or Redis unreachable -> 503 + status=degraded"

key-files:
  created:
    - "packages/queue/src/helpers.ts (getJobStatus, pingRedis)"
    - "apps/agent-server/src/__tests__/queue-status.test.ts (7 tests, QUEUE-06)"
    - "apps/agent-server/src/__tests__/health-redis.test.ts (5 tests, QUEUE-08)"
  modified:
    - "packages/queue/src/index.ts (exports getJobStatus, pingRedis, JobStatusResult)"
    - "apps/agent-server/src/routes/goals.ts (added GET /:id/queue-status)"
    - "apps/agent-server/src/routes/health.ts (added Redis check, database/redis response fields)"

key-decisions:
  - "pingRedis() uses Node net.connect TCP probe instead of ioredis direct import: avoids TS module resolution issue (ioredis bundled inside bullmq's own node_modules, not resolvable from queue package)"
  - "pingRedis reads REDIS_URL from process.env directly (not getRedisConnection()) to avoid singleton cache issues in health check context"
  - "Redis health is optional: disabled when REDIS_URL not set, not a failure condition — supports local dev without Redis"
  - "Health response shape changed: now includes database and redis fields alongside status/timestamp/uptime"

patterns-established:
  - "Queue helper pattern: keep BullMQ-specific operations (Job.fromId, getState) in packages/queue, never in route handlers"
  - "Health degraded pattern: 503 status code + status=degraded when any required dependency is unreachable"

requirements-completed: [QUEUE-06, QUEUE-08]

# Metrics
duration: 6min
completed: 2026-03-08
---

# Phase 1 Plan 3: Queue Status Endpoint + Redis Health Summary

**GET /api/goals/:id/queue-status reads queueJobId from goal.metadata to query BullMQ state (waiting/active/completed/failed), and GET /health now includes Redis TCP connectivity status alongside DB health**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-08T05:27:12Z
- **Completed:** 2026-03-08T05:33:38Z
- **Tasks:** 2 completed
- **Files modified:** 6

## Accomplishments
- GET /api/goals/:id/queue-status returns BullMQ job state (active, completed, failed, waiting, delayed) from goal.metadata.queueJobId, with not_queued and not_found edge cases handled
- GET /health now returns { status, database, redis, timestamp, uptime } — Redis check skipped when REDIS_URL unset (disabled, not a failure)
- getJobStatus() and pingRedis() helpers encapsulated in packages/queue — route handlers never import BullMQ or ioredis directly
- 12 new tests across 2 test files covering all 6 QUEUE-06 job states and 5 QUEUE-08 health scenarios, all passing with zero regressions across 558 total tests

## Task Commits

Each task was committed atomically:

1. **Task 1: getJobStatus helper + GET /api/goals/:id/queue-status + tests** - `047d9e7` (feat)
2. **Task 2: pingRedis helper + Redis health check + tests** - `5e4d83c` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/queue/src/helpers.ts` - Added getJobStatus() using Job.fromId + getState, added pingRedis() using TCP net.connect
- `packages/queue/src/index.ts` - Exported getJobStatus, pingRedis, JobStatusResult
- `apps/agent-server/src/routes/goals.ts` - Added GET /:id/queue-status route reading queueJobId from goal.metadata
- `apps/agent-server/src/routes/health.ts` - Updated GET /health to include database + redis fields with pingRedis check
- `apps/agent-server/src/__tests__/queue-status.test.ts` - 7 tests covering job states: active, not_queued, not_found, 404, completed (finishedOn), failed (failedReason)
- `apps/agent-server/src/__tests__/health-redis.test.ts` - 5 tests covering: redis=ok, redis=unreachable (503), redis=disabled, database=unreachable, both fields present

## Decisions Made
- Used Node.js net.connect TCP probe for pingRedis() instead of ioredis: ioredis is bundled inside bullmq's own node_modules (not accessible from queue package's TypeScript), and using net avoids needing any extra dependency
- pingRedis reads REDIS_URL from process.env directly rather than getRedisConnection() to avoid singleton cache state affecting health check behavior
- Redis marked "disabled" (not a failure) when REDIS_URL not configured — preserves zero-config local development

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Switched from ioredis import to Node net.connect for pingRedis()**
- **Found during:** Task 2 (pingRedis implementation)
- **Issue:** Plan specified `import Redis from "ioredis"` but ioredis is nested inside `node_modules/bullmq/node_modules/ioredis/` — TypeScript module resolution cannot find it from the queue package, causing build error TS2307
- **Fix:** Implemented pingRedis() using Node.js built-in `net.connect` with a 3s timeout — functionally equivalent for a health TCP probe, no extra dependency needed
- **Files modified:** packages/queue/src/helpers.ts
- **Verification:** `npm run build -w @ai-cofounder/queue` succeeds, all 5 health-redis tests pass
- **Committed in:** 5e4d83c (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking build error)
**Impact on plan:** Auto-fix produced a simpler, more reliable solution than the original approach. No scope creep.

## Issues Encountered
None beyond the ioredis module resolution issue (handled above).

## Next Phase Readiness
- Phase 1 complete: queue package built, worker running, execute endpoint non-blocking, job status queryable, Redis health observable
- Queue infrastructure ready for Phase 2: SSE streaming bridge via Redis pub/sub
- All Phase 1 requirements satisfied: QUEUE-01 through QUEUE-09

## Self-Check: PASSED

- FOUND: packages/queue/src/helpers.ts
- FOUND: packages/queue/src/index.ts
- FOUND: apps/agent-server/src/routes/goals.ts
- FOUND: apps/agent-server/src/routes/health.ts
- FOUND: apps/agent-server/src/__tests__/queue-status.test.ts
- FOUND: apps/agent-server/src/__tests__/health-redis.test.ts
- FOUND: commit 047d9e7 (Task 1)
- FOUND: commit 5e4d83c (Task 2)

---
*Phase: 01-queue-foundation*
*Completed: 2026-03-08*
