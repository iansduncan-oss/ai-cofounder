# Feature Research

**Domain:** Autonomous AI Cofounder Platform — v2.0 Milestone
**Researched:** 2026-03-09
**Confidence:** MEDIUM-HIGH (codebase analysis HIGH, industry patterns MEDIUM)

---

## Context: What Already Exists

This milestone adds to a fully operational platform. The following are NOT features to build:

- Multi-agent orchestration (20+ tools, 5 specialist agents) — done
- BullMQ queues + worker + SSE streaming — done
- Approvals CRUD API (`/api/approvals`) — done, needs UI elevation
- LLM usage tracking (`llm_usage` table, `getUsageSummary()`) — done, needs richer UI
- RAG package (`packages/rag`: chunker, retriever, ingester) — done, needs wiring to orchestrator
- Work sessions table (`work_sessions`) — schema exists, needs population + journal UI
- Activity feed page (tasks/goals/approvals timeline) — exists, needs daily journal overlay
- n8n workflow registry (`n8n_workflows` table) — done, needs content pipeline management UI
- Reflections + decisions endpoints — done, underutilized
- pgvector + Gemini embeddings for semantic memory — done in `memories` table

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume a v2.0 "autonomous AI cofounder" has. Missing = product feels like a prototype.

| Feature | Why Expected | Complexity | Depends On | Notes |
|---------|--------------|------------|-----------|-------|
| Terminal / shell access tool | Autonomous execution requires running arbitrary commands — file moves, npm installs, server restarts | HIGH | Sandbox (Docker already exists) | Must use Docker sandbox already in `packages/sandbox` — don't bypass it. Shell tool wrapping sandbox's bash execution |
| RAG wired to orchestrator | Memory recall via semantic search, not just keyword. Every serious agent platform does this | MEDIUM | `packages/rag` exists | Wire `retrieve()` into orchestrator's `recall_memories` tool. Augment with conversation + decision sources |
| Tiered autonomy (green/yellow/red) | Users need confidence the agent won't delete production data unilaterally | MEDIUM | Approvals API exists | Tag each tool call with a risk tier. Auto-proceed green, queue yellow for async review, block + notify red |
| Daily work journal | Autonomous agents must show what they did. Without this, users don't trust them | MEDIUM | `work_sessions` schema exists | Structured daily log: goals touched, decisions made, code written, hours active. Browsable in dashboard |
| Morning standup brief | Proactive summary before user starts work. "Here's where things stand, here's what I recommend." | MEDIUM | Briefing system exists (Discord) | Extend existing briefing to produce structured standup JSON, render in dashboard, optional TTS via ElevenLabs |
| Pending approvals in dashboard | Yellow-tier actions must be reviewable without switching to Discord | MEDIUM | Approvals route exists, dashboard has approvals page | Elevate approvals page: action preview, approve/reject with one click, batch resolve |
| Multi-project context registration | Agent needs to know which repos/projects it manages — can't assume everything in WORKSPACE_DIR | MEDIUM | New DB table | Simple registry: project name, local path, repo URL, description. Referenced by tools |
| LLM cost dashboard with budget | Token spend is real money. Without visibility, costs spiral | LOW | `llm_usage` table + `getUsageSummary()` exist | Daily/weekly/monthly spend chart, per-provider breakdown, budget alert threshold, trend vs prior period |
| Content pipeline status view | n8n YouTube workflows are already in production. Users need to see pipeline health without logging into n8n | MEDIUM | `n8n_workflows` table, n8n API | Dashboard view: workflow list, last run status, next scheduled run, trigger manually, recent run history |

### Differentiators (Competitive Advantage)

Features that make this platform genuinely different from GitHub Copilot, Devin, or a generic n8n setup.

