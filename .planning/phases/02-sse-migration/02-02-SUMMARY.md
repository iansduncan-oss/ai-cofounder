---
phase: 02-sse-migration
plan: 02
subsystem: api
tags: [redis, pubsub, sse, fastify, events, real-time, streaming]

dependency_graph:
  requires:
    - phase: 02-sse-migration-plan-01
      provides: RedisPubSub class, createSubscriber factory, goalChannel/historyKey helpers, AgentEvent types
  provides:
    - Fastify pubsubPlugin with shared EventEmitter + Redis subscriber, reference-counted subscribeGoal/unsubscribeGoal, redisPubSub decorator
    - SSE endpoint rewritten to replay Redis LIST history + forward live pub/sub events (no inline execution)
    - 7 SSE stream tests covering history replay, live event forwarding, terminal states, disconnect cleanup, regressions
  affects:
    - apps/agent-server/src/plugins/pubsub.ts
    - apps/agent-server/src/routes/execution.ts
    - apps/agent-server/src/server.ts
    - apps/agent-server/src/__tests__/sse-stream.test.ts

tech-stack:
  added: []
  patterns:
    - "Reference-counted Redis subscribe: subscribe on first SSE client per goal, unsubscribe on last disconnect"
    - "EventEmitter as in-process message bus: Redis subscriber routes to emitter, SSE handlers listen on per-goal channels"
    - "History replay before live subscription: always replay Redis LIST before subscribing to pub/sub for late-joining clients"
    - "No `event:` field in SSE frames: data-only format for useSSE onmessage compatibility"
    - "Client disconnect via reply.raw.on('close'): only reliable mechanism — async handler return does not detect disconnects"
    - "Fastify plugin type augmentation: declare module 'fastify' in plugin file for agentEvents/subscribeGoal/unsubscribeGoal/redisPubSub"

key-files:
  created:
    - apps/agent-server/src/plugins/pubsub.ts
    - apps/agent-server/src/__tests__/sse-stream.test.ts
  modified:
    - apps/agent-server/src/routes/execution.ts
    - apps/agent-server/src/server.ts
    - apps/agent-server/src/__tests__/health-redis.test.ts
    - apps/agent-server/src/plugins/queue.ts

key-decisions:
  - "Reference-counted Redis subscribe/unsubscribe: check emitter.listenerCount(channel) before subscribing/unsubscribing to Redis — avoids redundant network calls when multiple SSE clients connect to the same goal"
  - "No-op decorators when REDIS_URL not set: server starts cleanly without Redis, local dev zero-config preserved"
  - "setMaxListeners(200) on shared EventEmitter: high limit for servers with many concurrent SSE clients per goal"
  - "Test approach for live-event case: await app.ready() before setTimeout emission — ensures plugin decorators registered before agentEvents is accessed"
  - "data-only SSE format (no event: field): dashboard useSSE hook uses source.onmessage which only fires for unnamed events"

patterns-established:
  - "Fastify plugin decorates app with agentEvents/subscribeGoal/unsubscribeGoal/redisPubSub — routes import goalChannel from queue package to compute channel name"
  - "SSE test with live events: await app.ready(), then setTimeout(50ms) to emit after handler registers listener"
  - "When pubsubPlugin imports new queue exports, all test files that set REDIS_URL via optionalEnv must include those exports in their @ai-cofounder/queue mock"

requirements-completed: [QUEUE-11]

duration: ~10min
completed: 2026-03-08
---

# Phase 02 Plan 02: Fastify Pub/Sub Plugin and SSE Endpoint Rewrite Summary

**Fastify pubsubPlugin with reference-counted Redis subscriber and EventEmitter routing, SSE endpoint rewritten to replay Redis LIST history then forward live events from the worker — no inline execution in request handlers.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-03-08T12:54:17Z
- **Completed:** 2026-03-08T13:04:17Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created Fastify pubsub plugin (pubsub.ts) decorating `app` with `agentEvents` (EventEmitter), `subscribeGoal`/`unsubscribeGoal` (reference-counted), and `redisPubSub` (for getHistory)
- Rewrote SSE endpoint to replay Redis LIST history on connect, then subscribe to live EventEmitter events forwarded from the worker — removed all inline execution code
- 7 passing tests covering history replay (progress, completed, failed), live event via EventEmitter, default message event format, and regression tests for POST execute and GET progress

