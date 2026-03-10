---
phase: 09-autonomy-approval-system
plan: 01
subsystem: api
tags: [autonomy, tiers, approvals, enforcement, drizzle, postgresql, bullmq]

# Dependency graph
requires:
  - phase: 08-memory-session-foundation
    provides: SessionContextService, MemoryConsolidationService, DB schema

provides:
  - AutonomyTierService with in-memory Map cache and DB-backed reload
  - Tool tier enforcement (green=pass, yellow=approval+poll, red=block)
  - toolTierConfig DB table with autonomyTierEnum
  - 33 default tool configs seeded at green on first server start
  - approvals.taskId made nullable for ad-hoc tool approvals
  - REST API: GET/PUT /api/autonomy/tiers
  - Approval timeout sweep (BullMQ job, every 60s)
  - ApiClient methods: listToolTierConfig, updateToolTier
affects:
  - 09-02 (approval REST API, dashboard settings)
  - All future plans that add new tools (must add to DEFAULT_TOOLS)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Tier enforcement via Map.get() with 'green' default — zero-overhead for unconfigured tools"
    - "Yellow-tier uses DB polling (2s interval) with fake-timer-compatible setTimeout"
    - "Red-tier strips tool from LLM tool list AND hard-blocks in executor (defense-in-depth)"
    - "Autonomy tier service initialized in onReady hook after DB is ready"
    - "All route Orchestrator instantiations receive autonomyTierService from app decorator"

key-files:
  created:
    - apps/agent-server/src/services/autonomy-tier.ts
    - apps/agent-server/src/__tests__/autonomy-tier.test.ts
    - apps/agent-server/src/routes/autonomy.ts
  modified:
    - packages/db/src/schema.ts
    - packages/db/src/repositories.ts
    - packages/test-utils/src/mocks/db.ts
    - apps/agent-server/src/agents/tool-executor.ts
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/server.ts
    - apps/agent-server/src/routes/agents.ts
    - apps/agent-server/src/routes/voice.ts
    - apps/agent-server/src/routes/n8n.ts
    - apps/agent-server/src/plugins/jwt-guard.ts
    - apps/agent-server/src/plugins/queue.ts
    - packages/api-client/src/client.ts
    - packages/api-client/src/types.ts
    - packages/queue/src/queues.ts

key-decisions:
  - "approvals.taskId is nullable — yellow-tier tools can fire outside goal execution context"
  - "Default tier for unconfigured tools is green — backward compatible, zero-latency"
  - "Yellow-tier polling interval is 2000ms — reasonable UX without excessive DB load"
  - "Seed all 33 known tools at green on first start — dashboard settings page not empty"
  - "Defense-in-depth: red tools stripped from LLM tool list AND blocked in executor"
  - "autonomyTierService as optional constructor param — existing tests need no changes"

patterns-established:
  - "Tier enforcement: AutonomyTierService.getTier() called per-tool in executeWithTierCheck"
  - "Red-tier exclusion: buildSharedToolList accepts optional AutonomyTierService to filter"
  - "Yellow-tier workflow: createApproval -> notifyApprovalCreated -> poll getApproval"

requirements-completed: [AUTO-01, AUTO-02, AUTO-03]

# Metrics
duration: 41min
completed: 2026-03-10
---

# Phase 09 Plan 01: Autonomy Tier Enforcement Engine Summary

**AutonomyTierService with green/yellow/red tier enforcement — green passes through instantly, yellow blocks for approval with DB polling, red is stripped from LLM tool list and hard-blocked in executor**

## Performance

- **Duration:** 41 min
- **Started:** 2026-03-10T13:43:19Z
- **Completed:** 2026-03-10T14:24:00Z
- **Tasks:** 2/2
- **Files modified:** 17

## Accomplishments

- Built AutonomyTierService with DB-backed in-memory Map cache (zero-overhead getTier lookup)
- Implemented three-tier enforcement: green=immediate, yellow=approval+poll+timeout, red=block
- Added toolTierConfig DB table with autonomyTierEnum, seeded 33 tools at green on first start
- Made approvals.taskId nullable so yellow-tier tools work outside goal execution context
- Wired tier service into Orchestrator constructor, all route Orchestrator instantiations, server onReady hook
- Added REST endpoints GET/PUT /api/autonomy/tiers and ApiClient methods
- Added BullMQ approval timeout sweep job (every 60s, auto-denies expired approvals)
- 15 tests passing covering all tier behaviors + backward compat

## Task Commits

