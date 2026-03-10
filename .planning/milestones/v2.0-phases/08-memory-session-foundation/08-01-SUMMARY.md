---
phase: 08-memory-session-foundation
plan: "01"
subsystem: memory-pipeline
tags: [rag, conversation-ingestion, summarization, git-clone, mem-01, mem-03]
dependency_graph:
  requires: []
  provides: [ConversationIngestionService, getRecentSessionSummaries]
  affects: [apps/agent-server/src/routes/agents.ts, apps/agent-server/src/agents/tool-executor.ts]
tech_stack:
  added: [ConversationIngestionService]
  patterns: [fire-and-forget ingestion, eager summarization, BullMQ enqueue]
key_files:
  created:
    - apps/agent-server/src/services/conversation-ingestion.ts
    - apps/agent-server/src/__tests__/conversation-ingestion.test.ts
    - packages/db/src/__tests__/repositories-session.test.ts
  modified:
    - apps/agent-server/src/routes/agents.ts
    - apps/agent-server/src/agents/tool-executor.ts
    - packages/db/src/repositories.ts
    - packages/test-utils/src/mocks/db.ts
decisions:
  - "Use message count < 30 threshold to decide between eager and lazy summarization"
  - "AgentMessage interface requires id/conversationId/createdAt — used temporary placeholder IDs for eager summary messages"
  - "fire-and-forget with .catch(() => {}) for all RAG enqueue calls to prevent blocking agent responses"
metrics:
  duration_minutes: 35
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 5
  tests_added: 13
  completed_date: "2026-03-10"
---

# Phase 8 Plan 01: Conversation Auto-Ingestion Pipeline Summary

**One-liner:** Eager summarization + RAG enqueue for short conversations and automatic repo doc ingestion on git_clone, enabling sub-30s conversation memory pipeline (MEM-01, MEM-03).

## What Was Built

### ConversationIngestionService

`apps/agent-server/src/services/conversation-ingestion.ts` — New service class with `ingestAfterResponse(conversationId, userMessage, agentResponse)` method:

- Checks message count for the conversation
- If count < 30 (short conversations not covered by the lazy path): calls `summarizeMessages()` to eagerly create a RAG-indexable summary and saves via `saveConversationSummary()`
- Enqueues `ingest_conversations` job to RAG queue (fire-and-forget)
- Non-fatal: entire body wrapped in try/catch, errors logged at warn level only

### Route Updates (agents.ts)

Both `/run` and `/run/stream` handlers now:
- Instantiate a single `ConversationIngestionService` at startup
- Replace the old `enqueueRagIngestion({ action: "ingest_text", ... })` with `conversationIngestion.ingestAfterResponse(...)` fire-and-forget
- Guard remains: only triggers when `redisEnabled && app.embeddingService && result.conversationId`

### getRecentSessionSummaries (DB layer)

`packages/db/src/repositories.ts` — New function `getRecentSessionSummaries(db, userId, limit = 3)`:

- Two-step query: first gets user's 10 most recent conversations, then gets latest summaries for those conversations
- User-scoped (via conversations join) — distinct from `getRecentConversationSummaries` which filters by date
- Returns `Array<{ conversationId, summary, createdAt }>` for Plan 03 session context
- Exported from package index, added to test-utils mockDbModule

### git_clone Auto-Ingestion (tool-executor.ts)

After successful `gitClone()`, fire-and-forget enqueue of `ingest_repo` action:
- Derives `dirName` from `input.directory_name` or URL (`repo_url.split("/").pop()?.replace(".git", "")`)
- Dynamic import of `@ai-cofounder/queue` inside try/catch (non-fatal)
- Satisfies MEM-03: project documentation ingested on workspace registration

## Tests

### packages/db/src/__tests__/repositories-session.test.ts (6 tests)

- Returns empty array when user has no conversations
- Returns summaries joined via user conversations
- Returns up to limit summaries
- Respects limit parameter
- Returns empty when no summaries exist for user conversations
- Uses default limit of 3 when not specified

### apps/agent-server/src/__tests__/conversation-ingestion.test.ts (7 tests)

**conversation ingestion:**
- Creates eager summary for short conversations (< 30 messages) — summarizeMessages + saveConversationSummary + enqueueRagIngestion called
- Skips eager summary for long conversations (>= 30 messages) — only enqueueRagIngestion called
- Non-fatal on errors — getConversationMessageCount throwing doesn't propagate
- Works with embedding service provided

**project ingestion:**
- git_clone triggers ingest_repo enqueue on success
- git_clone derives directory name from repo URL when directory_name not provided
- git_clone ingest_repo is fire-and-forget (non-fatal if queue errors)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AgentMessage type mismatch in ConversationIngestionService**
- **Found during:** Task 1 (build verification)
- **Issue:** `summarizeMessages()` requires `AgentMessage[]` (needs `id`, `conversationId`, `createdAt`). Original attempt used `{ role, content }` objects and `"assistant"` role (not valid — should be `"agent"`).
- **Fix:** Added temporary placeholder `id`s and `conversationId` passthrough. Changed `"assistant"` to `"agent"` to match the AgentMessage union type.
- **Files modified:** apps/agent-server/src/services/conversation-ingestion.ts
- **Commit:** 51d6cf2

## Self-Check

**Files created:**
- apps/agent-server/src/services/conversation-ingestion.ts — FOUND
- apps/agent-server/src/__tests__/conversation-ingestion.test.ts — FOUND
- packages/db/src/__tests__/repositories-session.test.ts — FOUND

**Commits:**
- 51d6cf2 feat(08-01): add ConversationIngestionService and getRecentSessionSummaries — FOUND
- 739b183 feat(08-01): add git_clone ingest_repo trigger and conversation ingestion tests — FOUND

**Tests:**
- getRecentSessionSummaries: 6/6 PASS
- conversation ingestion: 7/7 PASS

## Self-Check: PASSED
