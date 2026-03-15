---
phase: 13-financial-tracking
plan: "02"
subsystem: financial-tracking
tags: [api-endpoints, dashboard, recharts, tanstack-query, tdd, line-chart, budget-gauge]
dependency_graph:
  requires:
    - apps/agent-server/src/services/budget-alert.ts (BudgetAlertService.generateOptimizationSuggestions)
    - packages/db (getCostByDay, getUsageSummary)
    - apps/agent-server/src/routes/usage.ts (existing usageRoutes)
    - packages/api-client/src/types.ts (types base)
    - packages/api-client/src/client.ts (ApiClient base)
    - apps/dashboard/src/lib/query-keys.ts (queryKeys base)
    - apps/dashboard/src/api/queries.ts (hooks base)
    - apps/dashboard/src/routes/usage.tsx (existing Usage page)
    - packages/test-utils (mockDbModule)
  provides:
    - GET /api/usage/daily — daily cost series with zero-fill, 30-90 day window
    - GET /api/usage/budget — daily+weekly spend vs thresholds + optimization suggestions
    - ApiClient.getDailyCost() — typed fetch for daily cost data
    - ApiClient.getBudgetStatus() — typed fetch for budget status
    - useDailyCost() hook — TanStack Query wrapper for daily cost data
    - useBudgetStatus() hook — TanStack Query wrapper for budget status (60s poll)
    - DailyCostDay, DailyCostResponse, BudgetStatusResponse types
  affects:
    - apps/agent-server/src/routes/usage.ts (extended with 2 new endpoints)
    - packages/api-client/src/types.ts (3 new types added)
    - packages/api-client/src/client.ts (2 new methods added)
    - apps/dashboard/src/lib/query-keys.ts (2 new query keys)
    - apps/dashboard/src/api/queries.ts (2 new hooks)
    - apps/dashboard/src/routes/usage.tsx (daily trend + budget gauge + suggestions)
tech_stack:
  added: []
  patterns:
    - TDD (RED/GREEN/REFACTOR cycle)
    - Zero-fill gap-filling via Map keyed by date string for O(1) lookup
    - Promise.all for parallel daily+weekly usage queries
    - Optional chaining for budgetAlertService (fallback to empty array)
    - Color-coded progress bars (blue/yellow/red at 90%/100% thresholds)
    - Conditional rendering for suggestions (skip "No opportunities" message)
key_files:
  created:
    - apps/agent-server/src/__tests__/usage-routes.test.ts
  modified:
    - apps/agent-server/src/routes/usage.ts
    - packages/api-client/src/types.ts
    - packages/api-client/src/client.ts
    - apps/dashboard/src/lib/query-keys.ts
    - apps/dashboard/src/api/queries.ts
    - apps/dashboard/src/routes/usage.tsx
decisions:
  - Zero-fill iterates exactly N days from `since` (not filtered to today) — ensures stable count even when DB has no recent data
  - BudgetAlertService accessed via optional chaining in route — graceful fallback if service not yet wired in test environment
  - Optimization suggestions panel hidden when only "No optimization opportunities" message — avoids noise for users with minimal usage
  - Budget gauge only shows progress bar when limitUsd > 0 — "No limit configured" shown otherwise
metrics:
  duration: "4 min"
  completed_date: "2026-03-15"
  tasks: 2/2
  files: 6
---

# Phase 13 Plan 02: Financial Tracking API Endpoints + Dashboard UI Summary

Daily cost trend endpoint with zero-fill, budget status endpoint with thresholds + suggestions, and dashboard visualizations (LineChart + budget gauge + suggestions panel).

## What Was Built

**API Layer:**
- `GET /api/usage/daily?days=N` — returns exactly N data points (default 30, max 90) for daily LLM cost. Days with no spend are zero-filled. Backed by `getCostByDay()` from Plan 01.
- `GET /api/usage/budget` — returns daily and weekly spend vs configured limits (`DAILY_BUDGET_USD`, `WEEKLY_BUDGET_USD` env vars) with `percentUsed` (null when limit=0) and `optimizationSuggestions` from `BudgetAlertService`.

**ApiClient:**
- `getDailyCost(days = 30)` → `DailyCostResponse`
- `getBudgetStatus()` → `BudgetStatusResponse`
- Types: `DailyCostDay`, `DailyCostResponse`, `BudgetStatusResponse`

**Dashboard Usage Page:**
1. **Daily Cost Trend (30 Days)** — `LineChart` from recharts, date labels as MM/DD, Y-axis in USD with 3 decimal places, tooltip shows 4 decimal places
2. **Budget Gauges** — two side-by-side cards (Daily/Weekly), color-coded progress bar (blue <90%, yellow 90-100%, red >100%), "No limit configured" when limit=0
3. **Optimization Suggestions** — renders only when suggestions exist and aren't the "No opportunities" fallback, bulleted list with `TrendingDown` icon

## Deviations from Plan

None — plan executed exactly as written.

## Test Coverage

8 tests in `usage-routes.test.ts`:
- `GET /api/usage/daily`: 5 tests (30-day default, custom days, 90-day cap, zero-fill, date format)
- `GET /api/usage/budget`: 3 tests (limitUsd=0 → percentUsed=null, suggestions array, spend values)

## Self-Check: PASSED

All created files exist on disk. Both task commits verified in git log:
- `a62abd7` — feat(13-02): add daily cost and budget status API endpoints
- `85b076e` — feat(13-02): add daily trend chart, budget gauge, and optimization suggestions to Usage page
