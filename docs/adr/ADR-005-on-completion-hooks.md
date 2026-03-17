# ADR-005: Fire-and-Forget onCompletion Hooks in LlmRegistry

**Status:** Accepted
**Date:** 2026-03-08
**Tags:** llm, cost-tracking, observability

## Context

We need to track LLM costs, token usage, and provider health metrics after every LLM call. This data feeds into:

1. Prometheus metrics (`llm_cost_microdollars_total`, `llm_tokens_total`, `llm_request_duration_seconds`)
2. DB-persisted usage records (`llmUsage` table via `recordLlmUsage()`)
3. Provider health stats (success/failure rates, circuit breaker state)

The challenge: this tracking must never slow down the response path. A failing metrics write should not cause a user-facing error.

## Decision

Add an optional `onCompletion` callback to `LlmRegistry` that fires after every successful `complete()` call. The callback is invoked **fire-and-forget** — errors are caught and logged, never propagated to the caller.

### Interface

```typescript
export interface CompletionEvent {
  task: TaskCategory;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicrodollars: number;
  durationMs: number;
  metadata?: CompletionMetadata;
}

export type OnCompletionCallback = (event: CompletionEvent) => void | Promise<void>;

export class LlmRegistry {
  onCompletion?: OnCompletionCallback;
  // ...
}
```

### Wiring

In `server.ts`, the callback is wired at startup:

```typescript
registry.onCompletion = (event) => {
  recordLlmMetrics(event);       // Prometheus counters/histograms
  recordLlmUsage(db, event);     // DB persistence (fire-and-forget)
};
```

### Cost Estimation

`LlmRegistry.estimateCost(model, inputTokens, outputTokens)` calculates cost in microdollars using per-model pricing tables:

| Provider | Model | Input (per 1M) | Output (per 1M) |
|----------|-------|----------------|-----------------|
| Anthropic | Claude Opus | $15.00 | $75.00 |
| Anthropic | Claude Sonnet | $3.00 | $15.00 |
| Groq | Llama 3.3 70B | $0.59 | $0.79 |
| Google | Gemini 2.5 Pro | $1.25 | $10.00 |
| OpenRouter | Free models | $0.00 | $0.00 |

## Consequences

### Benefits

- **Zero-latency impact** — callback is fire-and-forget; LLM response returns immediately
- **Decoupled tracking** — LlmRegistry doesn't know about Prometheus or the database
- **Composable** — consumer decides what to do with the event (metrics, logging, alerts)
- **Type-safe** — `CompletionEvent` provides structured data including cost estimate

### Trade-offs

- Errors in the callback are silently swallowed (logged as warn)
- If the callback is async and slow, events could pile up (mitigated: DB writes are fast)
- Cost estimates are approximate — based on list pricing, not actual billing

## Files

- `packages/llm/src/registry.ts` — `LlmRegistry`, `CompletionEvent`, `OnCompletionCallback`
- `apps/agent-server/src/plugins/observability.ts` — `recordLlmMetrics()` consumer
- `apps/agent-server/src/server.ts` — callback wiring
