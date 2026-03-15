---
phase: 16-dashboard-command-center
plan: 01
subsystem: database
tags: [postgres, drizzle, settings, budget, api-client]

# Dependency graph
requires: []
provides:
  - appSettings DB table (key-value system config store)
  - getAppSetting / upsertAppSetting / getAllAppSettings repository functions
  - GET /api/settings endpoint (DB-first, env-fallback budget thresholds)
  - PUT /api/settings/budget endpoint (persist daily/weekly thresholds)
  - DB-first budget reads in usage.ts and BudgetAlertService.checkBudgets()
  - ApiClient.getSettings() and ApiClient.updateBudgetThresholds() methods
affects:
  - 16-03 (settings page frontend will consume GET /api/settings + PUT /api/settings/budget)
  - budget-alert (now reads persisted thresholds from DB)
  - usage-routes (now reads persisted thresholds from DB)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - DB-first with env fallback for configuration values (getAppSetting returns null → parseFloat(optionalEnv(...)))
    - Key-value app_settings table for system configuration persistence
    - Separate repository file per concern (repositories/settings.ts)

key-files:
  created:
    - packages/db/src/repositories/settings.ts
    - packages/db/drizzle/0029_add_app_settings.sql
    - apps/agent-server/src/routes/settings-api.ts
    - apps/agent-server/src/__tests__/settings-api.test.ts
  modified:
    - packages/db/src/schema.ts
    - packages/db/src/index.ts
    - packages/db/drizzle/meta/_journal.json
    - packages/test-utils/src/mocks/db.ts
    - apps/agent-server/src/plugins/jwt-guard.ts
    - apps/agent-server/src/routes/usage.ts
    - apps/agent-server/src/services/budget-alert.ts
    - packages/api-client/src/client.ts
    - packages/api-client/src/types.ts

key-decisions:
  - "Migration numbered 0029 (not 0022 as planned) — 0022 was already taken by 0022_add_memory_agent_role.sql"
  - "New repository file created at repositories/settings.ts and exported from index.ts directly (not via repositories.ts) — matches plan spec while keeping separation of concerns"
  - "DB-first pattern uses Promise.all for both daily_budget_usd and weekly_budget_usd reads in parallel — consistent across usage.ts and BudgetAlertService"
  - "ApiClient.updateBudgetThresholds passes body as third arg to request() — matches existing ApiClient request signature (method, path, body?)"

patterns-established:
  - "DB-first config reads: getAppSetting(db, key) ?? parseFloat(optionalEnv(name, '0')) — use this pattern for all future configurable thresholds"

requirements-completed: [DASH-01, DASH-02, DASH-03, DASH-06]

# Metrics
duration: 15min
completed: 2026-03-15
---

# Phase 16 Plan 01: Settings Backend Summary

**DB-backed key-value settings store with GET/PUT /api/settings routes, DB-first budget threshold reads in usage + BudgetAlertService, and ApiClient.getSettings() / updateBudgetThresholds()**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-15T19:00:00Z
- **Completed:** 2026-03-15T19:15:00Z
- **Tasks:** 2/2
- **Files modified:** 13

## Accomplishments

- appSettings DB table (key-value store) with migration 0029, Drizzle schema, and getAppSetting/upsertAppSetting/getAllAppSettings repository
- GET /api/settings + PUT /api/settings/budget endpoints with validation (non-negative values), registered in jwt-guard
- DB-first budget reads in usage.ts /budget handler and BudgetAlertService.checkBudgets() — env vars now serve as fallback only
- ApiClient.getSettings() and ApiClient.updateBudgetThresholds() typed methods
- 7 settings-api tests passing (GET defaults, GET stored values, PUT persists + validates, GET after PUT, DB-first usage/budget)

## Task Commits

Each task was committed atomically:

1. **Task 1: appSettings DB table + repository + migration + mock stubs** - `603dc56` (feat)
2. **Task 2: Settings API routes + usage/budget-alert DB-first reads + ApiClient methods** - `cd040fe` (feat)

## Files Created/Modified

- `packages/db/src/schema.ts` - Added appSettings table definition (key/value/updatedAt)
- `packages/db/src/repositories/settings.ts` - getAppSetting, upsertAppSetting, getAllAppSettings
- `packages/db/src/index.ts` - Re-exports new repository functions
- `packages/db/drizzle/0029_add_app_settings.sql` - Migration SQL for app_settings table
- `packages/db/drizzle/meta/_journal.json` - Added entry 29 for new migration
- `packages/test-utils/src/mocks/db.ts` - Added getAppSetting, upsertAppSetting, getAllAppSettings mock stubs
- `apps/agent-server/src/routes/settings-api.ts` - GET /api/settings + PUT /api/settings/budget routes
- `apps/agent-server/src/plugins/jwt-guard.ts` - Registered settingsApiRoutes at /api/settings
- `apps/agent-server/src/routes/usage.ts` - DB-first budget reads in /budget handler
- `apps/agent-server/src/services/budget-alert.ts` - DB-first budget reads in checkBudgets()
- `packages/api-client/src/types.ts` - AppSettings and UpdateBudgetInput interfaces
- `packages/api-client/src/client.ts` - getSettings() and updateBudgetThresholds() methods
- `apps/agent-server/src/__tests__/settings-api.test.ts` - 7 tests for settings API

## Decisions Made

- Migration numbered 0029 instead of 0022 as planned — 0022 was already used by `0022_add_memory_agent_role.sql`
- New repository file at `repositories/settings.ts` exported directly from `index.ts` to match plan spec while keeping separation of concerns
- DB-first pattern uses `Promise.all` for parallel reads of daily/weekly keys in both usage.ts and BudgetAlertService
- ApiClient methods follow existing pattern: `request<T>(method, path, body?)`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Migration file number corrected from 0022 to 0029**
- **Found during:** Task 1 (migration file creation)
- **Issue:** Plan specified filename `0022_add_app_settings.sql` but migration 0022 already existed (`0022_add_memory_agent_role.sql`). Using the same number would break sequential migration tracking.
- **Fix:** Used `0029_add_app_settings.sql` (next available number) and updated `_journal.json` entry accordingly
- **Files modified:** packages/db/drizzle/0029_add_app_settings.sql, packages/db/drizzle/meta/_journal.json
- **Verification:** DB build passes cleanly
- **Committed in:** 603dc56 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Essential correctness fix. Migration numbering must be sequential. No scope creep.

## Issues Encountered

None — all builds passed and all 7 tests passed on first run.

## Next Phase Readiness

- Settings backend fully operational — ready for Plan 03 frontend (Settings page consuming GET /api/settings + PUT /api/settings/budget)
- Budget alerts will now fire at dashboard-configured thresholds (persists across server restarts)
- ApiClient methods available for dashboard queries

## Self-Check: PASSED

- FOUND: packages/db/src/repositories/settings.ts
- FOUND: packages/db/drizzle/0029_add_app_settings.sql
- FOUND: apps/agent-server/src/routes/settings-api.ts
- FOUND: apps/agent-server/src/__tests__/settings-api.test.ts (7 tests, all passing)
- FOUND: commit 603dc56 (Task 1)
- FOUND: commit cd040fe (Task 2)

---
*Phase: 16-dashboard-command-center*
*Completed: 2026-03-15*