| Feature | Value Proposition | Complexity | Depends On | Notes |
|---------|-------------------|------------|-----------|-------|
| Autonomy level per tool call (not per session) | Most platforms set autonomy at a session level. Per-call risk scoring makes the system much safer and more useful simultaneously | HIGH | Tiered autonomy table stakes | Each tool call carries metadata: `riskTier`, `rationale`, `reversible`. Orchestrator decides tier based on tool + context |
| Auto-ingestion of workspaces into RAG | Agent proactively indexes new files when they change — no manual "add to context" step | HIGH | RAG package, `ingestion_state` table exists | File watcher or post-git-operation hook triggers re-ingestion of changed files into `document_chunks` |
| Work journal with LLM narrative generation | Daily log is not just a list of DB rows — the agent writes a prose summary of the day's work, decisions made, and what's next | MEDIUM | Work sessions + LLM | Similar to existing briefing generation. "Today I completed X, encountered Y, deferred Z because..." |
| Smart financial tracking across all services | Track not just LLM costs but also infer infrastructure costs (VPS hours, n8n runs). Give optimization suggestions | HIGH | `llm_usage` exists, VPS monitoring exists | LLM: compute from `llm_usage`. VPS: Hetzner API or fixed monthly estimate. n8n: execution count × estimate. Optimization: suggest cheaper models for routine tasks |
| Anticipatory task suggestions | Agent surfaces "things you should probably do next" based on recent activity, pending items, and project state — without being asked | HIGH | RAG, decisions, work journal | Runs during morning standup generation. Not a separate LLM call — piggybacks on briefing generation |
| Multi-project git status overview | At-a-glance view of all registered projects: uncommitted changes, open PRs, CI status, last deploy | MEDIUM | Multi-project registry, monitoring service | Extends existing MonitoringService. Per-project status card on dashboard |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Unrestricted host shell execution | "Agent needs to run any command" | Bypasses sandbox isolation, can destroy production data or secrets, no audit trail | Use Docker sandbox (`packages/sandbox`) for all shell execution. It already supports Bash. Add a `run_command` tool that delegates there |
| Real-time streaming for all agent actions | "I want to see every tool call live" | SSE for pipeline execution already deferred. Adding per-tool-call streaming would require major backend refactor and adds significant test surface | Polling-based live refresh (already used for pipelines) is adequate. Add SSE only for long-running terminal sessions if specifically needed |
| Full OAuth for content platform connections | "Connect to YouTube, Stripe, etc. directly" | OAuth token storage, refresh flow complexity, security surface — enormous scope for a single user | Use n8n as the OAuth bridge. n8n already handles YouTube credentials. Agent triggers n8n workflows, not direct API calls |
| Automated financial projections / forecasting | "Tell me my runway" | LLM-generated financial projections with incomplete data are unreliable and potentially misleading | Show actuals only: what was spent, per provider, per period. Optimization suggestions are fine. No forecasting |
| Autonomous deployment without approval | "Let the agent deploy when ready" | A bad deploy at 3am is worse than a slow deploy tomorrow morning. Loss of trust is unrecoverable | Yellow-tier approval for deploys. Agent prepares, stages, notifies. Human approves. Agent executes |
| Per-platform content scheduling UI | "Manage YouTube, Twitter, LinkedIn from dashboard" | This is a content management system — completely different product surface | Surface n8n workflow status only. Let n8n handle the scheduling logic it was designed for |
| GraphQL API | "Better for frontend queries" | Introduces significant complexity (resolvers, schema, N+1 issues) into an already-working REST stack | REST with pagination is fine for a single-user dashboard. Add query params for filtering if needed |

---

## Feature Dependencies

