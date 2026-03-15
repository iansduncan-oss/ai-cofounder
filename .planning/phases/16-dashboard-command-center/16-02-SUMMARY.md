---
phase: 16-dashboard-command-center
plan: 02
subsystem: ui
tags: [react, tanstack-query, localStorage, useSyncExternalStore, notifications]

# Dependency graph
requires:
  - phase: 16-dashboard-command-center
    provides: dashboard foundation, api-client with listProjects/listToolTierConfig

provides:
  - ProjectSwitcher dropdown in sidebar with localStorage persistence via useActiveProject hook
  - Full-page notification center at /dashboard/notifications aggregating approvals + monitoring + budget
  - Journal date-range filtering (From/To inputs with 7-day default window)
  - Approval tier badges (green/yellow/red) on each approval card

affects:
  - future dashboard phases that need project context

# Tech tracking
tech-stack:
  added: []
  patterns:
    - useSyncExternalStore for localStorage-backed cross-component state (useActiveProject hook)
    - Notification aggregation pattern from multiple data sources with timestamp sort
    - Client-side date-range filtering layered on top of server-side pagination

key-files:
  created:
    - apps/dashboard/src/hooks/use-active-project.ts
    - apps/dashboard/src/components/layout/project-switcher.tsx
    - apps/dashboard/src/routes/notifications.tsx
    - apps/dashboard/src/__tests__/components/project-switcher.test.tsx
    - apps/dashboard/src/__tests__/routes/notifications.test.tsx
    - apps/dashboard/src/__tests__/routes/journal.test.tsx
    - apps/dashboard/src/__tests__/routes/approvals.test.tsx
  modified:
    - apps/dashboard/src/api/queries.ts
    - apps/dashboard/src/lib/query-keys.ts
    - apps/dashboard/src/components/layout/sidebar.tsx
    - apps/dashboard/src/routes/index.tsx
    - apps/dashboard/src/routes/journal.tsx
    - apps/dashboard/src/routes/approvals.tsx

key-decisions:
  - "useSyncExternalStore is the correct React 18 pattern for localStorage-backed external store - avoids stale reads vs useState+useEffect"
  - "ProjectSwitcher returns null when no projects registered - avoids empty dropdown noise"
  - "BudgetStatusResponse uses nested shape data.daily.percentUsed - not flat percentUsed at root"
  - "Notification sort uses timestamp descending across all three sources (approvals, monitoring, budget)"
  - "Date-range filtering is client-side to avoid extra API calls - entries are already fetched"
  - "TierBadge defaults to yellow when tool name cannot be extracted or tier not in config - pending approvals are at minimum yellow-tier"
  - "extractToolName uses single-quote pattern first then word-after-Tool fallback for resilient parsing"

patterns-established:
  - "Client-side date filtering: compare YYYY-MM-DD strings directly (slice occurredAt at T)"
  - "Notification aggregation: build array from multiple queries, sort descending by timestamp"
  - "TDD with vi.mock for query hooks: mock before import, vi.mocked() for typed access"

requirements-completed: [DASH-01, DASH-02, DASH-04, DASH-05]

# Metrics
duration: 15min
completed: 2026-03-15
---

# Phase 16 Plan 02: Dashboard Command Center Summary

**ProjectSwitcher with localStorage persistence, full-page notification center aggregating 3 data sources, journal date-range filter, and tier-aware approval badges — 135 tests passing**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-15T22:30:01Z
- **Completed:** 2026-03-15T22:45:00Z
- **Tasks:** 3/3
- **Files modified:** 13

## Accomplishments

- `useActiveProject` hook using `useSyncExternalStore` for cross-component localStorage reactivity; `ProjectSwitcher` dropdown rendered in sidebar, hidden when no projects registered
- `NotificationsPage` at `/dashboard/notifications` aggregates pending approvals, monitoring alerts, and budget warnings (>90% threshold) — sorted by most recent first with All/Approvals/Alerts/Budget filter tabs
- Journal page gets From/To date inputs (defaulting to 7-day window) with client-side filtering; approval cards get tier badges (yellow/red) via `useToolTierConfig` cross-reference

## Task Commits

Each task was committed atomically:

