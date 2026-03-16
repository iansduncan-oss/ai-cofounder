# Phase 12 — Parallel Task Execution (DAG): Summary

## Overview

Phase 12 added DAG-based parallel task execution to the dispatcher, allowing tasks with explicit dependency graphs to run concurrently where dependencies allow.

## What Was Built

### DAG Execution Engine

**Schema changes:**
- `tasks.depends_on` — jsonb column storing UUID array of dependency task IDs
- `"blocked"` added to `task_status` enum
- Migration: `0021_add_task_dependencies.sql`

**Orchestrator `create_plan` enhancements:**
- `depends_on` field on tasks (array of zero-based task indices within the plan)
- Two-pass `persistPlan`: first pass creates all tasks, second pass resolves indices to UUIDs
- `validateDependencyGraph()` using Kahn's algorithm for cycle detection

**Dispatcher `runGoalDAG()`:**
- Ready-queue pattern: tasks with all dependencies completed are eligible to run
- `MAX_TASK_CONCURRENCY` env var (default 3) limits parallel execution
- Only direct dependency outputs passed as context (not entire chain)
- `blockDownstream()` — BFS cascade blocks all transitive dependents on failure

**DB functions:**
- `blockTask(db, id, reason)` — sets task status to "blocked" with reason
- `updateTaskDependencies(db, taskId, dependsOn)` — updates depends_on jsonb

### Dashboard Integration

- `TaskStatusBadge` supports `blocked` status (warning variant)
- Goal detail view shows "depends on N tasks" badge per task

### Backward Compatibility

- `parallelGroup` still works for legacy plans
- DAG path only activates when any task in the goal has `dependsOn`
- Goals without `dependsOn` use legacy `runGoalGrouped()` path

## Files Added/Modified

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | `tasks.dependsOn` jsonb column |
| `packages/db/src/repositories.ts` | `blockTask()`, `updateTaskDependencies()` |
| `packages/db/drizzle/0021_add_task_dependencies.sql` | Migration |
| `apps/agent-server/src/agents/orchestrator.ts` | `depends_on` in create_plan, two-pass persistPlan, cycle detection |
| `apps/agent-server/src/agents/dispatcher.ts` | `runGoalDAG()`, `blockDownstream()`, `MAX_TASK_CONCURRENCY` |
| `apps/dashboard/src/components/task-status-badge.tsx` | `blocked` status support |
| `apps/dashboard/src/routes/goal-detail.tsx` | Dependency badge display |

## Test Coverage

`dispatcher-dag.test.ts` — 8 tests:
1. DAG basic execution (independent tasks run in parallel)
2. Failure propagation (failed task blocks dependents)
3. Transitive blocking (BFS cascade)
4. Diamond dependency (common pattern works correctly)
5. Concurrency limit respected
6. Context from deps only (not entire chain)
7. Legacy fallback (no dependsOn → runGoalGrouped)
8. Cycle detection (Kahn's algorithm rejects cycles)

## Requirements Fulfilled

| ID | Requirement | Status |
|----|-------------|--------|
| DAG-01 | Tasks with dependency graph run via DAG executor | Done |
| DAG-02 | Failed tasks block downstream dependents (BFS) | Done |
| DAG-03 | Concurrency limit configurable via env var | Done |
| DAG-04 | Backward compatible with legacy parallelGroup | Done |
