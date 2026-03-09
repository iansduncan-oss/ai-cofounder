---
phase: 04-tests-quick-wins
plan: 01
subsystem: agent-server/testing
tags: [e2e, testing, postgresql, vitest, mocking]
dependency_graph:
  requires:
    - "packages/test-utils (toolUseResponse, textResponse)"
    - "packages/db (createDb)"
    - "apps/agent-server (buildServer, TaskDispatcher)"
  provides:
    - "E2E goal lifecycle test with real DB"
    - "Truncation helper for DB isolation between tests"
  affects:
    - "apps/agent-server test suite"
tech_stack:
  added: []
  patterns:
    - "Real DB E2E testing via createDb() + DATABASE_URL env"
    - "TRUNCATE ... CASCADE for test DB isolation"
    - "Dynamic import after env setup for correct module resolution order"
    - "try/finally pattern for app.close() to prevent timer leaks"
key_files:
  created:
    - "apps/agent-server/src/__tests__/e2e-goal-lifecycle.test.ts"
  modified: []
decisions:
  - "Used dynamic import for buildServer and createDb to ensure env vars are set before module loads"
  - "Truncation uses TRUNCATE ... CASCADE (not per-table deletes) for FK-safe cleanup"
  - "TaskDispatcher constructed with 7 explicit args to satisfy TypeScript without undefined spreading"
  - "Extra textResponse mock calls buffered after specialist task to handle self-improvement analysis calls"
metrics:
  duration: 2 min
  completed: "2026-03-09T02:26:23Z"
  tasks_completed: 1
  files_modified: 1
---

# Phase 04 Plan 01: E2E Goal Lifecycle Test Summary

**One-liner:** Real-DB E2E test using TRUNCATE isolation, scripted MockLlmRegistry, and TaskDispatcher.runGoal() to drive goal to completed status in PostgreSQL.

## What Was Built

Created `apps/agent-server/src/__tests__/e2e-goal-lifecycle.test.ts` — a 208-line E2E integration test that exercises the full goal create-dispatch-complete lifecycle against a real PostgreSQL test database (no DB mocking).

### Key Design Choices

**Real DB, not mocked:** Unlike all other agent-server tests, this file does NOT call `vi.mock("@ai-cofounder/db")`. Instead, it connects to a real PostgreSQL instance via `createDb(process.env.DATABASE_URL!)`. In CI, this is `postgresql://ci:ci@localhost:5432/ai_cofounder_test` (provisioned by the GitHub Actions `services.postgres` block).

**Three test cases:**
1. `creates goal via POST /api/agents/run and verifies DB rows` — calls the HTTP endpoint, extracts goalId from response, verifies real `goals` and `tasks` rows exist in PostgreSQL
2. `dispatches goal tasks to completion via TaskDispatcher.runGoal()` — builds on test 1, then calls `new TaskDispatcher(registry, db, undefined x5).runGoal(goalId)` and verifies `goal.status === "completed"` in the DB
3. `database is clean between test runs (truncation works)` — verifies `beforeEach` truncation leaves zero goals in DB

**Scripted LLM sequence:** `mockComplete` is scripted with `toolUseResponse("create_plan", ...)` as the first call (makes orchestrator call create_plan tool), then `textResponse(...)` for subsequent calls (plan confirmation, specialist agent execution).

**Truncation helper:** Inline `truncateTestDb(db)` function using `sql.raw("TRUNCATE TABLE ... CASCADE")` clears all 24 tables via CASCADE (no FK ordering needed). Called in `beforeEach` and `afterAll`.

**Timer leak prevention:** Every test body uses `try { ... } finally { await app.close() }` so server timers (scheduler, health flush interval) are always stopped even on assertion failure.

## Verification

- File exists at `apps/agent-server/src/__tests__/e2e-goal-lifecycle.test.ts` (208 lines)
- `vi.mock("@ai-cofounder/db")` is absent — confirmed by grep
- `toolUseResponse` and `textResponse` imported from `@ai-cofounder/test-utils` — confirmed by grep
- `TaskDispatcher` constructed with all 7 explicit args — confirmed by code inspection
- Locally: tests fail with `password authentication failed for user "ci"` (expected — no CI DB locally)
- Existing 45 test files still pass (617 tests) — no regressions

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- `apps/agent-server/src/__tests__/e2e-goal-lifecycle.test.ts` — FOUND
- Commit `1d29649` — FOUND
