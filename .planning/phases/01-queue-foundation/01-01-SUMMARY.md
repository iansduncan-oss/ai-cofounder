---
phase: 01-queue-foundation
plan: 01
subsystem: infra
tags: [bullmq, redis, docker-compose, queue, workers]

# Dependency graph
requires: []
provides:
  - BullMQ agent-tasks worker configured for 10-minute long-running jobs (lockDuration=600000)
  - Age-based TTL cleanup for completed (24h) and failed (7d) jobs
  - Redis service in production Docker Compose with AOF persistence
  - Worker service in production Docker Compose using same agent-server image
  - Test coverage for all queue configuration values (QUEUE-05, QUEUE-09, QUEUE-12, QUEUE-13)
affects: [02-queue-foundation, 03-dashboard-auth, 04-e2e]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "BullMQ workers for long jobs use lockDuration > job duration (600s > 300s typical)"
    - "Queue cleanup uses age-based TTL not count-only to retain failed jobs for debugging"
    - "Worker service shares agent-server image with different CMD entrypoint"
    - "Redis only accessible within Docker network in prod (no port exposure)"

key-files:
  created:
    - packages/queue/src/__tests__/queue-config.test.ts
  modified:
    - packages/queue/src/workers.ts
    - packages/queue/src/queues.ts
    - docker-compose.prod.yml

key-decisions:
  - "lockDuration=600000 (10 min): agent tasks take 5-10 min, must exceed job duration to prevent false stall"
  - "Removed rate limiter from agent-tasks worker: conflicts with lockDuration stall detection model"
  - "age-based TTL over count-only: ensures failed jobs visible for 7 days regardless of volume"
  - "Worker as separate container with stop_grace_period=120s: allows in-flight job completion on deploy"
  - "Redis no exposed ports in prod: only accessible via Docker network avion_avion_net"

patterns-established:
  - "Queue config tests: mock bullmq Worker/Queue as classes, use closeAllQueues() in beforeEach to reset queue Map cache"

requirements-completed: [QUEUE-01, QUEUE-05, QUEUE-09, QUEUE-12, QUEUE-13]

# Metrics
duration: 4min
completed: 2026-03-08
---

# Phase 1 Plan 1: Queue Foundation — Worker Configuration Summary

**BullMQ agent-tasks worker hardened for 10-minute jobs with lockDuration=600000, TTL-based cleanup, and Redis+worker services added to production Docker Compose**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-08T05:15:26Z
- **Completed:** 2026-03-08T05:19:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Fixed agent-tasks worker lockDuration from default (30s) to 600000ms (10 min) — prevents false stall detection on 5-10 min LLM jobs
- Updated defaultJobOptions to age-based TTL cleanup (24h completed, 7d failed) replacing count-only approach
- Added Redis service to production Docker Compose with AOF persistence, health checks, and no exposed ports
- Added worker service to production Docker Compose using same agent-server image with 120s grace period for graceful shutdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Wave 0 test scaffolds for queue configuration + fix queue defaults** - `0af3337` (feat)
2. **Task 2: Add Redis + worker service to production Docker Compose** - `aaa583e` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `packages/queue/src/__tests__/queue-config.test.ts` - 10 tests covering QUEUE-05, QUEUE-09, QUEUE-12, QUEUE-13 (lockDuration, concurrency, stalledInterval, maxStalledCount, retry, TTL, priority mapping)
- `packages/queue/src/workers.ts` - agent-tasks Worker updated: lockDuration=600000, concurrency=1, stalledInterval=30000, maxStalledCount=1; removed limiter
- `packages/queue/src/queues.ts` - defaultJobOptions updated: removeOnComplete.age=86400, removeOnFail.age=604800 (replacing count-only)
- `docker-compose.prod.yml` - Added redis service (healthcheck, AOF, internal network only), worker service (120s grace), REDIS_URL on agent-server, redis depends_on, redisdata volume

## Decisions Made
- **Removed rate limiter from agent-tasks worker**: The `limiter: { max: 5, duration: 60_000 }` conflicts with the lockDuration stall detection model — rate limiters re-release locks which can cause stall false positives on long jobs.
- **Worker shares agent-server image**: Avoids maintaining a separate Dockerfile; worker.js entrypoint has narrower set of initializations (no HTTP server, just queue workers).
- **Redis no port mapping in prod**: Security — Redis should not be reachable from host or external network in production.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
- Initial test mock design used `vi.fn().mockImplementation()` for BullMQ classes — this doesn't work as constructor since `vi.fn()` isn't a class. Fixed by writing actual `class MockWorker` / `class MockQueue` inside the `vi.mock()` factory. The `queues` Map caches Queue instances — added `closeAllQueues()` in `beforeEach` to reset the cache so each Queue-constructor-inspection test gets a fresh call.

## User Setup Required
None — no external service configuration required. Redis is defined in Docker Compose; REDIS_URL is automatically set in both agent-server and worker containers.

## Next Phase Readiness
- Queue configuration is production-ready for long-running agent tasks
- Worker container defined and ready to deploy alongside agent-server
- Redis service defined with proper persistence and network isolation
- All configuration values covered by automated tests (regression protection)
- Ready for Plan 2: job migration from in-process to queue-based execution

## Self-Check: PASSED

All created files verified present. All task commits verified in git log.

---
*Phase: 01-queue-foundation*
*Completed: 2026-03-08*
