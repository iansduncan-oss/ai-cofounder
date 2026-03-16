# Phase 11 — Autonomous Scheduling: Summary

## Overview

Phase 11 added autonomous session scheduling with safety guarantees — distributed locking, token budget enforcement, and CI self-healing.

## What Was Built

### Plan 01: Recurring Autonomous Sessions (SCHED-01, SCHED-02, SCHED-03)

**Queue infrastructure:**
- `AutonomousSessionJob` type and `autonomous-sessions` BullMQ queue in `packages/queue`
- Worker slot with `concurrency: 1`, `lockDuration: 1_800_000` (30 min)
- Recurring job via `setupRecurringJobs()` with configurable interval (`AUTONOMOUS_SESSION_INTERVAL_MINUTES`, default 30)
- `enqueueAutonomousSession()` helper for manual/programmatic triggering

**Distributed lock (SCHED-02):**
- `DistributedLockService` in `apps/agent-server/src/services/distributed-lock.ts`
- Redis `SET NX PX` for acquire, Lua compare-and-delete for release
- Prevents concurrent autonomous sessions — second attempt returns `status: "skipped"`
- Lock always released in `finally` block

**Token budget enforcement (SCHED-03):**
- `TokenBudgetExceededError` in `autonomous-executor.ts`
- Per-task token accumulation via `getCostByGoal()`
- Session aborts cleanly between tasks when budget exceeded — returns `status: "aborted"`
- No partial commits on budget exceed

**Session status extensions:**
- `SessionResult.status` extended: `"completed" | "failed" | "timeout" | "skipped" | "aborted"`

### Plan 02: CI Self-Healing (SCHED-04)

**CiSelfHealService** (`apps/agent-server/src/services/ci-self-heal.ts`):
- Redis-backed failure tracking with 7-day TTL
- 2-cycle confirmation: first failure increments counter, second triggers heal
- `healAttempted` flag prevents double-triggering
- Branch filtering: `autonomous/` and `dependabot/` branches ignored (prevents infinite loops)
- Heal session enqueued via `enqueueAutonomousSession({ trigger: "ci-heal", prompt: "..." })`

**Integration:**
- Wired as Fastify decorator (`app.ciSelfHealService`)
- Monitoring processor's `github_ci` case feeds CI results to the service
- CI success clears failure state for that repo+branch

## Files Added/Modified

| File | Change |
|------|--------|
| `packages/queue/src/queues.ts` | `AutonomousSessionJob`, `getAutonomousSessionQueue()` |
| `packages/queue/src/workers.ts` | `AutonomousSessionProcessor`, worker registration |
| `packages/queue/src/scheduler.ts` | Recurring autonomous session job |
| `packages/queue/src/helpers.ts` | `enqueueAutonomousSession()` |
| `apps/agent-server/src/services/distributed-lock.ts` | New — Redis distributed lock |
| `apps/agent-server/src/services/autonomous-executor.ts` | `TokenBudgetExceededError`, token budget opts |
| `apps/agent-server/src/autonomous-session.ts` | Lock acquire/release, token abort, "skipped"/"aborted" statuses |
| `apps/agent-server/src/worker.ts` | Autonomous session processor registration |
| `apps/agent-server/src/services/ci-self-heal.ts` | New — CI self-healing service |
| `apps/agent-server/src/plugins/queue.ts` | CI self-heal wiring, autonomous session interval |
| `apps/agent-server/src/server.ts` | `ciSelfHealService` Fastify decorator |

## Test Coverage

- `distributed-lock.test.ts` — acquire, release, contention, Lua script, unique tokens
- `autonomous-executor.test.ts` — token budget exceeded/within budget
- `autonomous-session.test.ts` — lock skip, abort, release-on-error
- `ci-self-heal.test.ts` — failure tracking, threshold, double-trigger prevention, branch filtering

## Requirements Fulfilled

| ID | Requirement | Status |
|----|-------------|--------|
| SCHED-01 | Recurring autonomous session schedule | Done |
| SCHED-02 | Distributed lock prevents concurrent sessions | Done |
| SCHED-03 | Token budget hard abort between tasks | Done |
| SCHED-04 | CI self-healing (2-cycle confirmation) | Done |
