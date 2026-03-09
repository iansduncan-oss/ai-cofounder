---
phase: 07-pipeline-trigger
plan: 01
subsystem: ui
tags: [react, tanstack-query, react-router, tailwind, vitest, dialog, pipelines]

# Dependency graph
requires:
  - phase: 06-pipeline-detail
    provides: pipeline detail page, PipelineStateBadge, stage-progress component, API types
  - phase: 05-pipeline-list-navigation
    provides: pipelines list page, useListPipelines query, PipelinesPage component
provides:
  - Two-mode pipeline submission dialog (goal-based and custom-stage)
  - useSubmitPipeline mutation hook for custom pipelines
  - Updated useSubmitGoalPipeline toast with job ID display
  - Optional className prop on Dialog component
  - Comprehensive tests covering all 4 TRIGGER requirements
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Two-mode dialog toggle using segmented control buttons with Tailwind
    - Dynamic stage list with add/remove, minimum 1 constraint
    - handleClose pattern resets all form state to prevent stale state on reopen
    - Callsite onSuccess for navigation, hook onSuccess for toast + cache invalidation

key-files:
  created:
    - apps/dashboard/src/components/pipelines/submit-pipeline-dialog.tsx
  modified:
    - apps/dashboard/src/api/mutations.ts
    - apps/dashboard/src/components/ui/dialog.tsx
    - apps/dashboard/src/routes/pipelines.tsx
    - apps/dashboard/src/__tests__/pages/pipelines.test.tsx

key-decisions:
  - "handleClose resets all state (goalId, mode, stages) to prevent stale form on reopen"
  - "Navigation in dialog callsite onSuccess, toast/cache invalidation in hook onSuccess - no toast duplication"
  - "Dialog className prop uses cn() to merge with default max-w-md — backward compatible"
  - "Submit button disabled when goalId.trim() empty OR mutation isPending"

patterns-established:
  - "Two-mode dialog: segmented toggle at top, separate form per mode"
  - "handleClose function: call onClose + reset all local state"
  - "Mutation callsite onSuccess: navigate only; hook onSuccess: toast + invalidate"

requirements-completed: [TRIGGER-01, TRIGGER-02, TRIGGER-03, TRIGGER-04]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 7 Plan 01: Pipeline Trigger Summary

**Two-mode pipeline submission dialog with goal-based and custom-stage builder, job ID confirmation toasts, and automatic redirect to pipeline detail on success**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T17:20:14Z
- **Completed:** 2026-03-09T17:23:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Created `SubmitPipelineDialog` with goal and custom modes, stage builder (add/remove/configure), job-ID toast, and navigate-on-success
- Added `useSubmitPipeline` mutation hook; updated `useSubmitGoalPipeline` toast to show job ID
- Added optional `className` prop to `Dialog` component (backward compatible)
- Removed inline skeleton dialog from `pipelines.tsx`, replaced with import of new component
- Added 7 new tests covering all 4 TRIGGER requirements (108 total, all passing)

## Task Commits

Each task was committed atomically:

1. **Task 1: Mutations, Dialog component, and route wiring** - `3b3b3df` (feat)
2. **Task 2: Tests for all TRIGGER requirements** - `c632759` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `apps/dashboard/src/components/pipelines/submit-pipeline-dialog.tsx` - Two-mode pipeline submission dialog (goal/custom)
- `apps/dashboard/src/api/mutations.ts` - Added `useSubmitPipeline` hook, updated `useSubmitGoalPipeline` toast
- `apps/dashboard/src/components/ui/dialog.tsx` - Added optional `className` prop
- `apps/dashboard/src/routes/pipelines.tsx` - Removed inline dialog, imports `SubmitPipelineDialog`
- `apps/dashboard/src/__tests__/pages/pipelines.test.tsx` - Extended with 7 new TRIGGER tests

## Decisions Made
- `handleClose` resets all form state (goalId, mode, stages) — prevents stale data on dialog reopen
- Navigation lives in dialog `callsite.onSuccess`; toast/cache invalidation in hook `onSuccess` — avoids duplicate toasts
- `Dialog` className uses `cn()` merge — existing callers unchanged (no className passed)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `getByText("Run Pipeline")` matched both the page button and dialog title — fixed by using `getAllByText` in test

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 7 (Pipeline Trigger) is the final phase of the v1.1 milestone
- Users can now list, inspect, AND create pipeline runs from the dashboard
- v1.1 Pipeline Dashboard UI milestone is complete

## Self-Check: PASSED

- FOUND: apps/dashboard/src/components/pipelines/submit-pipeline-dialog.tsx
- FOUND: apps/dashboard/src/api/mutations.ts
- FOUND: apps/dashboard/src/__tests__/pages/pipelines.test.tsx
- FOUND: .planning/phases/07-pipeline-trigger/07-01-SUMMARY.md
- FOUND: commit 3b3b3df (feat: mutations, dialog, route wiring)
- FOUND: commit c632759 (test: TRIGGER requirements)

---
*Phase: 07-pipeline-trigger*
*Completed: 2026-03-09*
