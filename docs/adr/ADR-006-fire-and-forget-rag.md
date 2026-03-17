# ADR-006: Fire-and-Forget RAG Ingestion

**Status:** Accepted
**Date:** 2026-03-12
**Tags:** rag, queue, conversation-memory

## Context

Every agent response should be ingested into the RAG pipeline for future retrieval (requirement MEM-01: summarization within 30s). However, RAG ingestion involves embedding generation, chunking, and vector storage — operations too slow for the response path.

We needed a pattern that:

1. Triggers ingestion after every agent response
2. Never blocks or delays the user-facing response
3. Handles failures gracefully (warn, not crash)
4. Supports both eager (short conversations) and lazy (long conversations) summarization

## Decision

Implement `ConversationIngestionService` with a **fire-and-forget** pattern: errors are caught as warnings and never propagate to the caller. Ingestion is split into two paths:

### Eager Path (short conversations, < 30 messages)

```typescript
async ingestAfterResponse(conversationId, userMessage, agentResponse) {
  const count = await getConversationMessageCount(db, conversationId);
  if (count < 30) {
    // Eagerly summarize and store
    const summary = await summarizeMessages(llmRegistry, [userMessage, agentResponse]);
    await saveConversationSummary(db, { conversationId, summary, messageCount: count });
  }
  // Always enqueue async RAG ingestion
  enqueueRagIngestion({ action: "ingest_conversations", sourceId: conversationId });
}
```

### Lazy Path (long conversations)

For conversations with 30+ messages, summarization is handled by the existing `ContextWindowManager` lazy path in the agent routes. The queue-based RAG ingestion handles the vector embedding asynchronously.

### Queue Integration

RAG ingestion jobs are processed by a BullMQ worker (`rag-ingestion` queue) that:

1. Fetches conversation messages from the database
2. Chunks them using the `@ai-cofounder/rag` package
3. Generates embeddings via the embedding provider
4. Stores chunks in the `documentChunks` table with pgvector

A recurring sweep job runs every 6 hours to catch any missed conversations.

### Error Handling

The entire `ingestAfterResponse()` method is wrapped in a try-catch that logs warnings on failure:

```typescript
try {
  await this.ingestAfterResponse(conversationId, userMessage, agentResponse);
} catch (err) {
  logger.warn({ err, conversationId }, "conversation ingestion failed (non-blocking)");
}
```

## Consequences

### Benefits

- **Non-blocking** — agent responses return immediately regardless of ingestion status
- **Resilient** — ingestion failures don't affect user experience
- **Dual-speed** — eager summaries for short conversations provide immediate RAG recall; lazy ingestion catches everything else
- **Observable** — ingestion jobs visible in queue dashboard and metrics

### Trade-offs

- Failed ingestions are silently dropped (logged as warn) — could miss conversations
- Eager path adds one LLM call per response for short conversations
- Queue processing lag means RAG data may be 15-30 seconds behind
- Recurring sweep is a safety net, not a primary ingestion path

## Files

- `apps/agent-server/src/services/conversation-ingestion.ts` — ConversationIngestionService
- `packages/queue/src/helpers.ts` — `enqueueRagIngestion()`
- `packages/rag/src/` — chunker, ingester, retriever
- `packages/queue/src/scheduler.ts` — 6-hour RAG sweep recurring job
