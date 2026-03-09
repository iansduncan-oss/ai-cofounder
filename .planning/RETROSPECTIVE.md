# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — Pipeline Dashboard UI

**Shipped:** 2026-03-09
**Phases:** 3 | **Plans:** 4 | **Sessions:** 1

### What Was Built
- Pipeline list page with state filtering, timing, and clickable row navigation
- Pipeline detail page with metadata card, expandable stage rows, auto-refresh
- Two-mode pipeline submission dialog (goal-based + custom-stage builder)
- 28 new dashboard tests covering all 15 requirements

### What Worked
- 3-phase structure (list → detail → trigger) mapped cleanly to natural delivery boundaries
- Extracting shared components in Phase 5 (StageIcon, PipelineStateBadge) paid off immediately in Phase 6
- Milestone audit caught minor tech debt proactively before archival
- All 15 requirements satisfied with zero gaps — clean audit pass
- ~3.5 hours from milestone start to completion including all 3 phases

### What Was Inefficient
- formatDuration helper had to be duplicated across routes to avoid circular deps — could be a shared utility
- Phase 6 SC3 documentation was written too specifically (per-stage timing) vs what backend supported (overall duration), requiring a gap closure plan
- StageProgress component extracted for Phase 6 reuse but Phase 6 chose a richer accordion layout — dead export
- Nyquist validation not signed off on 2 of 3 phases (process gap, not quality gap)

### Patterns Established
- URL-persisted filter state via useSearchParams for list pages
- Two-mode dialog pattern: segmented toggle with separate forms per mode
- Mutation responsibility split: navigation in callsite onSuccess, toast/invalidation in hook onSuccess
- Map<stageIndex, result> pattern for keying stage results by index
- handleClose resets all form state to prevent stale data on dialog reopen

### Key Lessons
1. Write success criteria that match backend capabilities — don't specify per-stage timing if the API only exposes overall duration
2. Extract shared components early (Phase 5 → 6) but accept some dead code when later phases take a different approach
3. Route-to-route imports create circular dependency risk — local utility duplication is pragmatic

### Cost Observations
- Model mix: balanced profile (sonnet-dominant for planning/execution)
- Sessions: 1 session, ~3.5 hours
- Notable: Fast execution due to dashboard-only scope (no backend changes needed)

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | 2 | 4 | Established GSD workflow, first use of audit |
| v1.1 | 1 | 3 | Faster execution, clean audit pass, yolo mode |

### Cumulative Quality

| Milestone | Tests | Dashboard Tests | Phases |
|-----------|-------|-----------------|--------|
| v1.0 | ~960 | 80 | 4 |
| v1.1 | ~960 | 108 | 3 |

### Top Lessons (Verified Across Milestones)

1. Small, focused milestones (3-4 phases) execute faster and cleaner than large ones
2. Extract shared components early in the milestone, accept minor dead code
3. Documentation should match actual implementation scope, not aspirational scope
