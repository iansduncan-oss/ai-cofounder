# Phase 8: Memory & Session Foundation - Research

**Researched:** 2026-03-09
**Domain:** RAG auto-ingestion, conversation lifecycle hooks, decision tagging, memory consolidation, session context injection
**Confidence:** HIGH — entire codebase is local and fully readable; no external library uncertainty

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MEM-01 | All conversations auto-ingested into RAG vector store after completion (chunked, embedded, indexed) | Fire-and-forget `enqueueRagIngestion` already fires per turn (ingest_text); needs upgrade to full summarized ingestion on conversation end |
| MEM-02 | Decisions stored with tagged context — what, why, alternatives | `decisions` route + `saveMemory(category:"decisions")` exists; metadata field stores context/alternatives/rationale; needs decision auto-detection in agent tool loop |
| MEM-03 | Project context (architecture docs, conventions, patterns) ingested from repo documentation on registration | `ingest_repo` action + `ingest_text` (markdown) exist in queue; needs project registration trigger to fire ingestion |
| MEM-04 | Agent auto-loads relevant memories before starting any task (no manual recall required) | Orchestrator already loads `recallMemories` + vector search on every `run()` call + RAG retrieval; needs session-level context from last N conversations |
| MEM-05 | Periodic memory consolidation — related memories summarized into coherent knowledge entries | No consolidation service exists; needs new BullMQ job + LLM summarization of memory clusters |
| SESS-01 | New conversations start with RAG-retrieved context from recent sessions | RAG retrieval runs per-message but retrieves document chunks, not "session context"; needs session-aware retrieval surfacing last 3 conversation summaries |
| SESS-02 | Agent proactively references past decisions when relevant | `decisions` memories are loaded via `recallMemories` + vector search, but the system prompt guidance doesn't explicitly instruct this behavior; needs behavioral prompt update + auto-injection of relevant decisions |
</phase_requirements>

---

## Summary

Phase 8 extends an already-substantial RAG and memory infrastructure. The project has `packages/rag` (chunker, ingester, retriever with MMR diversification), `documentChunks` + `ingestionState` DB tables, per-turn `ingest_text` fire-and-forget in both `POST /api/agents/run` and `POST /api/agents/run/stream`, a `ragIngestion` BullMQ worker, a 6-hour sweep job for conversation summaries, and pre-conversation RAG retrieval wired into `Orchestrator.run()`.

What is NOT yet built: (1) a triggerable "conversation complete" ingestion that fires on full-conversation summarization (not just per-turn text), (2) automatic decision tagging from the agent's own decision-making (the `decisions` route exists but must be called manually), (3) session-aware context retrieval that explicitly surfaces "here is what we discussed in the last 3 sessions" as a structured block, (4) memory consolidation that periodically merges related memory entries into coherent composite entries.

The gap between current state and requirements is small in infrastructure terms (BullMQ workers, RAG pipeline, DB schema all ready) but requires several new services: a `ConversationIngestionService` that detects conversation completion and enqueues full-summary ingestion within 30s, a `DecisionExtractorService` that scans agent responses for decisions and auto-stores them with context, a `SessionContextService` that retrieves and formats last-N session summaries as a structured context block, and a `MemoryConsolidationService` that clusters and merges related memories on a schedule.

**Primary recommendation:** Build four focused services that wire into existing infrastructure. Zero new DB schema required. Zero new queue infrastructure required. All new behavior mounts on existing extension points.

---

## Existing Infrastructure Inventory

### What Already Exists (Do Not Re-Build)

