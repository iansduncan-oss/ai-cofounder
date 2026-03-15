---
phase: 13-financial-tracking
plan: "01"
subsystem: financial-tracking
tags: [budget-alerting, llm-cost, bullmq, fastify, tdd]
dependency_graph:
  requires:
    - packages/db (llmUsage table, getUsageSummary, sql)
    - packages/queue (MonitoringJob, monitoringQueue, setupRecurringJobs)
    - apps/agent-server/src/services/notifications.ts (NotificationService.sendBriefing)
    - apps/agent-server/src/server.ts (onReady hook, Fastify decorators)
    - packages/test-utils (mockDbModule)
  provides:
    - getCostByDay() — daily cost aggregates for FIN-02 API consumption
    - BudgetAlertService — threshold checks + deduplication + optimization suggestions
    - budget_check — 1-minute recurring BullMQ monitoring job
  affects:
    - packages/db/src/repositories.ts (new export getCostByDay)
    - packages/queue/src/queues.ts (MonitoringJob union extended)
    - packages/queue/src/scheduler.ts (new recurring job)
    - apps/agent-server/src/plugins/queue.ts (new switch case)
    - apps/agent-server/src/server.ts (new decorator + onReady wiring)
tech_stack:
  added: []
  patterns:
    - TDD (RED/GREEN: failing tests first, then implementation)
    - BullMQ recurring job via upsertJobScheduler (every 60s)
    - Fastify decorator pattern (decorate in buildServer, wire in onReady)
    - Alert deduplication via in-memory Set keyed by date string
    - Algorithmic optimization suggestions (no LLM call)
key_files:
  created:
    - apps/agent-server/src/services/budget-alert.ts
    - apps/agent-server/src/__tests__/budget-alert.test.ts
  modified:
    - packages/db/src/repositories.ts
    - packages/test-utils/src/mocks/db.ts
    - packages/queue/src/queues.ts
    - packages/queue/src/scheduler.ts
    - apps/agent-server/src/plugins/queue.ts
    - apps/agent-server/src/server.ts
decisions:
  - "Alert deduplication keyed by date string (daily-YYYY-MM-DD / weekly-YYYY-MM-DD) in an in-memory Set — cheap and effective for a 1-minute recurring job"
  - "Optimization suggestions are purely algorithmic (rule-based byModel/byAgent checks) per research guidance — avoids burning LLM tokens for cost monitoring"
  - "budget_check uses the existing monitoring queue/worker infrastructure rather than a new queue — zero new BullMQ setup needed"
metrics:
  duration: "4 min"
  completed_date: "2026-03-15"
  tasks_completed: 2
  files_modified: 6
  files_created: 2
---

# Phase 13 Plan 01: Financial Tracking Data Layer + Budget Alerting Summary

**One-liner:** Daily cost aggregates via getCostByDay() + BudgetAlertService with threshold de-duplication and algorithmic optimization suggestions, wired as a 1-minute BullMQ recurring job.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | getCostByDay DB function + BudgetAlertService + tests (TDD) | 28a2320 | packages/db/src/repositories.ts, apps/agent-server/src/services/budget-alert.ts, apps/agent-server/src/__tests__/budget-alert.test.ts, packages/test-utils/src/mocks/db.ts |
| 2 | BullMQ wiring + Fastify decorator | 1847548 | packages/queue/src/queues.ts, packages/queue/src/scheduler.ts, apps/agent-server/src/plugins/queue.ts, apps/agent-server/src/server.ts |

## What Was Built

### getCostByDay() — packages/db/src/repositories.ts

Placed after `getCostByGoal()`. Uses `date_trunc('day', created_at)::date::text` SQL aggregate to group LLM usage records by calendar day. Divides `estimatedCostUsd` microdollar values by `1_000_000` to return USD. Accepts a required `since: Date` and optional `until?: Date` filter. Returns `Array<{ date, costUsd, inputTokens, outputTokens, requests }>` ordered ascending.

### BudgetAlertService — apps/agent-server/src/services/budget-alert.ts

- `checkBudgets()`: Reads `DAILY_BUDGET_USD` and `WEEKLY_BUDGET_USD` via `optionalEnv`. If non-zero, queries `getUsageSummary()` for the relevant period and calls `notificationService.sendBriefing()` when the threshold is met. Uses a private `firedAlerts: Set<string>` for in-process deduplication keyed as `"daily-YYYY-MM-DD"` / `"weekly-YYYY-MM-DD"` to prevent duplicate Slack messages within a run.
- `generateOptimizationSuggestions()`: Queries 7-day usage summary, checks `byModel` for Opus models with >10 requests and `byAgent` for orchestrator consuming >70% of spend. Returns actionable string suggestions or a "no opportunities" default. No LLM call.

### BullMQ Wiring

- `MonitoringJob.check` union extended with `"budget_check"` (packages/queue/src/queues.ts)
- `setupRecurringJobs()` registers `"budget-check"` scheduler at `every: 60_000 ms` (packages/queue/src/scheduler.ts)
- Monitoring processor switch in plugins/queue.ts handles `case "budget_check"` by calling `app.budgetAlertService.checkBudgets()`
- server.ts decorates `budgetAlertService` and wires it in `onReady` after `notificationService` is available

## Test Results

8 tests, 8 passing:

- `does not fire notification when DAILY_BUDGET_USD=0 (disabled)` — budget check skipped when env is "0"
- `fires sendBriefing when daily spend >= DAILY_BUDGET_USD threshold` — fires with "daily" in message
- `fires sendBriefing when weekly spend >= WEEKLY_BUDGET_USD threshold` — fires with "weekly" in message
- `does NOT fire duplicate alert for same calendar day` — sendBriefing called exactly once on two checkBudgets() calls
- `does not fire when daily spend is below threshold` — $0.50 under $10 limit
- `returns suggestion when claude-opus used for >10 requests` — suggestion contains "opus" or "expensive"
- `returns 'no opportunities' when usage is modest` — single default message returned
- `returns suggestion when orchestrator agent has very high cost` — suggestion contains "orchestrator" or "agent"

## Deviations from Plan

None — plan executed exactly as written.

## Build Verification

- `npm run build -w @ai-cofounder/queue` — clean (MonitoringJob type valid)
- `npm run build -w @ai-cofounder/db` — clean (getCostByDay exported)
- All 8 budget-alert tests pass

## Self-Check: PASSED

Files confirmed present:
- apps/agent-server/src/services/budget-alert.ts — FOUND
- apps/agent-server/src/__tests__/budget-alert.test.ts — FOUND
- getCostByDay in packages/db/src/repositories.ts — FOUND (grep verified)
- "budget_check" in packages/queue/src/queues.ts — FOUND
- "budget-check" in packages/queue/src/scheduler.ts — FOUND
- "budget_check" case in apps/agent-server/src/plugins/queue.ts — FOUND
- "budgetAlertService" decorator in apps/agent-server/src/server.ts — FOUND

Commits confirmed:
- 28a2320 — feat(13-01): getCostByDay DB function + BudgetAlertService with tests
- 1847548 — feat(13-01): BullMQ wiring + Fastify decorator for BudgetAlertService
