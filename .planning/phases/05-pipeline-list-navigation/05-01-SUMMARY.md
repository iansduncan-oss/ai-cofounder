---
phase: 05-pipeline-list-navigation
plan: 01
subsystem: ui
tags: [react, react-router, tanstack-query, tailwind, vitest, pipelines, dashboard]

# Dependency graph
requires: []
provides:
  - "Pipeline list page with state filter, timing, and clickable rows"
  - "Pipeline detail route stub at /dashboard/pipelines/:jobId"
  - "StageProgress/StageIcon components extracted to components/pipelines/stage-progress.tsx"
  - "10 passing tests covering list render, filtering, navigation, loading/error/empty states"
affects: [06-pipeline-detail-view, 07-pipeline-trigger-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useSearchParams for URL-persisted filter state in list pages"
    - "Link rows with hover:bg-accent hover:shadow-md hover:-translate-y-0.5 for clickable list items"
    - "Lazy-imported route components in index.tsx"
    - "PipelineStateBadge exported from pipelines.tsx for reuse in detail page"

key-files:
  created:
    - apps/dashboard/src/routes/pipeline-detail.tsx
    - apps/dashboard/src/components/pipelines/stage-progress.tsx
    - apps/dashboard/src/__tests__/pages/pipelines.test.tsx
  modified:
    - apps/dashboard/src/routes/pipelines.tsx
    - apps/dashboard/src/routes/index.tsx

key-decisions:
  - "PipelineStateBadge exported from pipelines.tsx so pipeline-detail.tsx can import it without circular deps"
  - "Stage progress components moved to components/pipelines/stage-progress.tsx for Phase 6 reuse"
  - "Filter uses useSearchParams (URL state) matching the goals.tsx pattern for consistency"
  - "Test for state badge uses getAllByText instead of getByText to handle duplicate text in select options"

patterns-established:
  - "Pipeline route pattern: list at /dashboard/pipelines, detail at /dashboard/pipelines/:jobId"
  - "State badge helper: PipelineStateBadge + stateConfig in pipelines.tsx"
  - "formatDuration(startIso, endIso): local helper for human-readable durations"

requirements-completed: [NAV-01, NAV-02, LIST-01, LIST-02, LIST-03, LIST-04]

# Metrics
duration: 6min
completed: 2026-03-09
---

# Phase 05 Plan 01: Pipeline List + Navigation Summary

**Pipeline list page rewritten with URL-persisted state filter, Link rows to /dashboard/pipelines/:jobId, auto-refresh indicator, and detail route stub registered in React Router**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-09T14:30:26Z
- **Completed:** 2026-03-09T14:36:26Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Replaced expand/collapse card layout with clickable Link rows (goals.tsx pattern)
- Added state filter dropdown persisted in URL via useSearchParams (all/waiting/active/completed/failed)
- Extracted StageProgress/StageIcon to components/pipelines/stage-progress.tsx for Phase 6 reuse
- Created PipelineDetailPage stub at /dashboard/pipelines/:jobId with back navigation
- Registered pipelines/:jobId route in router via lazy import
- 10 tests covering all scenarios: render, state badges, stage count, links, loading, error, empty, filter, auto-refresh

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite pipeline list page** - `1e2f1be` (feat)
2. **Task 2: Create pipeline detail route stub and register in router** - `262169c` (feat)
3. **Task 3: Add tests for pipeline list page and navigation** - `b3619df` (test)

## Files Created/Modified
- `apps/dashboard/src/routes/pipelines.tsx` - Rewritten: Link rows, state filter, formatDuration, auto-refresh text
- `apps/dashboard/src/routes/pipeline-detail.tsx` - New: detail stub with state badge, stage count, back link
- `apps/dashboard/src/routes/index.tsx` - Added PipelineDetailPage lazy import and pipelines/:jobId route
- `apps/dashboard/src/components/pipelines/stage-progress.tsx` - New: StageProgress and StageIcon extracted here
- `apps/dashboard/src/__tests__/pages/pipelines.test.tsx` - New: 10 tests for list page

## Decisions Made
- Exported `PipelineStateBadge` from `pipelines.tsx` so the detail page can import it without circular dependencies
- Used `data.stages.length` in detail page since `PipelineDetail` has `stages[]` array (not `stageCount`)
- Used `getAllByText` in badge test because "Completed/Failed" appear in both Select options and badge elements

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] PipelineDetail has stages array, not stageCount property**
- **Found during:** Task 2 (Create pipeline detail route stub)
- **Issue:** TypeScript compile error — `PipelineDetail` type has `stages: PipelineStageDefinition[]`, not `stageCount: number`
- **Fix:** Changed `data.stageCount` to `data.stages.length` in pipeline-detail.tsx
- **Files modified:** apps/dashboard/src/routes/pipeline-detail.tsx
- **Verification:** `tsc --noEmit` compiles clean
- **Committed in:** 262169c (Task 2 commit)

**2. [Rule 1 - Bug] getByText failed on badge text due to duplicate in Select options**
- **Found during:** Task 3 (Add tests)
- **Issue:** `screen.getByText("Completed")` threw "multiple elements found" since Select dropdown has "Completed" option and the badge also renders "Completed"
- **Fix:** Changed to `screen.getAllByText("Completed").length >= 1` pattern
- **Files modified:** apps/dashboard/src/__tests__/pages/pipelines.test.tsx
- **Verification:** All 10 pipeline tests pass, 90 total dashboard tests pass
- **Committed in:** b3619df (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** Both auto-fixes necessary for TypeScript correctness and test correctness. No scope creep.

## Issues Encountered
None beyond the two auto-fixed bugs documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline list and navigation fully functional
- StageProgress/StageIcon components ready for import in Phase 6
- PipelineStateBadge exported and usable in Phase 6 detail view
- usePipeline hook already has refetchInterval: 5000 (pauses when completed/failed)

## Self-Check: PASSED

- FOUND: apps/dashboard/src/routes/pipelines.tsx
- FOUND: apps/dashboard/src/routes/pipeline-detail.tsx
- FOUND: apps/dashboard/src/routes/index.tsx (contains "pipelines/:jobId")
- FOUND: apps/dashboard/src/components/pipelines/stage-progress.tsx
- FOUND: apps/dashboard/src/__tests__/pages/pipelines.test.tsx
- FOUND: .planning/phases/05-pipeline-list-navigation/05-01-SUMMARY.md
- FOUND commit: 1e2f1be (Task 1)
- FOUND commit: 262169c (Task 2)
- FOUND commit: b3619df (Task 3)

---
*Phase: 05-pipeline-list-navigation*
*Completed: 2026-03-09*