1. **Task 1: Project switcher component + useActiveProject hook + sidebar integration** - `e9a5bde` (feat)
2. **Task 2: Full-page notification center route** - `9086cb6` (feat)
3. **Task 3: Journal date-range filter + approvals tier badge + test coverage** - `1f067cb` (feat)
4. **Fix: BudgetStatusResponse shape correction** - `d8eab3a` (fix) — deviation Rule 1

**Plan metadata:** (docs commit to follow)

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified

- `apps/dashboard/src/hooks/use-active-project.ts` - useActiveProject/useSetActiveProject with useSyncExternalStore
- `apps/dashboard/src/components/layout/project-switcher.tsx` - ProjectSwitcher dropdown (hidden when empty)
- `apps/dashboard/src/routes/notifications.tsx` - Full-page notification center with 3 data sources
- `apps/dashboard/src/lib/query-keys.ts` - Added `projects` namespace
- `apps/dashboard/src/api/queries.ts` - Added `useProjects` hook
- `apps/dashboard/src/components/layout/sidebar.tsx` - Added ProjectSwitcher + Notifications nav entry
- `apps/dashboard/src/routes/index.tsx` - Registered /dashboard/notifications route
- `apps/dashboard/src/routes/journal.tsx` - Added From/To date-range filter with 7-day default
- `apps/dashboard/src/routes/approvals.tsx` - Added TierBadge component + useToolTierConfig lookup
- `apps/dashboard/src/__tests__/components/project-switcher.test.tsx` - 4 tests
- `apps/dashboard/src/__tests__/routes/notifications.test.tsx` - 6 tests
- `apps/dashboard/src/__tests__/routes/journal.test.tsx` - 4 tests
- `apps/dashboard/src/__tests__/routes/approvals.test.tsx` - 4 tests

## Decisions Made

- `useSyncExternalStore` chosen over `useState+useEffect` for localStorage to avoid stale reads
- `ProjectSwitcher` returns `null` (not empty div) when no projects — avoids visual noise
- `BudgetStatusResponse` shape is nested: `data.daily.percentUsed`, not flat `percentUsed`
- Date-range filtering is client-side — entries already fetched, avoids extra API round trips
- `TierBadge` defaults to `yellow` when tier not found — conservatively assumes minimum approval tier
- `extractToolName` uses single-quote regex first then word-after-Tool fallback for resilience

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed BudgetStatusResponse shape mismatch**
- **Found during:** Task 2 (Build verification)
- **Issue:** `notifications.tsx` accessed `budgetStatus.percentUsed` directly but actual API type is `BudgetStatusResponse.daily.percentUsed` (nested shape)
- **Fix:** Updated access to `budgetStatus.daily.percentUsed` and adjusted test mocks to match correct shape
- **Files modified:** `apps/dashboard/src/routes/notifications.tsx`, `apps/dashboard/src/__tests__/routes/notifications.test.tsx`
- **Verification:** `npm run build` passes with no TypeScript errors
- **Committed in:** `d8eab3a`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix necessary for TypeScript correctness. No scope creep.

## Issues Encountered

- Initial test for "container.firstChild is null" (empty component) failed because `renderWithProviders` wraps in a div — fixed by testing `queryByRole("combobox")` absence instead
- `screen.getByRole("main")` in sort order test failed (no main landmark in test DOM) — fixed by using `document.body.textContent` positional check

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DASH-01 (journal), DASH-02 (approvals), DASH-04 (project switcher), DASH-05 (notifications) all satisfied
- ProjectSwitcher persists active project ID — future plans can use `useActiveProject()` to scope API queries by project
- Notifications page ready for additional notification types (e.g., CI failures, deployment events) by extending the aggregation pattern

---
*Phase: 16-dashboard-command-center*
*Completed: 2026-03-15*

## Self-Check: PASSED

- FOUND: apps/dashboard/src/hooks/use-active-project.ts
- FOUND: apps/dashboard/src/components/layout/project-switcher.tsx
- FOUND: apps/dashboard/src/routes/notifications.tsx
- FOUND: apps/dashboard/src/__tests__/components/project-switcher.test.tsx
- FOUND: apps/dashboard/src/__tests__/routes/notifications.test.tsx
- FOUND: apps/dashboard/src/__tests__/routes/journal.test.tsx
- FOUND: apps/dashboard/src/__tests__/routes/approvals.test.tsx
- Commits e9a5bde, 9086cb6, 1f067cb, d8eab3a all verified in git log
