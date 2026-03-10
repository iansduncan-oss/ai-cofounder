# Stack Research: v2.0 Autonomous Cofounder

**Domain:** Autonomous AI agent platform — terminal access, RAG memory, tiered autonomy, work journaling, content automation, multi-project awareness, financial tracking
**Researched:** 2026-03-09
**Confidence:** HIGH for core additions; MEDIUM for Claude Agent SDK integration approach (performance tradeoffs documented)

---

## Context: What Already Exists

The following are fully wired and must NOT be re-researched or replaced:

- Fastify + Drizzle + PostgreSQL + pgvector (768-dim embeddings via Gemini)
- BullMQ + Redis (5 queues, recurring jobs, SSE streaming)
- Multi-LLM provider abstraction (Anthropic, Groq, Gemini, OpenRouter)
- Docker sandboxed code execution via `packages/sandbox` (execFile + Docker)
- `packages/rag` — chunker, ingester, retriever fully built (pgvector cosine similarity)
- `packages/queue` — worker process, scheduler, monitoring workers
- `simple-git` is already used inside WorkspaceService for git operations (via `execFile`)
- `packages/db` schema — reflections, document_chunks, ingestion_state, subagent_runs, agent_messages

The v2.0 additions are targeted additions on top of this base. Do not rearchitect — extend.

---

## New Capabilities Needed

### 1. Autonomous Terminal Access

**Goal:** Agent runs real shell commands against workspace projects (not Docker-sandboxed), streams output, and integrates with the autonomous task loop.

**Recommendation: `node:child_process` spawn — no new library**

The existing `WorkspaceService` already uses `execFile` from `node:child_process` for all git operations. Terminal access for autonomous tasks should use `spawn()` with streaming stdio, scoped to workspace paths. This avoids adding a native module dependency.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `node:child_process` spawn | Node.js built-in (v24+) | Stream shell command output in real-time | Already used in workspace; spawn gives streaming stdout/stderr; no new dependencies |

**Why NOT node-pty:**
- node-pty@1.1.0 is a native C++ module. Prebuilt binaries are missing for Node.js 24 (the project's runtime). Requires `node-gyp` rebuild on every Node version change.
- This project doesn't need interactive PTY features (terminal UI in browser). It needs command output captured and stored.
- `spawn()` with `stdio: "pipe"` + `shell: false` achieves full streaming output capture without native modules.
- MEDIUM confidence flag: if future requirement is a browser-based terminal UI, node-pty becomes necessary.

**Why NOT @anthropic-ai/claude-agent-sdk as the terminal executor:**
The Agent SDK (v0.2.71) spawns a new subprocess per `query()` call with ~12s cold-start overhead. Even with streaming input mode (session reuse), latency is 2-3s per message. This is appropriate for autonomous coding tasks that take minutes, not for lightweight shell commands that should return in <1s.

**Integration point:** New `TerminalService` in `apps/agent-server/src/services/terminal.ts` wrapping `spawn()`. Adds `run_shell` tool to orchestrator. Streams output via Redis pub/sub to SSE endpoint (same pattern as existing pipeline streaming).

---

### 2. Claude Agent SDK — Autonomous Coding Tasks

**Goal:** Delegate complex multi-file coding tasks to Claude Code's full agent loop (read files, edit code, run tests, commit).

**Recommendation: `@anthropic-ai/claude-agent-sdk` — use for long-running coding tasks only**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/claude-agent-sdk` | `^0.2.71` | Run Claude Code agent loop programmatically for coding tasks | Same tools/loop as Claude Code CLI; handles multi-file edits, test runs, git ops within a working directory |

**Critical integration notes:**

1. **12s cold-start overhead per `query()` call** — This is a known performance issue (GitHub issue #34). Use only for tasks that warrant it: full coding goals, not quick lookups.
2. **Node.js spawn bug workaround** — When spawning from Node.js, use `stdio: ["inherit", "pipe", "pipe"]` not default piped stdio. Issue #771 was closed August 2025 as completed, but test this during implementation.
3. **Session reuse** — Use streaming input mode with session IDs to reduce subsequent-message latency from ~12s to ~2-3s for multi-turn coding sessions.
4. **Async/BullMQ dispatch** — Invoke Agent SDK queries via BullMQ worker (not HTTP request handler) so 12s+ tasks don't block the Fastify event loop.
5. **cwd scoping** — Always pass `cwd` option pointing to the target project directory, never the monorepo root.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Fix the failing tests in src/__tests__/auth.test.ts",
  options: {
    cwd: "/opt/ai-cofounder",
    allowedTools: ["Read", "Edit", "Bash", "Write"],
    maxTurns: 10,
  }
})) {
  // stream message events to Redis pub/sub
}
```

**Installation:**
```bash
npm install @anthropic-ai/claude-agent-sdk -w @ai-cofounder/agent-server
```

---

### 3. Persistent RAG Memory — Enhancements

**The `packages/rag` package is already built** (chunker, ingester, retriever with pgvector + cosine similarity + recency reranking). What v2.0 needs is:

**a) Conversation auto-ingestion**