| Component | Location | Status |
|-----------|----------|--------|
| RAG chunker | `packages/rag/src/chunker.ts` | Complete — code + prose aware, 512-token chunks, 64-token overlap |
| RAG ingester | `packages/rag/src/ingester.ts` | Complete — `ingestText()`, `ingestFiles()`, `needsReingestion()`, batch embedding |
| RAG retriever | `packages/rag/src/retriever.ts` | Complete — vector search, MMR diversification, recency bonus reranking, `formatContext()` |
| documentChunks table | `packages/db/src/schema.ts` | Complete — sourceType enum: git/conversation/slack/memory/reflection/markdown |
| ingestionState table | `packages/db/src/schema.ts` | Complete — cursor tracking for incremental ingestion |
| ragIngestion BullMQ worker | `packages/queue/src/workers.ts` + `apps/agent-server/src/plugins/queue.ts` | Complete — handles ingest_repo, ingest_conversations (sweep + single), ingest_text |
| Conversation sweep job | `packages/queue/src/scheduler.ts` | Complete — runs every 6 hours, ingests summaries not yet in RAG |
| Per-turn RAG ingest | `apps/agent-server/src/routes/agents.ts:225,379` | Partial — ingests raw turn text as "markdown" type, not as "conversation" summary |
| Pre-conversation RAG retrieval | `apps/agent-server/src/agents/orchestrator.ts:330` | Complete — `retrieveRagContext()` called before every response |
| Pre-conversation memory loading | `apps/agent-server/src/agents/orchestrator.ts:291` | Complete — `recallMemories()` + vector similarity search |
| Conversation summarizer | `apps/agent-server/src/agents/summarizer.ts` | Complete — LLM summary of messages, used for long-conversation compression |
| conversationSummaries table | `packages/db/src/schema.ts` | Complete — `saveConversationSummary()`, `getLatestConversationSummary()`, `getRecentConversationSummaries()` |
| memories table | `packages/db/src/schema.ts` | Complete — category enum includes "decisions", metadata jsonb for context |
| Decisions route | `apps/agent-server/src/routes/decisions.ts` | Complete — GET list, POST create; stores as memories(category:"decisions") with context/alternatives/rationale in metadata |
| save_memory / recall_memories tools | `apps/agent-server/src/agents/tools/memory-tools.ts` | Complete — orchestrator can save decisions as memories |
| Reflection service | `apps/agent-server/src/services/reflection.ts` | Complete — post-goal LLM reflection, stores in reflections table |

### What Is Missing (Must Build)

| Gap | Requirement | Complexity |
|-----|-------------|------------|
| Full-conversation summarized ingestion (not just per-turn text) | MEM-01 | Low — wire `summarizeMessages` → `ingestText(sourceType:"conversation")` at conversation end |
| Conversation-end trigger (30s SLA) | MEM-01 | Low — enqueue `ingest_conversations:{sourceId}` after agent response completes |
| Decision auto-detection from agent responses | MEM-02 | Medium — scan for decision signals in response text or extend agent tool loop |
| Session context retrieval (last 3 sessions) | MEM-04, SESS-01 | Low — query `conversationSummaries` by recency + inject as structured block |
| Proactive decision surfacing in system prompt | SESS-02 | Low — add decision-recall section to `retrieveRagContext()` or pre-load logic |
| Memory consolidation service | MEM-05 | Medium — LLM-powered clustering + merging of related memories, new BullMQ job |
| Project documentation ingestion trigger | MEM-03 | Low — fire `ingest_repo` on project registration (already exists as manual API call) |

---

## Standard Stack

### Core (All Already Installed)

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| `@ai-cofounder/rag` | local | Chunking, embedding, retrieval | Complete |
| `@ai-cofounder/db` | local | Drizzle ORM, all DB operations | Complete |
| `@ai-cofounder/queue` | local | BullMQ workers and schedulers | Complete |
| `@ai-cofounder/llm` | local | LLM completions for summarization/consolidation | Complete |
| `drizzle-orm` | ^0.x | Query builder | Complete |
| `bullmq` | ^5.x | Background job processing | Complete |

**Installation:** No new packages required.

---

## Architecture Patterns

### Existing Extension Points

```
apps/agent-server/src/
├── agents/
│   ├── orchestrator.ts          — run() → retrieveRagContext() hook
│   ├── prompts/system.ts        — buildSystemPrompt(memoryContext) injection point
│   └── summarizer.ts            — summarizeMessages() utility
├── routes/
│   └── agents.ts                — POST /run and /run/stream — post-response hooks
├── plugins/
│   └── queue.ts                 — ragIngestion worker handler
└── services/                    — new services mount here
    ├── conversation-ingestion.ts  [NEW]
    ├── session-context.ts         [NEW]
    ├── decision-extractor.ts      [NEW]
    └── memory-consolidation.ts    [NEW]
```

### Pattern 1: Conversation-End Ingestion (MEM-01 — 30s SLA)