1. **Task 1: DB schema + repo functions + mock updates** - `37ddeba` (feat)
2. **Task 2: AutonomyTierService + enforcement + orchestrator + tests** - `5e5a628`, `2e243a0` (feat)
3. **Hook improvements** - `8afffc9` (chore)

## Files Created/Modified

- `packages/db/src/schema.ts` - Added autonomyTierEnum + toolTierConfig table, nullable approvals.taskId
- `packages/db/src/repositories.ts` - Added listToolTierConfigs, getToolTierConfig, upsertToolTierConfig, listExpiredPendingApprovals; optional taskId on createApproval
- `packages/test-utils/src/mocks/db.ts` - Added 4 new mock functions + toolTierConfig table ref
- `apps/agent-server/src/services/autonomy-tier.ts` - AutonomyTierService with load/getTier/getTimeoutMs/getAllRed/reload
- `apps/agent-server/src/agents/tool-executor.ts` - Added autonomyTierService to ToolExecutorServices, executeWithTierCheck, executeYellowTierTool, red-tier exclusion in buildSharedToolList
- `apps/agent-server/src/agents/orchestrator.ts` - Optional autonomyTierService param, uses executeWithTierCheck, passes tierService to buildSharedToolList
- `apps/agent-server/src/server.ts` - Creates AutonomyTierService in onReady, seeds DEFAULT_TOOLS, decorates app
- `apps/agent-server/src/routes/autonomy.ts` - GET/PUT /api/autonomy/tiers REST endpoints
- `apps/agent-server/src/plugins/queue.ts` - Approval timeout sweep handler
- `packages/api-client/src/client.ts` - listToolTierConfig, updateToolTier methods
- `apps/agent-server/src/__tests__/autonomy-tier.test.ts` - 15 tests covering all tier behaviors

## Decisions Made

- **approvals.taskId nullable**: Yellow-tier tools fire mid-conversation without a goal/task context. Removing notNull allows ad-hoc approvals. FK still present when taskId is available.
- **Default green tier**: Unconfigured tools default to green (Map.get returns undefined -> "green"). Zero latency impact, fully backward compatible with existing tests.
- **2000ms poll interval**: Balances responsiveness for approvals (user sees prompt quickly) vs DB load.
- **Defense-in-depth for red**: Tool removed from LLM tool list AND executor blocks with error. Even if LLM somehow sends a red-tier tool call, it gets blocked.
- **Optional constructor param**: `autonomyTierService?: AutonomyTierService` in Orchestrator — existing 18 orchestrator tests pass unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added REST API endpoints and ApiClient methods**
- **Found during:** Task 2 (server.ts wiring) — hooks auto-generated these
- **Issue:** Plan mentioned dashboard settings page needing tier data; REST API needed
- **Fix:** Claude Code scaffold-endpoint hook auto-created autonomy.ts route, jwt-guard wiring, and ApiClient methods
- **Files modified:** apps/agent-server/src/routes/autonomy.ts, jwt-guard.ts, packages/api-client/src/client.ts, types.ts, index.ts
- **Verification:** Routes registered, ApiClient methods present
- **Committed in:** 2e243a0

**2. [Rule 2 - Missing Critical] Added BullMQ approval timeout sweep**
- **Found during:** Task 2 hooks
- **Issue:** listExpiredPendingApprovals was created but needed to be called somewhere
- **Fix:** Hook added approval_timeout_sweep job to queue plugin and MonitoringJob type
- **Files modified:** apps/agent-server/src/plugins/queue.ts, packages/queue/src/queues.ts, packages/queue/src/scheduler.ts
- **Committed in:** 2e243a0

---

**Total deviations:** 2 auto-fixed via Claude Code hooks (1 missing API layer, 1 missing queue wiring)
**Impact on plan:** Both add-ons are directly related to the plan's deliverables and make the system more complete. No scope creep.

## Issues Encountered

- db:push required DATABASE_URL from .env (second attempt with env picked it up correctly)
- Pre-existing test failures in summarizer, e2e-full-workflow, and rag-routes are unrelated to this plan

## Next Phase Readiness

- Tier enforcement engine complete and tested; Plan 02 can build approval REST CRUD on top
- GET /api/autonomy/tiers already available for Plan 05 dashboard settings page
- All 33 default tools seeded at green; dashboard settings page will show non-empty state
- approvals.taskId nullable — no FK constraint issues for yellow-tier ad-hoc approvals

---
*Phase: 09-autonomy-approval-system*
*Completed: 2026-03-10*
