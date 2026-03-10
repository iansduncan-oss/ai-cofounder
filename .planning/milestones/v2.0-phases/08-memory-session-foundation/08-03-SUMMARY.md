---
phase: 08-memory-session-foundation
plan: "03"
subsystem: session-context-and-memory-consolidation
tags: [session-context, memory-consolidation, bullmq, orchestrator, mem-04, mem-05, sess-01]
dependency_graph:
  requires: [08-01, 08-02]
  provides: [SessionContextService, MemoryConsolidationService, weekly-memory-consolidation BullMQ job]
  affects:
    - apps/agent-server/src/services/session-context.ts
    - apps/agent-server/src/services/memory-consolidation.ts
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/plugins/queue.ts
    - packages/queue/src/queues.ts
    - packages/queue/src/scheduler.ts
tech_stack:
  added: [SessionContextService, MemoryConsolidationService]
  patterns: [per-user memory clustering via LLM, session context prepend, consolidate_memories BullMQ job, jsonb metadata flag for deduplication]
key_files:
  created:
    - apps/agent-server/src/services/session-context.ts
    - apps/agent-server/src/services/memory-consolidation.ts
    - apps/agent-server/src/__tests__/session-context.test.ts
    - apps/agent-server/src/__tests__/memory-consolidation.test.ts
  modified:
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/plugins/queue.ts
    - packages/queue/src/queues.ts
    - packages/queue/src/scheduler.ts
decisions:
  - "Session context prepended before memory context so it appears first in system prompt — gives LLM clear temporal orientation"
  - "recallMemories limit reduced from 20 to 10 to compensate for added session context tokens (~180 tokens for 3 x 250-char summaries)"
  - "Per-user scoping for consolidation ensures composite memories always have an unambiguous userId — never mix users in a cluster"
  - "Use COALESCE jsonb merge operator to safely update metadata flag without overwriting existing metadata fields"
metrics:
  duration_minutes: 20
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 4
  tests_added: 8
  completed_date: "2026-03-10"
---

# Phase 8 Plan 03: Session Context Injection and Memory Consolidation Summary

**One-liner:** Session context injection prepends last-3 conversation summaries into system prompt at ~800-token cap, plus weekly LLM-powered per-user memory consolidation via BullMQ (MEM-04, MEM-05, SESS-01).

## What Was Built

### SessionContextService

`apps/agent-server/src/services/session-context.ts` — New service class:

- `getRecentContext(userId, limit = 3): Promise<string | null>` method:
  - Calls `getRecentSessionSummaries(db, userId, limit)` (implemented in Plan 01)
  - Returns null if no summaries found
  - Formats a structured block with a header `## Recent Sessions`
  - Labels: "Session 1 (most recent):", "Session 2:", "Session 3:"
  - Truncates each summary to 250 characters (~60 tokens each)
  - Total token cost: ~180 tokens for 3 summaries — well within 800 token cap
  - Errors caught internally, logs at warn level, never throws

### Orchestrator Update (orchestrator.ts)

Two changes to `apps/agent-server/src/agents/orchestrator.ts`:

1. **Session context injection** — After the decision surfacing block in `run()`, a new block:
   ```typescript
   // Session continuity context (MEM-04, SESS-01)
   if (userId && this.db) {
     try {
       const sessionContextService = new SessionContextService(this.db);
       const sessionBlock = await sessionContextService.getRecentContext(userId);
       if (sessionBlock) {
         memoryContext = sessionBlock + (memoryContext ? `\n\n${memoryContext}` : "");
       }
     } catch (err) {
       this.logger.warn({ err }, "session context retrieval failed (non-fatal)");
     }
   }
   ```
   This prepends session context before all other memory context.

2. **recallMemories limit reduced** — From 20 to 10 in both `run()` and `runStream()` to compensate for the additional session context tokens.

### MemoryConsolidationService

`apps/agent-server/src/services/memory-consolidation.ts` — New service class:

- `consolidate(): Promise<{ consolidated: number; created: number }>` method:
  1. Gets distinct userIds with non-consolidated memories via `selectDistinct`
  2. For each userId, fetches up to 100 non-consolidated memories (ordered by recency)
  3. Skips users with fewer than 5 memories
  4. Groups memories by category, processes each category with 3+ members
  5. Sends category memories to LLM (`"simple"` task) with clustering prompt
  6. Parses JSON response: `{ clusters: [{ title, summary, memberIds }] }`
  7. For each cluster with 2+ valid member IDs:
     - Saves a composite memory via `saveMemory()` with `importance: 9` and `metadata.consolidated_from`
     - Updates each constituent memory with `metadata.consolidated = "true"` and `metadata.consolidatedInto`
  8. Returns totals across all users
  9. Per-user scoping: constituent memories are validated against the user's own memory IDs — prevents cross-user contamination

### BullMQ Integration

**ReflectionJob type extended** (`packages/queue/src/queues.ts`):
- Added `"consolidate_memories"` to the action union type

**Reflection worker** (`apps/agent-server/src/plugins/queue.ts`):
- New `case "consolidate_memories"`: dynamically imports `MemoryConsolidationService` and calls `consolidate()`

**Scheduler** (`packages/queue/src/scheduler.ts`):
- New `"weekly-memory-consolidation"` job scheduled for Sunday 4 AM (cron: `0 4 * * 0`)
- Uses `briefingTimezone` for consistent timezone handling

## Tests

### apps/agent-server/src/__tests__/session-context.test.ts (4 tests)

**session context:**
1. Returns formatted session context for user with recent summaries — verifies "## Recent Sessions" header and all 3 session labels appear
2. Returns null when no summaries exist — mock returns []
3. Truncates long summaries to ~250 chars — mock with 1000-char summary, verifies truncation
4. Orchestrator injects session context before memory context — verifies prepend behavior puts session block at index 0

### apps/agent-server/src/__tests__/memory-consolidation.test.ts (4 tests)

**consolidation:**
1. Skips consolidation when fewer than 5 non-consolidated memories per user — LLM NOT called, returns `{consolidated: 0, created: 0}`
2. Consolidates related memories per-user into composite entries — LLM returns cluster JSON, verifies `saveMemory` called with correct userId, category, importance:9, and consolidated_from metadata
3. Marks constituent memories with consolidated flag — verifies `db.update` called 3 times for a 3-member cluster
4. Handles LLM failure gracefully — LLM throws, no exception propagates, returns `{consolidated: 0, created: 0}`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] selectDistinct chain needs terminal at .where() not .limit()**
- **Found during:** Task 2 (test debugging)
- **Issue:** The original test mock used a chain with `limit()` as terminal, but `selectDistinct` in the service doesn't call `.limit()` — the terminal is `.where()`. This caused mock to return the chain object instead of the resolved rows.
- **Fix:** Rewrote test helper `createMockDb()` to correctly separate `selectDistinct` chain (terminates at `.where()`) from `select` chain (terminates at `.limit()`), matching the actual Drizzle call patterns in the service.
- **Files modified:** apps/agent-server/src/__tests__/memory-consolidation.test.ts
- **Commit:** part of a67ee73

## Self-Check

**Files created:**
- apps/agent-server/src/services/session-context.ts — FOUND
- apps/agent-server/src/services/memory-consolidation.ts — FOUND
- apps/agent-server/src/__tests__/session-context.test.ts — FOUND
- apps/agent-server/src/__tests__/memory-consolidation.test.ts — FOUND

**Files modified:**
- apps/agent-server/src/agents/orchestrator.ts — FOUND (import + injection + limit change)
- apps/agent-server/src/plugins/queue.ts — FOUND (consolidate_memories case)
- packages/queue/src/queues.ts — FOUND (consolidate_memories in union)
- packages/queue/src/scheduler.ts — FOUND (weekly-memory-consolidation job)

**Commits:**
- 504e1b6 feat(08-03): add SessionContextService and inject session context into orchestrator — FOUND
- a67ee73 feat(08-03): add MemoryConsolidationService and weekly BullMQ consolidation job — FOUND

**Tests:**
- session context: 4/4 PASS
- consolidation: 4/4 PASS

## Self-Check: PASSED