**What:** After every agent response, immediately enqueue a `ingest_conversations` job scoped to the specific conversation ID. The ragIngestion worker already handles this case.

**Current gap:** Per-turn ingest uses `ingest_text` with raw turn text as `sourceId: conversationId`. The 6-hour sweep handles full summaries but can be up to 6h delayed. Need immediate single-conversation ingestion triggered post-response.

**How to use existing code:**

```typescript
// Source: apps/agent-server/src/routes/agents.ts (extend existing fire-and-forget block)
// After agent response, replace current ingest_text with ingest_conversations
if (redisEnabled && app.embeddingService && result.conversationId) {
  enqueueRagIngestion({
    action: "ingest_conversations",
    sourceId: result.conversationId, // existing worker already handles this case (lines 131-144)
  }).catch(() => {});
}
```

The worker at `plugins/queue.ts:130-144` already implements single-conversation ingestion via `getLatestConversationSummary`. The trigger is what's missing — it only fires from the sweep, not from each conversation end.

**30s SLA feasibility:** BullMQ processes jobs nearly immediately when workers are running. The bottleneck is summarization latency (LLM call) — the summary must exist before RAG ingestion. The lazy summarization in `agents.ts:117-165` only triggers at 30+ messages. Conversations shorter than 30 messages don't get a summary and thus can't be ingested via `ingest_conversations`. Fix: also trigger summarization + ingestion eagerly post-response for any conversation (not just 30+ messages).

### Pattern 2: Session Context Retrieval (MEM-04, SESS-01)

**What:** Before building the system prompt, retrieve and format the last 3 conversation summaries as a "recent session context" block — distinct from per-query RAG retrieval.

**Where to insert:** `Orchestrator.run()` method, alongside the existing `recallMemories()` call.

```typescript
// Source: apps/agent-server/src/agents/orchestrator.ts (extend pre-response loading)
// New: load recent session summaries
if (userId && this.db) {
  const recentSummaries = await getRecentSessionSummaries(this.db, userId, 3);
  // Format as structured block for system prompt injection
  // This is separate from per-query RAG retrieval
}
```

**DB query needed:** `getRecentSessionSummaries(db, userId, limit)` — joins `conversations` on `userId` then fetches latest `conversationSummaries` for those conversations ordered by `createdAt DESC`. This function does not exist yet and must be added to `packages/db/src/repositories.ts`.

### Pattern 3: Decision Auto-Detection (MEM-02)

**What:** After each agent response, scan for decision signals and auto-store as `decisions` memory with context metadata.

**Two approaches:**

Option A (LLM extraction — more accurate): After response, run a lightweight LLM prompt asking "Did this response contain a decision? If yes, extract: decision, why, alternatives considered." Use `"simple"` task category (Groq — fast and cheap).

Option B (Keyword detection — simpler): Detect phrases like "we decided", "going with", "chosen approach", "ruling out", "the plan is" and trigger decision save with surrounding context.

**Recommendation:** Option A — LLM extraction using Groq ("simple" route) for <500ms latency. Fire-and-forget after response. Store via existing `saveMemory(db, { category: "decisions", metadata: { context, alternatives, rationale } })`.

**Auto-injection into context:** Modify `retrieveRagContext()` in orchestrator to also run a `searchMemoriesByVector(db, queryEmbedding, userId)` filtered to `decisions` category, then prepend "Relevant past decisions:" block to system prompt. This partially already works (vector search in pre-load includes decisions), but the framing should be explicit.

### Pattern 4: Memory Consolidation (MEM-05)

**What:** Weekly or daily BullMQ job that: (1) retrieves all memories for each user grouped by category, (2) uses LLM to identify clusters of related memories, (3) creates a new composite memory summarizing the cluster, (4) optionally marks constituent memories as consolidated.

**Where:** New `reflection` worker action (reuse existing reflection queue infrastructure) or new dedicated `memoryConsolidation` queue action.

**Recommendation:** Extend existing `reflectionQueue` with a new `action: "consolidate_memories"` job. Add weekly scheduler at Sunday 4 AM. The `ReflectionService` pattern is the right model.