No new library needed. Add a `ConversationIngestionWorker` in `packages/queue` that triggers after each goal completion. Uses existing `ingestText()` from `packages/rag` with `sourceType: "conversation"`.

**b) Hybrid search (keyword + vector)**

PostgreSQL full-text search via Drizzle's `sql` template tag — no new library. Drizzle supports PostgreSQL `tsvector` via custom SQL. Add a `searchChunksByKeyword()` function alongside the existing `searchChunksByVector()`.

```typescript
// Already have: searchChunksByVector() — pgvector cosine similarity
// Add:          searchChunksByKeyword() — PostgreSQL full-text search via tsvector
// Then:         hybridSearch() — merge and rerank both result sets
```

**c) Source type expansion**

Add `"terminal_output"` and `"work_journal"` to the `sourceTypeEnum` in `packages/db/src/schema.ts`. No new library.

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| PostgreSQL `tsvector` (via Drizzle `sql` tag) | Built-in | Keyword search fallback for RAG | pgvector handles semantic; tsvector handles exact keyword matches; no external search engine needed at this scale |

**Why NOT adding a dedicated vector database (Pinecone, Weaviate, Chroma):**
pgvector is already operational with 768-dim embeddings, cosine similarity, and GIN indexes. External vector DB adds infrastructure complexity and a network hop. At <1M documents for a single-user system, pgvector is the correct choice.

---

### 4. Tiered Autonomy System

**Goal:** Green (auto-execute) / Yellow (notify + auto-proceed after timeout) / Red (block until explicit approval) based on action risk level.

**No new library needed.** This is a schema + service pattern built on existing infrastructure.

| Component | Implementation | Notes |
|-----------|---------------|-------|
| Risk classification | New `autonomyTierEnum` in Drizzle schema (`green`, `yellow`, `red`) | Extends existing `approvals` table |
| Auto-proceed timer | BullMQ delayed job in existing `notifications` queue | Yellow tier: add job with 30-min delay; if not rejected, auto-approve |
| Approval notifications | Existing `NotificationsService` + Discord webhook | Already wired; add tier metadata to notification |
| Risk assessment | New `RiskClassifier` class in `agent-server/src/services/` | Uses LLM to classify action risk; caches classification per tool name |

The existing `approvals` table and `request_approval` orchestrator tool already handle the blocking pattern. The tiered system layers risk-based routing on top: green actions skip approval entirely, yellow trigger notifications with auto-timeout, red require explicit human approval (existing behavior).

---

### 5. Work Journal & Daily Standup

**Goal:** Persistent, browsable activity log of what the agent did; daily proactive standup generation.

**No new library needed.** New Drizzle schema + BullMQ recurring job.

| Component | Implementation | Notes |
|-----------|---------------|-------|
| `workJournalEntries` table | New Drizzle table — `id`, `entryType`, `summary`, `details` (jsonb), `goalId` (FK), `taskId` (FK), `createdAt` | `entryType`: `goal_started`, `goal_completed`, `task_executed`, `tool_used`, `approval_requested`, `standup` |
| Auto-logging | `WorkJournalService` — called from TaskDispatcher after each task | Hooks into existing task lifecycle |
| Daily standup | BullMQ recurring job (existing scheduler) — LLM-generated narrative from yesterday's entries | Same pattern as existing `BriefingWorker` |
| Dashboard page | React + TanStack Query — chronological feed with filters | Extends existing dashboard pattern |

---

### 6. Multi-Project Awareness

**Goal:** Agent understands all active projects (ai-cofounder, clip-automation, avion-backups) — can check status, switch context, ingest code.