```
Terminal / shell access tool
    └──requires──> Docker sandbox (exists in packages/sandbox)
    └──requires──> Tiered autonomy risk scoring (new)
                       └──requires──> Approvals API (exists)
                       └──requires──> Approval notification (exists in notifications.ts)

RAG wired to orchestrator
    └──requires──> packages/rag (exists — chunker, retriever, ingester)
    └──requires──> pgvector + Gemini embeddings (exists in memories table)
    └──enhances──> Work journal (journal entries become RAG-searchable)
    └──enhances──> Tiered autonomy (past decisions inform risk assessment)

Work journal
    └──requires──> work_sessions table (exists, needs population)
    └──requires──> LLM narrative generation (extends existing briefing pattern)
    └──enhances──> Morning standup brief (journal is the source material)

Multi-project registry
    └──requires──> New DB table (project_contexts)
    └──enhances──> Terminal / shell access (scoped to project)
    └──enhances──> Multi-project git status overview (feeds monitoring)

LLM cost dashboard
    └──requires──> llm_usage table (exists, populated)
    └──requires──> getUsageSummary() (exists)
    └──enhances──> Smart financial tracking (LLM is one cost center)

Content pipeline status
    └──requires──> n8n_workflows table (exists)
    └──requires──> n8n API access (exists via n8n route + trigger_workflow tool)

Morning standup brief (dashboard)
    └──requires──> Existing briefing system in queue/workers
    └──requires──> Work journal (provides yesterday's activity)
    └──enhances──> Anticipatory task suggestions (generated alongside)

Multi-project git status
    └──requires──> Multi-project registry (new)
    └──requires──> MonitoringService (exists — already polls GitHub)
```

### Dependency Notes

- **Terminal tool requires tiered autonomy:** Shell execution without risk classification is dangerous. Must be built together, not sequentially.
- **RAG wiring is prerequisite for anticipatory suggestions:** Anticipatory suggestions need semantic context about project state and past decisions.
- **Work journal requires active population:** The `work_sessions` table exists but is sparsely populated. Every orchestrator run must record to it before the journal UI is useful.
- **Multi-project registry unlocks several features:** Git status overview, scoped terminal execution, and multi-project RAG all depend on a consistent project registry.

---

## MVP Definition

This is a subsequent milestone on a live platform, so "MVP" means the minimal set that delivers the v2.0 goal: autonomous engineering partner that works independently and manages all systems.

### Launch With (v2.0 core — Phase 1-3)

- [x] Terminal / shell access tool (scoped to sandbox, tiered autonomy gate)
- [x] Tiered autonomy (green/yellow/red) with per-tool risk classification
- [x] RAG wired to orchestrator (conversations + decisions + workspace files)
- [x] Work journal population in every orchestrator run
- [x] Multi-project registry (DB table + CRUD API + project-scoped tools)
- [x] Dashboard: pending approvals elevated (preview + one-click resolve)
- [x] Dashboard: work journal page (browsable daily log with LLM narrative)

### Add After Core Works (v2.0 full — Phase 4-5)

- [ ] Morning standup brief in dashboard (after journal exists)
- [ ] LLM cost dashboard with budget alerts (after usage UI gap is clear)
- [ ] Content pipeline status view (after project registry is stable)
- [ ] Multi-project git status overview (after project registry stable)
- [ ] Auto-ingestion of workspace files into RAG (after RAG wiring validated)

### Future Consideration (v2.1+)

- [ ] Anticipatory task suggestions (needs several weeks of journal history to be useful)
- [ ] Smart financial tracking beyond LLM costs (VPS + n8n estimation)
- [ ] Work journal narrative TTS audio playback (nice UX, low priority)
- [ ] LLM cost optimization suggestions (needs pattern data first)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Terminal / shell access tool | HIGH | HIGH | P1 |
| Tiered autonomy (green/yellow/red) | HIGH | MEDIUM | P1 |
| RAG wired to orchestrator | HIGH | MEDIUM | P1 |
| Work journal (population + UI) | HIGH | MEDIUM | P1 |
| Multi-project registry | HIGH | LOW | P1 |
| Dashboard approvals elevation | HIGH | LOW | P1 |
| Morning standup brief in dashboard | HIGH | MEDIUM | P2 |
| LLM cost dashboard | MEDIUM | LOW | P2 |
| Content pipeline status view | MEDIUM | MEDIUM | P2 |
| Multi-project git status | MEDIUM | MEDIUM | P2 |
| Auto-ingestion of workspace files | MEDIUM | HIGH | P2 |
| Work journal LLM narrative | MEDIUM | LOW | P2 |
| Anticipatory task suggestions | HIGH | HIGH | P3 |
| Smart financial tracking (VPS+n8n) | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v2.0 to feel autonomous
- P2: Should have, completes the command center experience
- P3: Nice to have, future milestone

---

## Competitor Feature Analysis