```typescript
// Extend packages/queue/src/scheduler.ts setupRecurringJobs()
await reflectionQueue.upsertJobScheduler("weekly-memory-consolidation", {
  pattern: "0 4 * * 0",  // Sunday 4 AM
  tz: briefingTimezone,
}, {
  name: "weekly-memory-consolidation",
  data: { action: "consolidate_memories" },
});
```

### Pattern 5: Project Documentation Ingestion (MEM-03)

**What:** When a project is "registered" (workspace cloned or registered), automatically enqueue `ingest_repo` for its documentation files.

**Current state:** `POST /api/rag/ingest { action: "ingest_repo", sourceId }` exists. Workspace clone via `git_clone` tool exists. No automatic trigger on clone.

**Fix:** After successful `git_clone` tool execution in `orchestrator.ts`, fire `enqueueRagIngestion({ action: "ingest_repo", sourceId: repoPath })`. Also filter `ingest_repo` to docs only (README, .md, ARCHITECTURE, etc.) rather than all 500 files — more focused context.

### Anti-Patterns to Avoid

- **Ingesting raw turn text as "conversation" sourceType:** Current code uses `ingest_text` with conversation ID but sourceType is `"markdown"`. This pollutes the conversation namespace. Use `"conversation"` sourceType only for summarized conversation content.
- **Blocking agent response on ingestion:** All ingestion must be fire-and-forget (enqueue only). Never await ingestion in the response path.
- **Rebuilding vector search:** The existing `searchChunksByVector` + `searchMemoriesByVector` are both wired. Do not add a third vector search layer.
- **Over-ingesting raw messages:** Store summaries in RAG, not raw messages. Raw messages are already in the DB and searchable via `searchMessages()`. RAG should contain semantic summaries.
- **Forgetting the 30-message summarization gate:** Short conversations have no summary yet. The ingestion worker tries `getLatestConversationSummary` and skips if null. Fix: create the summary eagerly rather than waiting for the lazy 30-message threshold.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Vector similarity search | Custom SQL | `searchChunksByVector()` in repositories.ts |
| Text chunking | Custom splitter | `chunkText()` in packages/rag/src/chunker.ts |
| Batch embedding | Custom batcher | `embedBatch()` inside ingester.ts |
| Background job scheduling | Custom cron | BullMQ `upsertJobScheduler()` |
| Incremental ingestion tracking | Custom state table | `upsertIngestionState()` / `needsReingestion()` |
| Conversation summarization | Custom LLM call | `summarizeMessages()` in agents/summarizer.ts |
| Memory storage | Custom table | `saveMemory()` / `recallMemories()` in repositories.ts |

---

## Common Pitfalls

### Pitfall 1: 30-Message Lazy Summarization Gate Blocks MEM-01

**What goes wrong:** The RAG ingestion worker for `ingest_conversations:{sourceId}` calls `getLatestConversationSummary`. If the conversation is fewer than 30 messages, no summary exists, so ingestion silently skips it.

**Why it happens:** Summarization was designed for context-window management of long conversations, not for RAG seeding.

**How to avoid:** Add a "RAG summary" path that summarizes any conversation after each agent turn (or after first N messages), separate from the lazy long-conversation path. Can be a shorter summary (1 paragraph) specifically for RAG indexing. Store with a distinguishing marker (e.g., `metadata: { purpose: "rag_index" }`).

**Warning signs:** `getChunkCount(db, "conversation")` stays at 0 despite active conversations.

### Pitfall 2: sourceType Collision Between Per-Turn and Session Summaries

**What goes wrong:** Current per-turn ingestion uses `sourceType: "markdown"` with `sourceId: conversationId`. If full-conversation ingestion uses `sourceType: "conversation"` with the same `sourceId`, `deleteChunksBySource` wipes per-turn chunks when re-ingesting session summaries.

**Why it happens:** Both use conversation ID as sourceId, but different sourceTypes — so they actually don't collide. But the per-turn "markdown" chunks are lower quality than session summaries and waste vector space.

**How to avoid:** Migrate per-turn ingestion to use `sourceType: "conversation"` and `sourceId: "{conversationId}-{messageId}"` or stop per-turn ingestion and rely entirely on the session-end summarized ingestion.