**Recommendation: `simple-git` already available; add `chokidar@4` for optional filesystem watching**

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `simple-git` | `^3.32.3` | TypeScript-native git operations across multiple repository paths | Already used via WorkspaceService. Add `MultiProjectService` that holds a registry of project paths + `simpleGit()` instances. |
| `chokidar` | `^4.x` (NOT v5) | Optional: watch project directories for changes, trigger re-ingestion | v4 supports both ESM and CommonJS (our setup). v5 is ESM-only which conflicts with existing CJS build. Use for file-change-triggered RAG updates. |

**Why NOT chokidar v5:** Project uses CommonJS module resolution (`Node16` tsconfig). v5 is ESM-only as of November 2025. v4 has the same watching capabilities.

```bash
npm install simple-git -w @ai-cofounder/agent-server   # if not already present
npm install chokidar@^4 -w @ai-cofounder/agent-server
npm install -D @types/chokidar -w @ai-cofounder/agent-server
```

**Multi-project config:** Store project registry in environment (`.env` `MONITORED_PROJECTS=path1:name1,path2:name2`) or in a DB table `projects` — new lightweight schema addition.

---

### 7. Smart Financial Tracking

**Goal:** Track LLM API costs per provider/model/goal, set budget alerts, surface optimization suggestions.

**No new external service needed.** Build on existing `providerHealth` and `toolExecutions` tables.

| Component | Implementation | Notes |
|-----------|---------------|-------|
| `llmCostEvents` table | New Drizzle table — `id`, `provider`, `model`, `inputTokens`, `outputTokens`, `cachedTokens`, `costUsd` (numeric), `goalId` (FK), `taskId` (FK), `requestId`, `createdAt` | Per-request cost recording |
| Cost calculation | Static pricing map in `packages/llm` — `{ "claude-sonnet-4-5": { input: 3.00, output: 15.00 } }` (per 1M tokens) | Update when Anthropic pricing changes; this is the only maintenance point |
| Budget alerts | BullMQ daily job + configurable `DAILY_COST_LIMIT_USD` env var | Already have `DAILY_TOKEN_LIMIT`; add cost-based equivalent |
| Dashboard widget | New "Cost" card in HUD — daily spend, 7-day trend, per-provider breakdown | React + TanStack Query; uses new `/api/costs` routes |

**Why NOT LiteLLM or external cost tracking services:** This is a single-user system with 4 known providers. LiteLLM is a proxy layer that adds a network hop and operational complexity. The pricing table approach is simpler, faster, and fully owned. The existing `providerHealth` table already tracks `requestCount` and `avgLatencyMs` — cost tracking is a natural extension.

**Why NOT Stripe:** Stripe is for billing customers, not tracking your own API spend. The internal cost ledger approach is correct here.

**Pricing reference (current as of 2026-03):**

| Model | Input ($/1M) | Output ($/1M) | Cached Input ($/1M) |
|-------|-------------|--------------|---------------------|
| claude-opus-4-6 | 15.00 | 75.00 | 1.50 |
| claude-sonnet-4-5 | 3.00 | 15.00 | 0.30 |
| claude-haiku-4-5 | 0.80 | 4.00 | 0.08 |
| gemini-2.0-flash | 0.10 | 0.40 | — |
| groq/llama-3.3-70b | ~0.59 | ~0.79 | — |

---

### 8. Content Automation Management (n8n Integration)

**Goal:** Manage YouTube pipeline + other n8n workflows as tracked tasks with status visibility.

**No new library.** The n8n workflow registry is already in the DB (`n8nWorkflows` table) and the `trigger_workflow` / `list_workflows` orchestrator tools are wired. What's needed is:

1. A `ContentPipelineService` that maps named pipelines to their n8n workflow IDs and tracks execution state
2. Ingestion of pipeline run results back into the work journal
3. Dashboard visibility into pending/running/completed content jobs

This is schema + service work, not new library work.

---

## Installation Summary

```bash
# Claude Agent SDK (coding tasks in autonomous mode)
npm install @anthropic-ai/claude-agent-sdk -w @ai-cofounder/agent-server

# Multi-project file watching (optional, for change-triggered RAG updates)
npm install chokidar@^4 -w @ai-cofounder/agent-server
```