## Task Commits

Each task was committed atomically:

1. **Task 1: Fastify pubsub plugin + SSE endpoint rewrite** - `718154f` (feat)
2. **Task 2: SSE stream endpoint tests** - `8e297d6` (test)
3. **Deviation fix: health-redis test mock** - `ca4858a` (fix)

## Files Created/Modified
- `apps/agent-server/src/plugins/pubsub.ts` - Fastify plugin with shared Redis subscriber, EventEmitter routing, reference-counted subscribeGoal/unsubscribeGoal
- `apps/agent-server/src/routes/execution.ts` - SSE endpoint rewritten to use Redis history replay + pub/sub live forwarding; removed inline dispatcher.runGoal()
- `apps/agent-server/src/server.ts` - Added pubsubPlugin import and registration after queuePlugin
- `apps/agent-server/src/__tests__/sse-stream.test.ts` - 7 tests for SSE endpoint behaviors
- `apps/agent-server/src/__tests__/health-redis.test.ts` - Added pubsub exports to @ai-cofounder/queue mock (deviation fix)
- `apps/agent-server/src/plugins/queue.ts` - Fixed pre-existing build error (return type mismatch in pipeline processor)

## Decisions Made
- Reference-counted Redis subscribe/unsubscribe: uses `emitter.listenerCount(channel)` to avoid redundant network subscribe calls when multiple clients connect to the same goal
- No-op decorators when REDIS_URL not set: preserves zero-config local development
- `setMaxListeners(200)` on shared EventEmitter: headroom for many concurrent SSE clients
- Test pattern for live events: `await app.ready()` + `setTimeout(50ms)` ensures decorators registered before agentEvents is accessed in the callback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing TypeScript build error in queue.ts pipeline processor**
- **Found during:** Task 1 (build verification after creating pubsub.ts)
- **Issue:** `return await executor.execute(job.data)` — PipelineResult not assignable to void (added `return` in prior session)
- **Fix:** Removed spurious `return` keyword — `await executor.execute(job.data)` (no return)
- **Files modified:** `apps/agent-server/src/plugins/queue.ts`
- **Verification:** `npm run build -w @ai-cofounder/agent-server` clean
- **Committed in:** 718154f (Task 1 commit)

**2. [Rule 1 - Bug] health-redis.test.ts queue mock missing pubsub exports**
- **Found during:** Full test suite run after Task 2
- **Issue:** `health-redis.test.ts` mocks `@ai-cofounder/queue` but doesn't include `createSubscriber`, `goalChannel`, `RedisPubSub` etc. — pubsubPlugin now requires these when REDIS_URL is set; test sets REDIS_URL via optionalEnv
- **Fix:** Added `createSubscriber`, `goalChannel`, `historyKey`, `RedisPubSub`, `CHANNEL_PREFIX`, `HISTORY_PREFIX`, `HISTORY_TTL_SECONDS` to the mock
- **Files modified:** `apps/agent-server/src/__tests__/health-redis.test.ts`
- **Verification:** All 5 health-redis tests pass; full suite 571/571 passing
- **Committed in:** ca4858a

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug, 1 Rule 1 bug)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
- Vitest's `app.inject()` hangs for SSE endpoints that stay open (empty history + live events). The test plan mentioned this; resolved by using `await app.ready()` + `setTimeout(50ms)` to emit a terminal event via `app.agentEvents`, which causes cleanup() to call `reply.raw.end()` and inject() to resolve.
- Vitest doesn't support `--testPathPattern` flag (Jest-style) — correct flag is positional argument: `vitest run pattern`.

## Next Phase Readiness
- Phase 02 is complete: worker publishes events (Plan 01) and SSE endpoint subscribes (Plan 02)
- Dashboard `useSSE` hook works without changes (default `message` events, `data.status` for completion detection)
- Ready for Phase 03: dashboard OAuth authentication

## Self-Check: PASSED

- FOUND: apps/agent-server/src/plugins/pubsub.ts
- FOUND: apps/agent-server/src/__tests__/sse-stream.test.ts
- FOUND: .planning/phases/02-sse-migration/02-02-SUMMARY.md
- FOUND commit: 718154f (Task 1)
- FOUND commit: 8e297d6 (Task 2)
- FOUND commit: ca4858a (Deviation fix)

---
*Phase: 02-sse-migration*
*Completed: 2026-03-08*