| Feature | Devin / Similar Coding Agents | Cursor / IDE Agents | Our Approach |
|---------|-------------------------------|---------------------|--------------|
| Terminal access | Full unrestricted shell | Editor-integrated terminal | Sandboxed Docker bash — safer, auditable |
| Memory / context | Session-scoped only | Codebase index per project | Persistent pgvector RAG across sessions, multi-source |
| Autonomy control | Binary (approve all or none) | Per-command approval prompts | Three-tier risk classification with async approval queue |
| Work visibility | Activity log in UI | None | Structured daily journal with LLM narrative |
| Cost tracking | None | None | Per-provider per-task cost tracking with budget alerts |
| Multi-project | Single workspace | Single workspace | Registered project registry, cross-project monitoring |
| Content automation | None | None | n8n pipeline management + status in dashboard |

---

## Confidence Notes

| Area | Confidence | Basis |
|------|------------|-------|
| Terminal/sandbox approach | HIGH | `packages/sandbox` already exists and works for code execution |
| RAG wiring approach | HIGH | `packages/rag` has full retriever/ingester, just needs orchestrator integration |
| Tiered autonomy design | MEDIUM | Green/yellow/red pattern is well-established industry pattern (verified via WebSearch, multiple sources agree) |
| Work journal implementation | HIGH | `work_sessions` table exists, pattern mirrors existing briefing generation |
| Financial tracking scope | HIGH | `llm_usage` table is well-populated, `getUsageSummary()` exists — UI-only work |
| Multi-project registry | MEDIUM | No existing pattern in codebase, needs new table design |
| Content pipeline UI | HIGH | `n8n_workflows` table + existing n8n API route — dashboard view is straightforward |
| Anticipatory suggestions | LOW | Requires sufficient journal history to be meaningful — premature without data |

---

## Sources

- Codebase analysis: `packages/rag/src/`, `packages/db/src/schema.ts`, `apps/agent-server/src/routes/`, `apps/dashboard/src/routes/`
- [Autonomy Levels for Agentic AI | CSA](https://cloudsecurityalliance.org/blog/2026/01/28/levels-of-autonomy) — green/yellow/red framework
- [The Practical Guide to the Levels of AI Agent Autonomy | Medium](https://seanfalconer.medium.com/the-practical-guide-to-the-levels-of-ai-agent-autonomy-ac5115d3af26)
- [AI Agent Security: The Complete Enterprise Guide 2026 | MintMCP](https://www.mintmcp.com/blog/ai-agent-security) — per-tool risk classification
- [How to sandbox AI agents in 2026 | Northflank](https://northflank.com/blog/how-to-sandbox-ai-agents) — sandbox patterns
- [Sandboxing | Claude Code Docs](https://code.claude.com/docs/en/sandboxing) — sandboxed bash execution pattern
- [Architecting Persistent Memory for AI Agents | developers.dev](https://www.developers.dev/tech-talk/architecting-persistent-memory-for-ai-agents-engineering-patterns-for-state-and-long-term-recall.html)
- [AI Context Memory: How Assistants Remember Work | Skywork](https://skywork.ai/blog/ai-agent/ai-context-memory-work-context) — tiered memory architecture
- [pgvector RAG with PostgreSQL | EnterpriseDB](https://www.enterprisedb.com/blog/rag-app-postgres-and-pgvector) — pgvector approach validation
- [RAG Explained: Seven Architectures | Nacho Conesa](https://nachoconesa.com/blog/rag-arquitectura-memoria-ia-generativa?lang=en) — hybrid search is now default
- [Best LLM Cost Tracking Tools 2026 | AI Cost Board](https://aicostboard.com/guides/best-llm-cost-tracking-tools-2026)
- [Mission Control — open-source agent task management | GitHub](https://github.com/MeisnerDan/mission-control) — dashboard pattern reference
- [n8n AI Agent Integrations](https://n8n.io/integrations/agent/) — n8n as content automation orchestrator pattern

---
*Feature research for: AI Cofounder v2.0 Autonomous Cofounder milestone*
*Researched: 2026-03-09*