**That's it.** All other v2.0 features are implemented via:
- New Drizzle schema tables + migrations
- New service classes in `apps/agent-server/src/services/`
- New BullMQ workers in `packages/queue/src/workers/`
- New orchestrator tools in `apps/agent-server/src/agents/tools/`
- New React dashboard pages + TanStack Query hooks

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `node:child_process` spawn | `node-pty` | Native module, Node.js 24 prebuilt binary issues, no interactive terminal needed |
| `@anthropic-ai/claude-agent-sdk` | Direct Anthropic Messages API | Agent SDK provides full tool loop (file read/write/edit/bash) without reimplementing; use Messages API only for quick LLM calls |
| pgvector hybrid search (in-DB) | Pinecone / Weaviate / Chroma | External vector DB adds infra; pgvector is already operational at current scale |
| Internal pricing table | LiteLLM proxy / external cost tracking | LiteLLM adds network hop + operational complexity for a single-user system |
| chokidar@^4 | chokidar@^5 | v5 is ESM-only; project uses CommonJS tsconfig Node16 resolution |
| BullMQ delayed job for Yellow tier | Database polling loop | BullMQ delayed jobs are precise, don't poll, and use existing infrastructure |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node-pty` | Native C++ module, Node.js 24 prebuilt binary issues; project doesn't need browser terminal UI | `node:child_process` spawn for command streaming |
| Pinecone / Weaviate / Chroma | External vector database adds ops complexity at this scale | pgvector (already operational with 768-dim embeddings) |
| LiteLLM proxy | Proxy layer overhead, extra service to maintain, single-user doesn't need multi-tenant cost tracking | Internal `llmCostEvents` table with static pricing map |
| `langchain` / `llamaindex` | Framework overhead, opinionated abstractions over a custom-built agent system; introduces breaking changes risk | Custom tool loop (already built, 20+ tools, working well) |
| OpenAI Assistants API / vector stores | Vendor lock-in, external state, costs more than self-managed | pgvector + `packages/rag` (already built) |
| `bull-board` dashboard | BullMQ queue dashboard overkill for this use case | Existing dashboard HUD can show queue stats |
| OAuth for dashboard auth | Out of scope per PROJECT.md; JWT is sufficient for single-user | `@fastify/jwt` (already implemented) |

---

## Version Compatibility Notes

| Package | Compatible With | Notes |
|---------|----------------|-------|
| `@anthropic-ai/claude-agent-sdk@^0.2.71` | Node.js 22+ | Tracks Claude Code version parity; updates frequently (daily minor bumps) |
| `chokidar@^4` | Node.js 14+, ESM + CJS | v5 requires Node.js 20+ and ESM-only — avoid for this CJS project |
| `simple-git@^3.32.3` | Node.js 11+, ESM + CJS | Actively maintained; TypeScript bundled |
| `node-pty@1.1.0` (NOT recommended) | Node.js 18-22 best; 24 has binary issues | Listed for reference only — do not use |

---

## Sources

- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript) — API, query options, tool list (HIGH confidence)
- [Claude Code headless mode docs](https://code.claude.com/docs/en/headless) — CLI integration patterns (HIGH confidence)
- [Claude Agent SDK TypeScript releases](https://github.com/anthropics/claude-agent-sdk-typescript/releases) — v0.2.71 confirmed latest (HIGH confidence)
- [GitHub issue #34 — 12s overhead per query()](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34) — Performance issue documented (HIGH confidence)
- [GitHub issue #771 — Node.js spawn bug](https://github.com/anthropics/claude-code/issues/771) — Closed Aug 2025; workaround: `stdio: ["inherit","pipe","pipe"]` (MEDIUM confidence — verify during implementation)
- [Drizzle pgvector guide](https://orm.drizzle.team/docs/guides/vector-similarity-search) — Existing pgvector usage confirmed (HIGH confidence)
- [Drizzle full-text search guide](https://orm.drizzle.team/docs/guides/postgresql-full-text-search) — tsvector via custom SQL (HIGH confidence)
- [chokidar v4 vs v5 migration](https://dev.to/43081j/migrating-from-chokidar-3x-to-4x-5ab5) — v4 ESM+CJS, v5 ESM-only (HIGH confidence)
- [node-pty Node.js 24 compatibility](https://github.com/microsoft/node-pty/releases) — Missing prebuilt binaries for Node.js 24 (MEDIUM confidence — may improve)
- [Anthropic API pricing 2026](https://platform.claude.com/docs/en/about-claude/pricing) — Token costs for cost tracking table (HIGH confidence)
- [simple-git npm](https://www.npmjs.com/package/simple-git) — v3.32.3 latest (HIGH confidence)

---

*Stack research for: v2.0 Autonomous Cofounder additions to existing AI Cofounder platform*
*Researched: 2026-03-09*
