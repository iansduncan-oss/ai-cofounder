---
phase: 08-memory-session-foundation
plan: "02"
subsystem: decision-pipeline
tags: [decision-extraction, llm-extraction, bullmq, proactive-surfacing, mem-02, sess-02]
dependency_graph:
  requires: [08-01]
  provides: [DecisionExtractorService, extract_decision BullMQ job, proactive decision surfacing]
  affects:
    - apps/agent-server/src/services/decision-extractor.ts
    - apps/agent-server/src/routes/agents.ts
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/agents/prompts/system.ts
    - packages/queue/src/queues.ts
    - apps/agent-server/src/plugins/queue.ts
tech_stack:
  added: [DecisionExtractorService]
  patterns: [LLM extraction via Groq simple task, fire-and-forget BullMQ enqueue, decision category filtering in memory context]
key_files:
  created:
    - apps/agent-server/src/services/decision-extractor.ts
    - apps/agent-server/src/__tests__/decision-extractor.test.ts
  modified:
    - packages/queue/src/queues.ts
    - apps/agent-server/src/plugins/queue.ts
    - apps/agent-server/src/routes/agents.ts
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/agents/prompts/system.ts
decisions:
  - "Use existing reflection queue for extract_decision jobs rather than a new queue — reuses worker infrastructure with zero new BullMQ setup"
  - "Short responses (< 100 chars) skip extraction — avoids burning Groq tokens on trivial acknowledgements"
  - "Decision surfacing as a named section ('Past decisions relevant to this topic') — makes it explicit for the LLM vs relying on category tag in existing memory context"
metrics:
  duration_minutes: 20
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 5
  tests_added: 6
  completed_date: "2026-03-10"
---

# Phase 8 Plan 02: Decision Auto-Detection Pipeline Summary

**One-liner:** LLM-powered decision extraction via Groq after every agent response with proactive surfacing of past decisions as a labeled context block in the system prompt (MEM-02, SESS-02).

## What Was Built

### DecisionExtractorService

`apps/agent-server/src/services/decision-extractor.ts` — New service class:

- `extractAndStore(response, userId, conversationId?)` method:
  - Skips responses under 100 chars (trivial acknowledgements)
  - Truncates response to 2000 chars before sending to Groq (`"simple"` task category)
  - Parses JSON from LLM response: `{ hasDecision, title, decision, rationale, alternatives }`
  - If decision found: optionally generates embedding, saves via `saveMemory(db, { category: "decisions", metadata: { rationale, alternatives, conversationId, extractedAt } })`
  - Entire method wrapped in try/catch — never throws, logs errors as warn
- Exports `DECISION_EXTRACTION_PROMPT` constant for testability

### BullMQ Integration (packages/queue + plugins/queue.ts)

**ReflectionJob type extended** (`packages/queue/src/queues.ts`):
- Added `"extract_decision"` to the `action` union type
- Added optional fields: `response?: string`, `userId?: string`, `conversationId?: string`

**Reflection worker** (`apps/agent-server/src/plugins/queue.ts`):
- New `case "extract_decision"`: dynamically imports `DecisionExtractorService` and calls `extractAndStore()`

### Route Integration (agents.ts)

Both `/run` and `/run/stream` handlers now fire-and-forget decision extraction after every response:
```typescript
if (redisEnabled && dbUserId) {
  const { getReflectionQueue } = await import("@ai-cofounder/queue");
  getReflectionQueue().add("extract-decision", {
    action: "extract_decision",
    response: result.response,
    userId: dbUserId,
    conversationId: result.conversationId,
  }).catch(() {}); // fire-and-forget
}
```

Uses dynamic import of `getReflectionQueue` to avoid import issues when Redis is unavailable.

### Proactive Decision Surfacing (orchestrator.ts — SESS-02)

After the existing memory merge logic, a new block filters relevant memories by `category === "decisions"` and adds a labeled section to `memoryContext`:

```
Past decisions relevant to this topic (reference these naturally when applicable):
- Use Postgres: Going with Postgres for the main database
```

This is injected into the system prompt via the existing `buildSystemPrompt(memoryContext)` path.

### Behavioral Guidelines Update (prompts/system.ts)

Added a new bullet to `BEHAVIORAL_GUIDELINES`:
> When you notice a decision in the memory context is relevant to the current discussion, reference it naturally: "Since we decided to go with X last time..." or "That aligns with the earlier call to use Y." Don't force it -- only when genuinely relevant.

## Tests

### apps/agent-server/src/__tests__/decision-extractor.test.ts (6 tests)

**decision extraction:**
1. Extracts and stores decision from response with decision language — verifies saveMemory called with category:"decisions", correct metadata including rationale/alternatives/conversationId/extractedAt
2. Skips extraction for short responses (< 100 chars) — LLM NOT called
3. Handles no-decision response gracefully — saveMemory NOT called
4. Handles LLM parse failure gracefully — no exception, saveMemory NOT called
5. Truncates long responses to 2000 chars before sending to LLM — verifies 5000-char response truncated

**proactive reference:**
6. Orchestrator includes decision memories in a separate section — mocks searchMemoriesByVector to return a decision memory, verifies system prompt contains "Past decisions relevant to this topic" with memory content

## Deviations from Plan

None — plan executed exactly as written.

The build failure in `reflection.ts` (TS2345: drizzle-orm SQL type declaration collision via dynamic import) is a pre-existing issue unrelated to this plan's changes. It was present before this plan and is documented in deferred-items.md scope boundary log.

## Self-Check

**Files created:**
- apps/agent-server/src/services/decision-extractor.ts — FOUND
- apps/agent-server/src/__tests__/decision-extractor.test.ts — FOUND

**Commits:**
- fb406e0 feat(08-02): add DecisionExtractorService and BullMQ extract_decision integration — FOUND
- 2027a72 feat(08-02): add proactive decision surfacing in orchestrator and decision extractor tests — FOUND

**Tests:**
- decision extraction: 5/5 PASS
- proactive reference: 1/1 PASS
- All 31 orchestrator + decision-extractor + conversation-ingestion tests: PASS

## Self-Check: PASSED
