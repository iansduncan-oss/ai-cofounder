# Project Research Summary

**Project:** AI Cofounder v2.0
**Domain:** Autonomous AI agent platform
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

AI Cofounder v2.0 transforms a reactive multi-agent platform into an autonomous engineering partner. The existing infrastructure is remarkably complete — RAG package is fully built (just needs wiring), BullMQ queues handle scheduling, approvals API exists, and LLM usage tracking is already populated. The v2.0 work is primarily integration and new services on top of proven foundations, not greenfield development.

The recommended approach is: wire RAG first (unblocks memory for everything else), then add terminal access paired with tiered autonomy (safety-coupled — never ship shell execution without risk gating), then layer on work journal, multi-project awareness, financial tracking, and content automation management. The dashboard command center comes last as the integration layer over all new APIs.

The critical risks are: unrestricted shell access (use `execFile` with allowlists, not free-form shell strings), RAG context poisoning from stale chunks (add age filters and score floors), runaway token budgets in autonomous sessions (enforce hard per-session limits, not just warnings), and autonomy bypass via prompt injection (implement hard guards at tool execution layer, not LLM prompts).

## Key Findings

### Recommended Stack

Only two new npm packages needed: `@anthropic-ai/claude-agent-sdk@^0.2.71` (for delegating complex coding tasks) and `chokidar@^4` (optional filesystem watching for RAG re-ingestion). Everything else is schema additions, new services, and new dashboard pages built on existing infrastructure.

**Core technologies:**
- `node:child_process` spawn: terminal access — already used in WorkspaceService, no new dependencies
- PostgreSQL `tsvector` via Drizzle: hybrid RAG search — keyword fallback alongside pgvector semantic search
- `@anthropic-ai/claude-agent-sdk`: autonomous coding tasks — 12s cold start, use via BullMQ workers only
- Static pricing map in `packages/llm`: cost tracking — simpler than LiteLLM proxy for single-user

**Do NOT add:** node-pty (native binary issues on Node 24), Pinecone/Weaviate/Chroma (pgvector sufficient), LiteLLM (unnecessary proxy layer), LangChain (conflicts with custom agent system).

### Expected Features

**Must have (table stakes):**
- Terminal/shell access tool (scoped, autonomy-gated)
- RAG wired to orchestrator (conversations + decisions + workspace files)
- Tiered autonomy (green/yellow/red) with per-tool risk classification
- Daily work journal with LLM narrative
- Multi-project context registration
- LLM cost dashboard with budget alerts
- Pending approvals elevated in dashboard

**Should have (differentiators):**
- Per-tool-call autonomy scoring (not just per-session)
- Auto-ingestion of workspace files into RAG
- Smart financial tracking with optimization suggestions
- Multi-project git status overview

**Defer (v2.1+):**
- Anticipatory task suggestions (needs weeks of journal data)
- Smart financial tracking beyond LLM costs (VPS + n8n estimation)
- Advanced voice conversation improvements

### Architecture Approach

All new features are services in `apps/agent-server/src/services/` with corresponding orchestrator tools, API routes, and dashboard pages. Five new DB tables (`journal_entries`, `project_registry`, `cost_events`, `autonomy_decisions`, `content_automation_runs`), zero new packages. Autonomy gate lives in `tool-executor.ts` to cover all tools. RAG context injected once per orchestrator invocation via system prompt enrichment.

**Major components:**
1. `AutonomyService` — risk scoring at tool execution layer, gates all side-effect tools
2. `TerminalService` — shell execution with `execFile`, workspace-scoped, autonomy-gated
3. `WorkJournalService` — aggregates activity data, generates LLM narrative, extends briefing system
4. `ProjectRegistryService` — lightweight project index, on-demand context retrieval via RAG
5. `CostTrackingService` — aggregates `llmUsage` + external costs, budget alerts via notifications

### Critical Pitfalls

1. **Terminal access bypasses sandbox** — Use `execFile` (not `exec`), enforce `resolveSafe()` on all paths, maintain command allowlists, log every execution
2. **RAG context poisoning** — Raise `minScore` to 0.6 for system prompt injection, add `max_chunk_age_days` filter, log retrieval results with scores
3. **Runaway token budget** — Make `tokenBudget` a hard limit (abort mid-session), add per-session caps, enforce cooldown between autonomous sessions
4. **Autonomy tier bypass** — Implement as hard constraint in `tool-executor.ts`, not LLM prompt suggestion; approval tier in config, not manipulable by prompt injection
5. **Multi-project context explosion** — Never inject all project contexts; use selective RAG retrieval; cap at 2,000 tokens per project, max 2 projects per session

## Implications for Roadmap

