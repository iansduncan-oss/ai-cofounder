# v3.1 Sprint: Intelligence & Knowledge

Implement the highest-ROI agent intelligence and RAG upgrades. These are the Tier 1 and Tier 2 items from the deep research that make the agent dramatically smarter.

> **Reference:** `.claude/prompts/v31-deep-research.md` sections 1, 2, 3 for full implementation details.

## Context

Read these files first:
- `.claude/primer.md` — current project state
- `.claude/prompts/v31-deep-research.md` — implementation details for each task

## Tasks

### Phase 1: Agent Reasoning & Tool Optimization

**1.1 Reasoning Traces**
- Add `<thinking>` instruction to orchestrator system prompt
- Parse thinking blocks from LLM responses in the agentic loop
- Store traces in a new `thinking_traces` table (round, reasoning, tool chosen, confidence, goal_id, task_id)
- Add `GET /api/goals/:id/traces` endpoint to retrieve traces
- Add ApiClient method + types
- Tests: verify traces are captured, stored, and retrievable

**1.2 Tool Precondition Validation**
- Add optional `preconditions` function to `LlmTool` interface
- Before each orchestrator round, evaluate preconditions and filter out unavailable tools
- Log which tools were filtered and why
- Tests: verify tool filtering works, verify agent doesn't see unavailable tools

**1.3 Tool Result Caching**
- Create `ToolResultCache` class with TTL-based caching per conversation
- Cache key = `toolName:JSON.stringify(sortedArgs)`
- TTL per tool type: search_web 5min, read_file 30s, git_status 10s, recall_memories 60s
- Wire into orchestrator's `executeTool()` — check cache before executing
- Tests: verify cache hits, TTL expiry, cache bypass for write operations

**1.4 Tool Efficacy Tracking**
- Query existing `toolExecutions` table for success rate, avg latency per tool
- Generate efficacy hints string from top tools
- Inject into orchestrator system prompt: "Tool performance hints: ..."
- Update hints every 100 executions or daily
- Tests: verify efficacy calculation, hint generation

### Phase 2: Hybrid RAG Pipeline

**2.1 BM25 + Vector Hybrid Search**
- Add `search_vector tsvector` column to `rag_chunks` table
- Create GIN index on the new column
- Populate tsvector on ingestion (in chunker/ingester)
- Implement Reciprocal Rank Fusion (RRF) query combining vector + full-text results
- Add `hybridSearch()` function to retriever alongside existing `vectorSearch()`
- Make hybrid search the default retrieval method
- Migration: `0030_add_rag_hybrid_search.sql`
- Tests: verify hybrid returns better results than pure vector for keyword queries

**2.2 LLM Reranking**
- After hybrid search returns top 20-50 candidates, pass to LLM reranker
- Use cheap model (Groq Llama 8B) to score relevance 0-10
- Keep top 5 results
- Add `rerank()` function to retriever
- Configuration: enable/disable reranking, model selection, top-k
- Tests: verify reranking improves precision, verify graceful fallback if reranker fails

**2.3 Contextual Retrieval**
- During ingestion, prepend chunk-specific context using cheap LLM
- Format: "This chunk is from [document] and describes [topic].\n\n[original chunk]"
- Use Groq Llama 8B for contextualization (cheap, fast)
- Re-embed with contextualized text
- Add `contextualize` option to ingestion pipeline
- Tests: verify contextualized chunks have better retrieval scores

**2.4 Document File Watchers**
- Add chokidar-based `DocumentWatcher` class
- Watch registered project paths (from multi-project registry)
- On file change: hash check → queue re-ingestion only if content changed
- On file add: queue new ingestion
- On file delete: remove chunks
- Ignore patterns: node_modules, .git, dist, build
- Wire into agent-server startup (optional, enabled via env var)
- Tests: verify watcher events trigger correct ingestion actions

### Phase 3: Structured Memory

**3.1 Episodic Memory**
- New table: `episodic_memories` (session_id, summary, key_decisions jsonb, tools_used, goals_worked_on, emotional_context, importance, accessed_at, access_count)
- `EpisodicMemoryService`: create episode at session end, recall by semantic + temporal + importance scoring
- New orchestrator tool: `recall_episodes` (search past sessions)
- Migration: `0031_episodic_memory.sql`
- Wire into session end flow (create episode from conversation)
- Tests: verify episode creation, retrieval with combined scoring

**3.2 Procedural Memory**
- New table: `procedural_memories` (trigger_pattern, steps jsonb, preconditions, success_count, failure_count, last_used, created_from_goal_id, tags)
- `ProceduralMemoryService`: learn procedure from completed goals, find matching procedures for new tasks
- New orchestrator tool: `recall_procedures` (find learned workflows)
- Auto-extract after successful goal completion (async, queue-based)
- Migration: `0032_procedural_memory.sql`
- Tests: verify procedure extraction, matching, success/failure counting

**3.3 Memory Lifecycle**
- Add `importance` and `accessed_at` columns to existing memories table (if not present)
- Implement exponential decay function: `importance * exp(-0.05 * days_since_access)`
- Daily scheduled job: decay all memories, archive those below 0.1 threshold
- Memory consolidation: find similar memories (>0.9 cosine similarity), merge via LLM
- Add memory budget config (max total memories per project)
- Tests: verify decay, archival, consolidation, budget enforcement

### Phase 4: Dynamic Replanning

**4.1 Plan Repair on Failure**
- In dispatcher's DAG execution, catch task failures
- Build failure context: failed task, error, completed tasks + results, remaining tasks, goal description
- Ask LLM (planning task) to generate corrective replacement tasks
- Parse corrective plan, insert new tasks into DAG, reroute dependencies
- Resume DAG execution from new tasks
- Tests: verify corrective plan generation, DAG insertion, downstream dependency update

**4.2 Failure Pattern Database**
- New table: `failure_patterns` (tool_name, error_category, context, resolution, frequency, last_seen)
- After each tool failure, check/update pattern database
- Inject top 5 relevant patterns into system prompt as "Known issues and solutions"
- Tests: verify pattern recording, frequency tracking, prompt injection

## Success Criteria

- [ ] Agent reasoning is visible and debuggable (traces stored + retrievable)
- [ ] RAG retrieval precision improves measurably (run before/after comparison on 10 test queries)
- [ ] Memory system supports 3 types (semantic, episodic, procedural) with lifecycle management
- [ ] Agent recovers from at least 1 failure scenario without human intervention (dynamic replan)
- [ ] All new features have tests, all existing tests still pass
- [ ] No increase in P50 response latency for simple queries (tool filtering should help)

## Estimated Effort

- Phase 1: 3-4 days
- Phase 2: 4-5 days
- Phase 3: 4-5 days
- Phase 4: 3-4 days
- **Total: ~3 weeks**
