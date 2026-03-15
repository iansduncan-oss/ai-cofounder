---
phase: 13-financial-tracking
plan: 03
subsystem: llm
tags: [llm, cost-tracking, hook, registry, onCompletion]

# Dependency graph
requires:
  - phase: 13-financial-tracking
    provides: recordLlmUsage DB function and llmUsage table
provides:
  - LlmRegistry.onCompletion callback hook
  - Automatic LLM cost recording for every registry.complete() call via server.ts wiring
  - CompletionMetadata type for attribution pass-through
  - CompletionEvent and OnCompletionCallback types
affects: [agent-server, orchestrator, dispatcher, specialists, briefing, journal, suggestions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onCompletion hook pattern: registry.onCompletion set once in server.ts, fires for every complete() call"
    - "CompletionMetadata pass-through: callers attach agentRole/conversationId/goalId to registry.complete() requests"
    - "Fire-and-forget with swallowed errors: hook errors never propagate to LLM caller"

key-files:
  created:
    - apps/agent-server/src/__tests__/llm-usage-hook.test.ts
  modified:
    - packages/llm/src/types.ts
    - packages/llm/src/registry.ts
    - packages/llm/src/index.ts
    - apps/agent-server/src/server.ts
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/agents/dispatcher.ts
    - apps/agent-server/src/routes/agents.ts
    - apps/agent-server/src/routes/voice.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Hook fires synchronously but DB recording is fire-and-forget (.catch(() => {})) — hook errors never block LLM responses"
  - "metadata field on LlmCompletionRequest is ignored by providers (stripped from forwarded request) but passes through registry to onCompletion"
  - "Orchestrator passes agentRole + conversationId in all 4 registry.complete() calls — specialist goalId/taskId attribution deferred (requires threading through execute() chain)"
  - "Manual recordLlmUsage calls removed from routes/agents.ts (2), routes/voice.ts (1), dispatcher.ts (2) — hook provides 100% coverage"

patterns-established:
  - "New registry.complete() callers do NOT need to record LLM usage — hook handles it automatically"
  - "Attribution metadata (agentRole, goalId, etc.) should be added to registry.complete() calls at callers that have that context"

requirements-completed: [FIN-01]

# Metrics
duration: 6min
completed: 2026-03-15
---

# Phase 13 Plan 03: LlmRegistry onCompletion Hook Summary

**LlmRegistry.onCompletion hook wires automatic cost recording via recordLlmUsage() for every registry.complete() call — 100% coverage with zero per-site maintenance**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-15T16:08:50Z
- **Completed:** 2026-03-15T16:15:00Z
- **Tasks:** 2/2
- **Files modified:** 9

## Accomplishments

- Added `onCompletion?: OnCompletionCallback` property to `LlmRegistry` — fires after every successful `complete()` with full cost data
- Wired the hook once in `server.ts` to call `recordLlmUsage(app.db, ...)` — all 15+ call sites across orchestrator, specialists, briefing, journal, suggestions, etc. now record automatically
- Removed 5 manual `recordLlmUsage()` calls (2 from routes/agents.ts, 1 from routes/voice.ts, 2 from dispatcher.ts) that caused double-counting risk
- Added `CompletionMetadata` type and `metadata` field to `LlmCompletionRequest` for attribution pass-through
- Added metadata to all 4 orchestrator `registry.complete()` calls (agentRole + conversationId)
- All 6 hook behavior tests pass (TDD, RED then GREEN)
- FIN-01 marked complete in REQUIREMENTS.md

## Task Commits

Each task was committed atomically:

1. **Task 1: Add onCompletion hook to LlmRegistry and wire in server.ts** - `868f244` (feat)
2. **Task 2: Add metadata to key callers, remove manual recording, update REQUIREMENTS.md** - `f856fab` (feat)

## Files Created/Modified

- `packages/llm/src/types.ts` — Added `CompletionMetadata` interface and `metadata?` field on `LlmCompletionRequest`
- `packages/llm/src/registry.ts` — Added `CompletionEvent`, `OnCompletionCallback` types, `onCompletion?` property, hook invocation in `complete()`
- `packages/llm/src/index.ts` — Exported `CompletionMetadata`, `CompletionEvent`, `OnCompletionCallback`
- `apps/agent-server/src/server.ts` — Wired `llmRegistry.onCompletion` to call `recordLlmUsage(app.db, ...)`, imported `recordLlmUsage` and `CompletionEvent`
- `apps/agent-server/src/agents/orchestrator.ts` — Added `metadata: { agentRole: "orchestrator", conversationId: id }` to all 4 `registry.complete()` calls in `run()` and `runStream()`
- `apps/agent-server/src/agents/dispatcher.ts` — Removed `recordLlmUsage` import and 2 manual recording blocks (success path + retry path)
- `apps/agent-server/src/routes/agents.ts` — Removed `recordLlmUsage` import and 2 manual recording blocks (`/run` and `/run/stream`)
- `apps/agent-server/src/routes/voice.ts` — Removed `recordLlmUsage` import and manual recording block (`/chat`)
- `apps/agent-server/src/__tests__/llm-usage-hook.test.ts` — New: 6 TDD tests for hook behavior (created, fires, doesn't fire on error, swallows sync/async throws, passes metadata, works with no hook)
- `.planning/REQUIREMENTS.md` — FIN-01 marked `[x]` and traceability table updated to `Complete`

## Decisions Made

- Hook fires synchronously but DB recording is fire-and-forget (`.catch(() => {})`) — hook errors never block LLM responses
- `metadata` field on `LlmCompletionRequest` is ignored by providers (only `model/system/messages/tools/max_tokens/temperature` are forwarded) but passes through the registry to `onCompletion`
- Orchestrator passes `agentRole + conversationId` in all 4 `registry.complete()` calls — specialist `goalId/taskId` attribution deferred (requires threading through `execute()` chain, out of scope for FIN-01)
- Manual `recordLlmUsage` calls removed from routes/agents.ts (2), routes/voice.ts (1), dispatcher.ts (2) — hook provides 100% coverage without per-site maintenance

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `apps/agent-server` build has pre-existing errors (websocket plugin types, reflection.ts drizzle issue, distributed-lock.ts, memory-consolidation.ts) — all verified pre-existing via `git stash` test, none caused by this plan's changes. Files modified in this plan compile cleanly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FIN-01 fully closed — all LLM calls in the system now record cost to DB automatically
- Phase 13 complete (all 3 plans: schema+services, API+UI, gap closure)
- Future specialist attribution (goalId/taskId) can be added incrementally by threading metadata through `specialist.execute()` — not required for FIN-01

## Self-Check: PASSED

- packages/llm/src/types.ts: FOUND
- packages/llm/src/registry.ts: FOUND
- apps/agent-server/src/server.ts: FOUND
- apps/agent-server/src/__tests__/llm-usage-hook.test.ts: FOUND
- .planning/phases/13-financial-tracking/13-03-SUMMARY.md: FOUND
- Commit 868f244 (Task 1): FOUND
- Commit f856fab (Task 2): FOUND

---
*Phase: 13-financial-tracking*
*Completed: 2026-03-15*