### Phase 8: RAG Memory Integration
**Rationale:** RAG package is fully built but unwired — this is pure plumbing that unblocks all memory-aware features (journal, project context, cost awareness)
**Delivers:** Orchestrator uses semantic memory, conversations auto-ingested, hybrid search (vector + keyword)
**Addresses:** Persistent memory table stakes
**Avoids:** Context poisoning (score floors, age filters, model tracking)

### Phase 9: Terminal Access + Autonomy Gate
**Rationale:** Safety-coupled — shell execution without risk gating is dangerous and must not ship separately
**Delivers:** `run_shell` tool, `AutonomyService` with green/yellow/red evaluation, hard guards in tool-executor
**Addresses:** Autonomous execution table stakes
**Avoids:** Terminal bypass, autonomy tier bypass, runaway token budget

### Phase 10: Work Journal + Daily Standup
**Rationale:** Depends on Phase 8 (RAG provides richer narrative context from memories)
**Delivers:** Structured journal entries, LLM narrative generation, daily standup via extended briefing system
**Addresses:** Work visibility, daily standup
**Avoids:** Journal noise (significance filtering, structured categories)

### Phase 11: Multi-Project Awareness
**Rationale:** Depends on Phase 8 (RAG indexes project READMEs/code for context injection)
**Delivers:** Project registry, scoped tools, context injection, multi-project git status
**Addresses:** Cross-project awareness
**Avoids:** Context explosion (selective retrieval, token budget per project)

### Phase 12: Financial Tracking
**Rationale:** Independent — `llmUsage` data already exists, this adds aggregation + UI
**Delivers:** Cost dashboard, budget alerts, per-goal cost attribution, optimization suggestions
**Addresses:** Financial visibility
**Avoids:** Attribution gaps (instrument LlmRegistry for per-call costUsd)

### Phase 13: Content Automation Management
**Rationale:** Extends existing n8n integration with persistence layer
**Delivers:** Tracked content pipeline runs, dashboard visibility, managed workflow triggers
**Addresses:** YouTube pipeline + content workflow management

### Phase 14: Dashboard Command Center
**Rationale:** Depends on all API routes (Phases 8-13) — pure frontend integration
**Delivers:** Journal page, costs page, projects page, enhanced HUD, approval context
**Addresses:** Unified command center experience

### Phase Ordering Rationale

- RAG first because it's already built and unblocks memory for journal, project context, and cost awareness
- Terminal + autonomy together because security and execution are inseparable
- Journal after RAG because richer narrative comes from memory-aware context
- Multi-project after RAG because project context comes from RAG retrieval
- Financial tracking is independent but benefits from LlmRegistry instrumentation added during autonomy phase
- Content automation is independent, low dependency
- Dashboard last because it's the UI layer over all preceding APIs

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 9 (Terminal + Autonomy):** Claude Agent SDK integration needs testing for Node.js 24 spawn behavior
- **Phase 8 (RAG):** Verify RAG ingestion worker processor is actually wired (not just type-defined)

Phases with standard patterns (skip research-phase):
- **Phase 10 (Journal):** Extends existing briefing pattern
- **Phase 12 (Financial):** Standard aggregation + dashboard
- **Phase 14 (Dashboard):** Standard React pages

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Only 2 new packages; everything else is built-in or existing |
| Features | HIGH | Codebase inspection confirms most infrastructure exists |
| Architecture | HIGH | Follows established patterns in the codebase |
| Pitfalls | HIGH | Codebase-verified + current industry research |

**Overall confidence:** HIGH

### Gaps to Address

- Claude Agent SDK Node.js 24 compatibility: test `stdio: ["inherit", "pipe", "pipe"]` workaround during Phase 9
- RAG ingestion worker wiring: verify `ragIngestion` processor function exists in `workers.ts` during Phase 8
- Autonomy rule configuration: define specific green/yellow/red tool classifications with Ian during Phase 9 planning
- Embedding model tracking: add `embeddingModel` column to `ingestionStates` before any production ingestion

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `packages/rag/`, `packages/queue/`, `packages/db/src/schema.ts`, `apps/agent-server/src/`
- [Claude Agent SDK TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Anthropic API pricing 2026](https://platform.claude.com/docs/en/about-claude/pricing)
- [Drizzle pgvector guide](https://orm.drizzle.team/docs/guides/vector-similarity-search)

### Secondary (MEDIUM confidence)
- [OWASP Top 10 for Agentic Applications 2026](https://www.aikido.dev/blog/owasp-top-10-agentic-applications)
- [MemoryGraft: Persistent Compromise via Poisoned RAG](https://arxiv.org/abs/2512.16962)
- [CSA Autonomy Levels for Agentic AI](https://cloudsecurityalliance.org/blog/2026/01/28/levels-of-autonomy)
- [Google Cloud Agentic AI Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)

### Tertiary (LOW confidence)
- Claude Agent SDK Node.js 24 spawn bug (issue #771 closed Aug 2025 — verify during implementation)
- chokidar v4 vs v5 ESM compatibility (verify at install time)

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