**Recommendation:** Keep current per-turn ingest as-is (it's fast and useful for real-time RAG), but also trigger session-end summary ingestion separately. The 6-hour sweep handles cleanup.

### Pitfall 3: Decision Auto-Detection Rate Limits Groq

**What goes wrong:** Running decision extraction after every agent response adds an LLM call per turn on the `"simple"` task category (Groq). Groq has rate limits (tokens/minute). Under load this can fail.

**Why it happens:** Fire-and-forget async extraction works until Groq rate limit is hit.

**How to avoid:** Run decision extraction via BullMQ job (not inline) so it's queued and rate-limited gracefully. Use a 2s retry with backoff. Also filter: only extract decisions if response length > 100 chars (skip trivial acknowledgements).

### Pitfall 4: Session Context Explodes System Prompt Size

**What goes wrong:** Injecting last 3 session summaries as context, plus memories, plus RAG chunks can push the system prompt past 8K tokens, reducing the effective conversation window.

**Why it happens:** Each session summary can be 200-500 words. Three summaries plus existing memory context plus RAG context can easily be 2K+ tokens.

**How to avoid:** Cap session context at 800 tokens total. Truncate summaries to their first 2 paragraphs. The existing `recallMemories(limit: 20)` should be reduced to 10 when session context is also being injected.

### Pitfall 5: Memory Consolidation Creates Duplicate or Conflicting Entries

**What goes wrong:** LLM consolidation creates a new "composite" memory but doesn't mark constituent memories as superseded. On the next consolidation cycle, it re-consolidates the same originals plus the composite, creating bloat.

**Why it happens:** No "consolidated" flag in the memories schema.

**How to avoid:** Add a `metadata: { consolidated: true, consolidatedInto: uuid }` marker to constituent memories after consolidation. Exclude memories with `consolidated: true` from future consolidation runs. The `memories` table has a `metadata jsonb` field — no schema migration needed.

---

## Code Examples

### Trigger Session-End Ingestion (MEM-01)

```typescript
// Source: apps/agent-server/src/routes/agents.ts
// Replace current per-turn ingest with session-end ingestion
// Fire both: (1) immediate text for real-time RAG, (2) conversation summary for durable RAG

if (redisEnabled && app.embeddingService && result.conversationId) {
  // Per-turn (real-time, lightweight)
  enqueueRagIngestion({
    action: "ingest_text",
    sourceId: `${result.conversationId}-turn`,
    metadata: { content: `User: ${message}\n\nAssistant: ${result.response}` },
  }).catch(() => {});

  // Full conversation summarized ingestion (durable, within 30s)
  enqueueRagIngestion({
    action: "ingest_conversations",
    sourceId: result.conversationId,
  }).catch(() => {});
}
```

### Get Recent Session Summaries (MEM-04, SESS-01)

```typescript
// Source: NEW function to add to packages/db/src/repositories.ts
export async function getRecentSessionSummaries(
  db: Db,
  userId: string,
  limit = 3,
): Promise<Array<{ conversationId: string; summary: string; createdAt: Date }>> {
  // Get recent conversations for this user
  const recentConvs = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(10);

  if (recentConvs.length === 0) return [];

  // Get latest summary for each conversation
  const convIds = recentConvs.map((c) => c.id);
  return db
    .select({
      conversationId: conversationSummaries.conversationId,
      summary: conversationSummaries.summary,
      createdAt: conversationSummaries.createdAt,
    })
    .from(conversationSummaries)
    .where(inArray(conversationSummaries.conversationId, convIds))
    .orderBy(desc(conversationSummaries.createdAt))
    .limit(limit);
}
```

### Inject Session Context into Orchestrator (SESS-01, SESS-02)

```typescript
// Source: apps/agent-server/src/agents/orchestrator.ts — extend run() pre-loading block
if (userId && this.db) {
  // ... existing memory loading ...

  // NEW: session continuity context
  try {
    const recentSessions = await getRecentSessionSummaries(this.db, userId, 3);
    if (recentSessions.length > 0) {
      const sessionBlock = recentSessions
        .map((s, i) => `Session ${i + 1} summary:\n${s.summary.slice(0, 600)}`)
        .join("\n\n");
      // Prepend to memoryContext (cap total at ~800 tokens)
      const sessionSection = `Recent sessions:\n${sessionBlock}`;
      memoryContext = sessionSection + (memoryContext ? `\n\n${memoryContext}` : "");
    }
  } catch (err) {
    this.logger.warn({ err }, "session context retrieval failed (non-fatal)");
  }
}
```

### Decision Extraction Service

```typescript
// Source: NEW apps/agent-server/src/services/decision-extractor.ts
const DECISION_EXTRACTION_PROMPT = `Read this agent response and determine if it contains a decision.
A decision is when the user or agent commits to an approach, technology, or direction.

If a decision exists, respond with JSON:
{
  "hasDecision": true,
  "title": "short decision title (5-10 words)",
  "decision": "what was decided (1-2 sentences)",
  "rationale": "why this was chosen",
  "alternatives": ["other option 1", "other option 2"]
}

If no decision, respond: {"hasDecision": false}

Agent response:
{RESPONSE}`;

export async function extractDecision(
  registry: LlmRegistry,
  response: string,
): Promise<{ hasDecision: false } | { hasDecision: true; title: string; decision: string; rationale?: string; alternatives?: string[] }> {
  if (response.length < 100) return { hasDecision: false };

  try {
    const result = await registry.complete("simple", {
      messages: [{ role: "user", content: DECISION_EXTRACTION_PROMPT.replace("{RESPONSE}", response.slice(0, 2000)) }],
      max_tokens: 300,
    });
    const text = result.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text).join("");
    return JSON.parse(text);
  } catch {
    return { hasDecision: false };
  }
}
```

### Memory Consolidation Job (MEM-05)

```typescript
// Source: Extend packages/queue/src/scheduler.ts and apps/agent-server/src/plugins/queue.ts
// In setupRecurringJobs():
await reflectionQueue.upsertJobScheduler("weekly-memory-consolidation", {
  pattern: "0 4 * * 0",  // Sunday 4 AM
  tz: briefingTimezone,
}, {
  name: "weekly-memory-consolidation",
  data: { action: "consolidate_memories" },
});

// In queue.ts reflection worker handler (add new case):
case "consolidate_memories": {
  const { MemoryConsolidationService } = await import("../services/memory-consolidation.js");
  const svc = new MemoryConsolidationService(app.db, app.llmRegistry, app.embeddingService);
  await svc.consolidate();
  break;
}
```

---

## State of the Art

| Old Approach | Current Approach | Phase 8 Target |
|--------------|------------------|----------------|
| Manual `save_memory` tool calls | Automatic post-response decision extraction | Full auto-detection + storage |
| 6-hour sweep for conversation RAG | Per-turn raw text ingest | Session-end summarized ingestion within 30s |
| No session context across conversations | Conversation history window (50 messages) | Explicit "last 3 sessions" block in system prompt |
| Memories stored flat, no consolidation | Memories + reflections separate | Weekly consolidation merging related memories |
| Project docs ingested manually via API | Workspace clone + manual `ingest_repo` | Auto-ingest on workspace registration |

---

## Open Questions

1. **What counts as "conversation end" for the 30s SLA?**
   - What we know: There is no explicit session end event. Conversations end when users stop sending messages.
   - What's unclear: Should ingestion trigger after every response (safe but over-ingests) or after a time-based idle period (accurate but requires separate timeout mechanism)?
   - Recommendation: Trigger after every response (fire-and-forget). The `needsReingestion` cursor comparison prevents duplicate full-summary ingestion. Per-turn ingestion is idempotent.

2. **How should `getRecentSessionSummaries` handle the case where no summaries exist?**
   - What we know: Short conversations (<30 messages) don't trigger summarization. Many recent conversations may have no summary.
   - What's unclear: Should we fall back to raw message truncation?
   - Recommendation: Also eagerly create a short "RAG summary" (1-paragraph) for any conversation that just received an agent response, regardless of message count. This is separate from the long-conversation context-management summary.

3. **Should decision extraction run inline (blocking) or async (fire-and-forget)?**
   - What we know: Groq "simple" calls are fast (~500ms) but add latency.
   - Recommendation: Fire-and-forget via BullMQ queue. Create a new `decisionExtraction` queue action or reuse the `reflection` queue.

4. **What is the minimal "project registration" surface?**
   - What we know: Workspace clone is the de-facto registration event. The `git_clone` tool exists. No formal project registry table exists yet.
   - What's unclear: Phase 14 will add a proper project registry. Should Phase 8 anticipate that schema?
   - Recommendation: For Phase 8, treat "git_clone success" as the project registration trigger. Hook into `git_clone` tool execution to enqueue `ingest_repo`. Phase 14 will add the formal registry and can re-trigger.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts`) |
| Config file | `vitest.config.ts` at repo root |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="memory\|session\|ingestion\|decision\|consolidation"` |
| Full suite command | `npm run test` |
| Estimated runtime | ~15-30 seconds for phase tests |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MEM-01 | `enqueueRagIngestion` called after every agent response | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="conversation-ingestion"` | No — Wave 0 gap |
| MEM-01 | Ingestion completes within 30s (worker processes job) | integration | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="conversation-ingestion"` | No — Wave 0 gap |
| MEM-02 | Decision extraction fires after response with decision language | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="decision-extractor"` | No — Wave 0 gap |
| MEM-02 | Extracted decision stored with context/alternatives/rationale | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="decision-routes"` | Yes — `decision-routes.test.ts` |
| MEM-03 | `enqueueRagIngestion(ingest_repo)` fires after `git_clone` success | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="git-tools\|workspace"` | Partial — `workspace-tools.test.ts` |
| MEM-04 | `getRecentSessionSummaries` returns last 3 session summaries | unit | `npm run test -w @ai-cofounder/db -- --testPathPattern="repositories"` | No — Wave 0 gap |
| MEM-04 | Session summaries appear in orchestrator system prompt | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="orchestrator\|summarizer"` | Partial — `orchestrator.test.ts` |
| MEM-05 | Consolidation job groups related memories | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="memory-consolidation"` | No — Wave 0 gap |
| SESS-01 | New conversation receives recent session context in first response | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="session-context"` | No — Wave 0 gap |
| SESS-02 | Relevant decisions surface in system prompt when topic matches | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="orchestrator"` | Partial — `orchestrator.test.ts` |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="memory|session|ingestion|decision|consolidation"`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~15 seconds

### Wave 0 Gaps (must be created before implementation)

- [ ] `apps/agent-server/src/__tests__/conversation-ingestion.test.ts` — covers MEM-01 (enqueue trigger, worker processing)
- [ ] `apps/agent-server/src/__tests__/decision-extractor.test.ts` — covers MEM-02 (extraction logic, fire-and-forget)
- [ ] `apps/agent-server/src/__tests__/session-context.test.ts` — covers MEM-04, SESS-01 (getRecentSessionSummaries, system prompt injection)
- [ ] `apps/agent-server/src/__tests__/memory-consolidation.test.ts` — covers MEM-05 (MemoryConsolidationService)
- [ ] `packages/db/src/__tests__/repositories-session.test.ts` — covers `getRecentSessionSummaries` new function

---

## Sources

### Primary (HIGH confidence)

- Local codebase — `packages/rag/src/` (chunker, ingester, retriever) — read directly
- Local codebase — `packages/db/src/schema.ts` + `repositories.ts` — read directly
- Local codebase — `apps/agent-server/src/agents/orchestrator.ts` — read directly
- Local codebase — `apps/agent-server/src/routes/agents.ts` — read directly
- Local codebase — `apps/agent-server/src/plugins/queue.ts` — read directly
- Local codebase — `packages/queue/src/scheduler.ts` — read directly
- Local codebase — `apps/agent-server/src/agents/prompts/system.ts` — read directly
- Local codebase — `apps/agent-server/src/services/reflection.ts` — read directly

### Secondary (MEDIUM confidence)

- BullMQ `upsertJobScheduler` pattern — validated against running scheduler.ts implementation
- LLM decision extraction pattern — validated against existing `summarizeMessages` + `ReflectionService` patterns in codebase

### Tertiary (LOW confidence)

- None — all findings are directly from local codebase with no external verification needed

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all libraries already installed and running
- Architecture: HIGH — extension points verified in source code
- Pitfalls: HIGH — identified from reading actual implementation paths
- Missing functions: HIGH — verified absence by grepping repositories.ts
- Test gaps: HIGH — confirmed by listing `__tests__` directory

**Research date:** 2026-03-09
**Valid until:** Stable — code-based findings don't expire unless codebase changes
