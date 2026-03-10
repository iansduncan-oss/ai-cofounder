# Architecture Research: v2.0 Autonomous Cofounder

**Domain:** Autonomous multi-agent AI platform — v2.0 feature set
**Researched:** 2026-03-09
**Confidence:** HIGH (based on codebase inspection + current patterns)

---

## Existing Architecture Baseline

Before documenting new components, here is the current system structure that v2.0 extends (not replaces):

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Docker Compose (VPS)                           │
│                                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │dashboard │  │discord   │  │slack     │  │voice-ui  │            │
│  │(React)   │  │bot       │  │bot       │  │(static)  │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │             │             │              │                   │
│       └─────────────┴─────────────┴──────────────┘                  │
│                             │ HTTP (api-client)                      │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                   agent-server (Fastify)                      │    │
│  │  JWT Auth  │  Routes (30+)  │  Orchestrator  │  Specialists   │    │
│  │  Plugins   │  (queue/rag/   │  (20+ tools,   │  (7 agents)    │    │
│  │            │   pipeline/   │   5-round loop) │               │    │
│  │            │   monitoring) │                │               │    │
│  └──────────┬───────────────────────────────────────────────────┘    │
│             │                                                         │
│    ┌────────┴──────────┐                                              │
│    │                   │                                              │
│    ▼                   ▼                                              │
│  ┌──────────┐    ┌──────────────────────────┐                         │
│  │PostgreSQL│    │ Redis (BullMQ queues)     │                         │
│  │+pgvector │    │ 9 queues, pub/sub         │                         │
│  └──────────┘    └──────────┬───────────────┘                         │
│                             │                                         │
│                    ┌────────┴──────────┐                               │
│                    │   Worker Process   │                               │
│                    │  (BullMQ workers, │                               │
│                    │  RAG, reflections,│                               │
│                    │  monitoring)      │                               │
│                    └───────────────────┘                               │
└─────────────────────────────────────────────────────────────────────┘
```

**What already exists (do not re-implement):**
- `packages/rag` — chunker, retriever, ingester (full implementation, not wired to orchestrator)
- `packages/queue` — 9 queues including `rag-ingestion`, `reflections`, `subagent-tasks`
- `packages/db` — `documentChunks`, `ingestionState`, `workSessions`, `memories` (with embeddings), `reflections`, `approvals`, `llmUsage` tables all exist
- `packages/sandbox` — Docker sandboxed code execution (TS/JS/Python/Bash)
- `apps/agent-server/src/routes/rag.ts` — RAG status, ingest trigger, chunk count endpoints
- `apps/agent-server/src/services/workspace.ts` — WorkspaceService with git ops (WorkspaceDir scoped)
- Git tools: clone, status, diff, add, commit, log, pull, branch, checkout, push
- Sandbox tool: `execute_code` (no network, 256MB RAM, 30s timeout)
- `workSessions` table — tracks autonomous execution logs with actions taken

---

## New Components Required for v2.0

### System Overview: v2.0 Additions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NEW in v2.0 (additions only)                              │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │              Dashboard — v2.0 Command Center additions                │   │
│  │   WorkJournal  │  AutonomyPanel  │  CostDashboard  │  RAGStatus       │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│                                   ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │              agent-server — New Services & Routes                     │   │
│  │                                                                       │   │
│  │  TerminalService ─── run_shell tool (tiered + sandboxed)              │   │
│  │  AutonomyService ─── risk scoring, approval routing                   │   │
│  │  WorkJournalService ─ standup, activity log aggregation               │   │
│  │  CostTrackingService ─ multi-source cost aggregation + alerts         │   │
│  │  ProjectRegistryService ─ multi-project index + context injection     │   │
│  │  ContentAutomationService ─ n8n workflow management                   │   │
│  │                                                                       │   │
│  │  Routes: /api/journal, /api/autonomy, /api/costs, /api/projects       │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │              Orchestrator — Tool additions                            │   │
│  │  run_shell  │  get_journal  │  list_projects  │  get_costs            │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │              packages/db — New tables                                 │   │
│  │  journal_entries  │  project_registry  │  cost_events                │   │
│  │  autonomy_decisions  │  content_automation_runs                       │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
│                                   │                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐   │
│  │              packages/queue — New jobs (extend existing workers)      │   │
│  │  JournalJob  │  AutonomousTaskJob (extends AgentTaskJob)              │   │
│  └───────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### New Services (apps/agent-server/src/services/)

| Service | Responsibility | New or Modified |
|---------|----------------|-----------------|
| `TerminalService` | Shell command execution with tiered permission enforcement. Wraps `WorkspaceService.runCommand()` — NOT node-pty (no PTY needed for agent use). Uses `execFile` with timeout, cwd, env scoping. | NEW |
| `AutonomyService` | Risk-scores proposed actions (green/yellow/red). Checks action type, target, blast radius. Blocks red, approves green, queues yellow for approval. | NEW |
| `WorkJournalService` | Aggregates agent activity into daily/weekly narrative. Reads from `workSessions`, `toolExecutions`, `goals`, `tasks`, `reflections`. Generates natural-language summaries. | NEW |
| `CostTrackingService` | Aggregates `llmUsage` + VPS costs + n8n API costs. Fires alert thresholds. Exports per-period breakdowns. | NEW |
| `ProjectRegistryService` | Maintains index of all projects (local repos, VPS services, GitHub repos). Injects relevant project context into agent system prompt. | NEW |
| `ContentAutomationService` | Extends existing `N8nService`. Adds managed task concept: content automation runs tracked in DB, outcomes persisted. | EXTENDS `N8nService` |
| `WorkspaceService` | Add `runCommand()` method for executing shell commands in workspace repos. Existing path traversal protection applies. | MODIFIED (additive) |
| `monitoring.ts` | Extend to include project registry health checks. | MODIFIED (additive) |

### New Orchestrator Tools (apps/agent-server/src/agents/tools/)

| Tool | Service | Purpose |
|------|---------|---------|
| `run_shell` | `TerminalService` + `AutonomyService` | Execute shell in a workspace repo. Autonomy-gated: green runs immediately, yellow queues for approval, red blocked. |
| `get_work_journal` | `WorkJournalService` | Retrieve recent agent activity log, daily standup summary. |
| `list_projects` | `ProjectRegistryService` | List known projects with status (active, VPS health, last CI run). |
| `get_project_context` | `ProjectRegistryService` | Get deep context for a specific project (README, recent commits, open issues). |
| `get_costs` | `CostTrackingService` | Get cost breakdown by period, provider, or goal. |
| `run_content_automation` | `ContentAutomationService` | Trigger a managed content automation workflow with outcome tracking. |

### New DB Tables (packages/db/src/schema.ts)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `journal_entries` | Daily/weekly work journal entries | `date`, `type` (daily/weekly), `content` (LLM narrative), `rawData` (jsonb), `generatedAt` |
| `project_registry` | Known projects index | `name`, `path` (local or remote), `type` (repo/vps-service/n8n), `lastSeenAt`, `metadata` (jsonb: branch, CI status, description) |
| `cost_events` | External cost events (VPS, n8n, other SaaS) | `source`, `periodStart`, `periodEnd`, `amountUsd`, `category`, `metadata` |
| `autonomy_decisions` | Audit log of all autonomy evaluations | `toolName`, `input` (jsonb), `riskLevel` (green/yellow/red), `reason`, `decision` (run/queued/blocked), `goalId`, `taskId`, `approvalId` |
| `content_automation_runs` | Managed content automation execution log | `workflowName`, `trigger`, `input` (jsonb), `output` (jsonb), `status`, `durationMs`, `goalId` |

### Modified DB Tables

| Table | Change |
|-------|--------|
| `workSessions` | Already has `actionsTaken` jsonb — add `autonomyLevel` field (green/yellow/red) to track session's autonomy tier. |
| `approvals` | Already exists with `taskId` FK. New: add optional `autonomyDecisionId` FK so shell-tool approvals link to audit log. |

---

## Feature Integration Map

### Feature 1: Autonomous Task Execution (Terminal Access)

**What's needed:**
1. `WorkspaceService.runCommand(repoDir, cmd, args, opts)` — additive method using `execFile` with cwd, timeout, stdio capture
2. `TerminalService` — wraps `runCommand`, enforces cwd to workspace repos, blocks dangerous commands by pattern (rm -rf /, sudo, etc.)
3. `AutonomyService` — evaluates `run_shell` calls for risk. Risk tiers:
   - GREEN: read-only (ls, cat, git status, npm test, git diff)
   - YELLOW: write-side-effects (npm install, git commit, git push, deploy scripts)
   - RED: destructive/escaping (rm -rf, curl | bash, sudo, path escaping workspace)
4. `run_shell` orchestrator tool — calls TerminalService, gates on AutonomyService, creates `autonomy_decisions` record, optionally creates `approvals` record for yellow tier

**What does NOT change:** `packages/sandbox` (Docker sandboxed `execute_code`) remains for untrusted code. `run_shell` is for trusted agent operations in the workspace — different use case. Both coexist.

**Integration with existing approval flow:** Yellow-tier `run_shell` calls the existing `createApproval()` DB function and `notifyApprovalCreated()`. The existing approvals dashboard page already shows pending approvals. No new UI needed for approvals.

### Feature 2: Persistent RAG Memory

**Current state:** `packages/rag` (chunker, retriever, ingester) is FULLY BUILT. `documentChunks` and `ingestionState` tables exist. `GET/POST /api/rag/` routes exist. RAG ingestion queue worker is defined. The **only missing piece** is wiring RAG retrieval into the orchestrator's context injection.

**What's needed:**
1. Wire `packages/rag` retrieval into `orchestrator.ts` system prompt construction — call `retrieve()` at the start of each orchestrator invocation and prepend `formatContext()` output to the system prompt
2. Ensure `packages/queue` RAG ingestion worker (`workers.ts` `ragIngestion` processor) is fully implemented — currently defined as interface but processor function may not be wired to actual `ingestFiles`/`ingestText`
3. Automatic ingestion triggers: after each conversation (ingest messages), after each goal completion (ingest outputs), after each git push (ingest committed files)
4. Configure which `sourceType` feeds each agent context (coder gets `git` chunks, researcher gets `markdown` chunks, general gets `conversation` + `memory`)

**What does NOT change:** DB tables, RAG package, queue jobs, routes — all exist.

### Feature 3: Tiered Autonomy System

**Current state:** `approvals` table and `createApproval()` / `notifyApprovalCreated()` exist. TaskDispatcher already checks pending approvals before each task.

**What's needed:**
1. `AutonomyService` — centralized risk evaluator (see Feature 1)
2. `autonomy_decisions` table for audit trail
3. Autonomy configuration: env var `AUTONOMY_DEFAULT_LEVEL` (green/yellow/red) and per-action overrides in config
4. Dashboard panel showing autonomy tier indicators on recent actions (uses `autonomy_decisions` table)
5. One new orchestrator tool: `set_autonomy_level` — allows user to grant/revoke elevated autonomy for a session

**Integration:** `AutonomyService` is called from `tool-executor.ts` (shared tool execution layer) so it gates all tools, not just `run_shell`. The existing `executeTool()` switch can delegate to `AutonomyService.evaluate(toolName, input)` before executing.

### Feature 4: Daily Standup and Work Journal

**Current state:** `workSessions` table exists (trigger, context, actionsTaken, summary). `briefing.ts` service generates daily briefings. `reflections` table exists.

**What's needed:**
1. `WorkJournalService` — aggregates data from `workSessions`, `toolExecutions`, `goals` (completed today), `tasks` (completed today), `reflections`, `llmUsage` into a structured daily entry
2. `journal_entries` table — persists the generated narrative (prevents re-generation, browsable)
3. `GET /api/journal/today` and `GET /api/journal/:date` routes
4. `POST /api/journal/standup` — triggers standup generation (or use briefing queue)
5. Extend existing `BriefingJob` to also write to `journal_entries` (or add `JournalJob` to briefing queue)
6. Dashboard route `/journal` — timeline view of journal entries with links to goals/tasks

**Integration:** The existing `briefings` BullMQ queue and morning briefing scheduler already exist. Extend the briefing processor to also write to `journal_entries` instead of creating a new queue. Standup is a sub-type of briefing.

### Feature 5: Content Automation Integration

**Current state:** `n8nWorkflows` table, `N8nService`, `TRIGGER_N8N_WORKFLOW_TOOL`, `LIST_N8N_WORKFLOWS_TOOL` all exist. n8n is deployed at `n8n.aviontechs.com`.

**What's needed:**
1. `content_automation_runs` table — persists execution outcomes linked to goals (unlike raw n8n calls which are fire-and-forget)
2. `ContentAutomationService` extends `N8nService` — adds `runManagedWorkflow()` which persists runs and polls n8n for outcomes
3. `run_content_automation` orchestrator tool — replaces raw `trigger_workflow` for content pipelines
4. Dashboard cards for content automation run history (add to HUD or new tab)
5. n8n workflows: YouTube pipeline + other content flows need to be registered in `n8nWorkflows` table with proper `inputSchema` defined

**What does NOT change:** Existing `trigger_workflow` tool remains for ad-hoc n8n calls. `run_content_automation` is for managed/tracked automations.

### Feature 6: Multi-Project Awareness

**Current state:** `WorkspaceService` scoped to `WORKSPACE_DIR`. Monitoring service checks GitHub repos from `GITHUB_MONITORED_REPOS` env var (comma-separated).

**What's needed:**
1. `project_registry` table — seeded from config + auto-discovered from workspace
2. `ProjectRegistryService` — reads registry, fetches live status (git branch, last commit, CI status from existing MonitoringService)
3. `list_projects` and `get_project_context` orchestrator tools
4. Context injection: when orchestrator is invoked, `ProjectRegistryService.getActiveContext()` prepends relevant project summaries to system prompt
5. `POST /api/projects/register` and `GET /api/projects` routes for managing the registry
6. Auto-populate registry from `WORKSPACE_DIR` on startup (scan for git repos)

**Integration:** `ProjectRegistryService` calls existing `MonitoringService.checkGitHubCI()` and `checkGitHubPRs()` for per-project status. No changes to MonitoringService itself.

### Feature 7: Smart Financial Tracking

**Current state:** `llmUsage` table fully populated (provider, model, tokens, cost in microdollars, goal/task/conversation FKs). `GET /api/usage` route exists. Cost guardrail via `DAILY_TOKEN_LIMIT` env var.

**What's needed:**
1. `cost_events` table — for non-LLM costs (VPS monthly, n8n API calls, ElevenLabs TTS, etc.)
2. `CostTrackingService` — aggregates `llmUsage` + `cost_events`, computes daily/weekly/monthly burn rates, fires alerts when thresholds crossed
3. Cost alert thresholds: `DAILY_COST_ALERT_USD`, `MONTHLY_COST_ALERT_USD` env vars
4. `GET /api/costs/summary`, `GET /api/costs/breakdown`, `POST /api/costs/event` routes
5. Dashboard `/costs` page: cost by provider, cost by goal, trend chart, budget alerts
6. Budget optimization suggestions: `CostTrackingService.generateSuggestions()` uses existing `generateSuggestions()` pattern from `suggestions.ts`

**Integration:** `CostTrackingService` reads from existing `llmUsage` table (no changes). Alerts fire through existing `NotificationService` → Slack/Discord. `DAILY_TOKEN_LIMIT` guardrail remains as hard stop; cost alerts are soft warnings.

### Feature 8: Dashboard Command Center

**Current state:** Dashboard has: chat, goals, pipelines, HUD, memories, milestones, workspace, approvals, usage, persona, settings, activity pages.

**What's needed (new pages/sections):**
1. `/journal` — Work journal timeline (reads from `journal_entries`, links to goals)
2. `/costs` — Cost dashboard (reads from `CostTrackingService` aggregation routes)
3. `/projects` — Multi-project registry view with live status (reads from `project_registry` + monitoring)
4. HUD additions — autonomy level indicator, journal "today's summary" card, active content automation card
5. Approvals enhancement — show `autonomy_decisions` context alongside pending approvals

**What does NOT change:** Existing pages (chat, goals, pipelines, HUD, memories, etc.) are not modified. New pages added to React Router config.

---

## Data Flow Changes

### Orchestrator Context Injection (RAG + Projects)

```
User sends message OR goal triggered
    │
    ▼
Orchestrator.run()
    │
    ├── ProjectRegistryService.getActiveContext()  [NEW]
    │       → scans project_registry for recently active projects
    │       → returns 3-5 project summaries
    │
    ├── RAG retrieve(db, embed, query)              [NEW wire]
    │       → embed user message
    │       → pgvector similarity search on documentChunks
    │       → rerank, diversify, format
    │
    ├── buildSystemPrompt(role, ragContext, projectContext)  [MODIFIED]
    │       → injects both contexts into system prompt
    │
    └── LLM call with enriched context
```

### Autonomous Shell Execution Flow

```
Agent decides to run: run_shell { repo: "ai-cofounder", cmd: "npm test" }
    │
    ▼
tool-executor.ts → AutonomyService.evaluate("run_shell", input)
    │
    ├── GREEN (read-only cmd) → execute immediately
    │       → TerminalService.run(repoDir, cmd)
    │       → WorkspaceService.runCommand()
    │       → execFile() with timeout + stdio capture
    │       → record autonomy_decisions (green, run)
    │       → return output
    │
    ├── YELLOW (side-effect cmd) → approval required
    │       → record autonomy_decisions (yellow, queued)
    │       → createApproval() [existing]
    │       → notifyApprovalCreated() [existing → Slack/Discord]
    │       → return "Approval requested: <link>"
    │       → After approval: execute and complete
    │
    └── RED (destructive/escape attempt) → blocked
            → record autonomy_decisions (red, blocked)
            → return error + reason
            → optionally fire alert via NotificationService
```

### Work Journal Generation Flow

```
Daily cron (7am, extends existing BriefingJob)
    │
    ▼
BriefingProcessor in worker process
    │
    ├── WorkJournalService.aggregateDay(date)
    │       → query workSessions for date range
    │       → query toolExecutions summary (tool counts, success rates)
    │       → query goals/tasks completed
    │       → query llmUsage (cost for day)
    │       → query reflections generated
    │
    ├── LLM narrative generation (registry.complete("conversation"))
    │       → structured prompt → natural language standup
    │
    ├── INSERT journal_entries { date, content, rawData }
    │
    └── Deliver via existing briefing channels (Slack/Discord/voice)
```

### RAG Auto-Ingestion Triggers

```
Trigger sources:
    │
    ├── Goal completed → enqueueRagIngestion({ action: "ingest_conversations", sourceId: conversationId })
    │
    ├── git_push tool invoked → enqueueRagIngestion({ action: "ingest_repo", sourceId: repoPath })
    │
    └── Daily cron → ingest_conversations for all active conversations (last 24h)

RAG ingestion worker → packages/rag ingester → upsert documentChunks → update ingestionState
```

---

## Recommended Project Structure Changes

### New/modified files (apps/agent-server/src/)

```
apps/agent-server/src/
├── services/
│   ├── workspace.ts          # MODIFIED: add runCommand() method
│   ├── terminal.ts           # NEW: shell execution + command allowlist/blocklist
│   ├── autonomy.ts           # NEW: risk scoring, action evaluation
│   ├── work-journal.ts       # NEW: journal aggregation + narrative generation
│   ├── cost-tracking.ts      # NEW: multi-source cost aggregation + alerts
│   ├── project-registry.ts   # NEW: project index + context injection
│   ├── content-automation.ts # NEW: extends N8nService with run tracking
│   ├── briefing.ts           # MODIFIED: also writes to journal_entries
│   └── [existing unchanged]
│
├── agents/tools/
│   ├── shell-tools.ts        # NEW: run_shell tool definition
│   ├── journal-tools.ts      # NEW: get_work_journal tool definition
│   ├── project-tools.ts      # NEW: list_projects, get_project_context
│   ├── cost-tools.ts         # NEW: get_costs tool definition
│   └── [existing unchanged]
│
└── routes/
    ├── journal.ts            # NEW: /api/journal endpoints
    ├── autonomy.ts           # NEW: /api/autonomy/decisions, /api/autonomy/config
    ├── costs.ts              # NEW: /api/costs/summary, breakdown, event
    ├── projects.ts           # NEW: /api/projects CRUD + status
    └── [existing unchanged]
```

### New/modified files (packages/db/src/)

```
packages/db/src/
├── schema.ts    # MODIFIED: add journal_entries, project_registry,
│               #   cost_events, autonomy_decisions, content_automation_runs
└── repositories.ts  # MODIFIED: add CRUD for new tables
```

### New/modified files (apps/dashboard/src/)

```
apps/dashboard/src/
├── routes/
│   ├── journal.tsx      # NEW: work journal timeline page
│   ├── costs.tsx        # NEW: cost dashboard page
│   └── projects.tsx     # NEW: multi-project registry page
│
├── api/
│   └── queries.ts       # MODIFIED: add useJournal, useCosts, useProjects hooks
│
└── components/
    └── [new components as needed for journal/costs/projects]
```

---

## Architectural Patterns

### Pattern 1: Autonomy Gate in Tool Executor

Every orchestrator tool call passes through `tool-executor.ts` before executing. The autonomy gate belongs here — not in individual tool handlers — to ensure coverage.

**When to use:** All tools that have side effects (write files, run commands, send notifications, make API calls).

```typescript
// In tool-executor.ts executeSharedTool()
export async function executeTool(name: string, input: unknown, ctx: ToolExecutorContext) {
  // Evaluate autonomy before executing any write-side-effect tool
  if (ctx.autonomyService && AUTONOMY_GATED_TOOLS.includes(name)) {
    const decision = await ctx.autonomyService.evaluate(name, input);
    await recordAutonomyDecision(ctx.db, { toolName: name, ...decision });

    if (decision.level === "red") {
      return { error: `Action blocked: ${decision.reason}` };
    }
    if (decision.level === "yellow") {
      await createApproval(ctx.db, { ... });
      return { pending: true, approvalId: decision.approvalId };
    }
  }
  // GREEN or non-gated: proceed with execution
  return executeToolImpl(name, input, ctx);
}
```

### Pattern 2: Context Enrichment Pipeline

RAG retrieval and project context are computed once per orchestrator invocation, not per tool call. Inject into system prompt construction.

**When to use:** Any time the agent needs background knowledge about the codebase, past decisions, or project state without explicit tool calls.

**Trade-offs:** Adds 200-500ms per invocation for embedding + pgvector query. Mitigate with query caching (Redis, 60s TTL) for identical queries.

```typescript
// In orchestrator.ts run()
async run(userMessage: string, options: OrchestratorOptions) {
  // Enrich context before first LLM call
  const [ragContext, projectContext] = await Promise.all([
    this.ragService?.retrieveContext(userMessage) ?? "",
    this.projectRegistry?.getActiveContext() ?? "",
  ]);

  const systemPrompt = buildSystemPrompt(this.role, { ragContext, projectContext });
  // ... rest of agentic loop
}
```

### Pattern 3: Work Journal as Aggregation View

The work journal is a *read aggregation* over existing tables, not a separate write path. The only new write is the generated narrative stored in `journal_entries`. All source data already exists.

**When to use:** Any dashboard "summary" feature — don't create parallel write paths, aggregate existing data.

**Trade-offs:** Aggregation query can be slow if not indexed properly. Mitigate by pre-generating daily entries via cron and caching in `journal_entries` table.

### Pattern 4: Extend Existing Queues, Don't Add New Ones

The `briefings` queue already handles daily scheduled work. Journal generation extends the `BriefingJob` payload (add `writeJournal: true`) rather than creating a new queue. Similarly, the autonomy approval notification extends `NotificationJob`.

**When to use:** Any new scheduled or async work that fits an existing queue's semantics.

**Trade-offs:** Queue job payloads grow slightly; easier to maintain one worker than many.

### Pattern 5: Project Registry as Lightweight Index

`project_registry` is an index, not a data store. It holds pointers and cached status. The actual data lives in git repos, GitHub API, and VPS SSH. The registry is stale-tolerant — updated on-demand and by monitoring cron.

**When to use:** Any "awareness" feature that needs to know what exists without duplicating the source of truth.

---

## Component Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Orchestrator tools ↔ AutonomyService | Direct method call in tool-executor | Service injected via constructor pattern (same as WorkspaceService today) |
| Orchestrator ↔ RAG retriever | Direct import from `packages/rag` | Already imported in orchestrator.ts (retrieve, formatContext) — just needs to be called |
| WorkJournalService ↔ BriefingJob | BriefingProcessor calls service | Journal is output of briefing, not separate system |
| CostTrackingService ↔ NotificationService | Direct method call | Alerts via existing notification channels |
| ProjectRegistryService ↔ MonitoringService | Direct method call | Registry queries monitoring for live CI/health status |
| Dashboard ↔ new routes | api-client typed methods | Add new methods to api-client package for type safety |

---

## Build Order (Dependency Graph)

Dependencies drive this order — each phase enables the next.

### Phase 1: RAG Wiring (enables all memory-aware features)
- Wire `packages/rag` retrieval into orchestrator system prompt (1-2 days)
- Implement RAG ingestion worker processor (`workers.ts` `ragIngestion` handler)
- Add auto-ingestion triggers (post-conversation, post-git-push, daily cron)
- Test: send message referencing past conversation → verify RAG context appears in prompt

**Rationale:** RAG is already built — this is just plumbing. Unblocks journal (uses memory recall), project context (indexes READMEs), and cost awareness (ingests reports).

### Phase 2: Terminal Access + Autonomy Gate (enables autonomous execution)
- Add `WorkspaceService.runCommand()` method
- Build `TerminalService` with command allowlist/blocklist
- Build `AutonomyService` with green/yellow/red tier evaluation
- Add `autonomy_decisions` table
- Add `run_shell` orchestrator tool
- Wire autonomy gate into `tool-executor.ts`
- Test: attempt green command (runs), yellow command (approval created), red command (blocked)

**Rationale:** Foundational for "autonomous" in autonomous cofounder. All autonomous execution gates through here.

### Phase 3: Work Journal (enables daily standup + activity browsability)
- Add `journal_entries` table
- Build `WorkJournalService`
- Extend `BriefingProcessor` to also write to `journal_entries`
- Add `GET /api/journal/today`, `GET /api/journal/:date` routes
- Add `get_work_journal` orchestrator tool
- Add `/journal` dashboard page

**Rationale:** Depends on Phase 1 (RAG ingest of conversations for richer narrative). Can run in parallel with Phase 4+.

### Phase 4: Multi-Project Awareness (enables cross-project agent work)
- Add `project_registry` table, seed from workspace scan
- Build `ProjectRegistryService`
- Add `list_projects`, `get_project_context` tools
- Add project context injection to orchestrator system prompt
- Add `/api/projects` routes + `/projects` dashboard page

**Rationale:** Depends on Phase 1 (RAG indexes project READMEs/code). Independent of Phase 2-3.

### Phase 5: Financial Tracking (enables budget awareness)
- Add `cost_events` table
- Build `CostTrackingService` aggregating `llmUsage` + `cost_events`
- Add `get_costs` orchestrator tool
- Add `/api/costs` routes + `/costs` dashboard page
- Wire budget alerts through `NotificationService`

**Rationale:** Fully independent. Can run in parallel with Phases 3-4. `llmUsage` data already exists.

### Phase 6: Content Automation Management (enables tracked content pipelines)
- Add `content_automation_runs` table
- Build `ContentAutomationService`
- Add `run_content_automation` orchestrator tool
- Register YouTube + other content workflows in `n8nWorkflows` table
- Add content automation section to HUD

**Rationale:** Depends on nothing new. Extends existing n8n integration. Can run last.

### Phase 7: Dashboard Command Center (unifies all above)
- Integrate new routes into React Router
- Implement `/journal`, `/costs`, `/projects` pages
- Enhance HUD with autonomy indicator, journal card, content automation card
- Add autonomy context to approvals page

**Rationale:** Depends on all API routes being available (Phases 1-6). Dashboard is the final integration layer.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| n8n (content automation) | HTTP webhook calls via existing `N8nService` | `content_automation_runs` adds persistence layer on top |
| GitHub (project status) | Existing `MonitoringService.checkGitHubCI/PRs()` | ProjectRegistryService reuses these methods |
| VPS SSH (project health) | Existing `MonitoringService.checkVpsHealth()` | No changes needed |
| ElevenLabs TTS | Existing `TTSService` | Work journal standup could be TTS-delivered via voice UI |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `agent-server` ↔ `packages/rag` | Direct import (`retrieve`, `formatContext`) | No HTTP hop needed — same process |
| `agent-server` ↔ `packages/queue` | Direct import (`enqueueRagIngestion`, etc.) | Already established pattern |
| `AutonomyService` ↔ `approvals` table | Via `createApproval()` from `packages/db` | Reuses existing approval infrastructure |
| `WorkJournalService` ↔ `BriefingProcessor` | Service injected into BriefingProcessor | Journal writes are a side effect of briefing generation |
| Dashboard ↔ new routes | Via `api-client` typed fetch methods | Add new method group to `packages/api-client` |

---

## Scaling Considerations

This is a single-user system on a single VPS. Scaling concerns are operational (not user-count), focused on cost and reliability.

| Concern | Current Approach | v2.0 Consideration |
|---------|-----------------|-------------------|
| RAG vector search latency | pgvector cosine search with HNSW index | At ~10K chunks (1 year of conversations), HNSW handles this easily. Re-evaluate at 100K chunks. |
| Shell command execution | Single sequential (execFile, no PTY needed) | Concurrency limit: 1 shell cmd at a time per workspace repo (file system contention). |
| Autonomous task queue depth | BullMQ concurrency: 1 for agent-tasks | Correct — LLM calls are expensive and sequential is safer. Do not increase. |
| Daily journal generation | Scheduled BullMQ job, pre-generated | Pre-generation is correct. Do not generate on-demand per page load. |
| Cost aggregation queries | `llmUsage` table grows ~100 rows/day | Add `created_at` index if not present. Monthly rollup after 6 months. |

---

## Anti-Patterns

### Anti-Pattern 1: PTY for Agent Shell Access

**What people do:** Use `node-pty` to spawn a full pseudo-terminal for interactive shell sessions.
**Why it's wrong:** Agents don't need interactive TTY. `node-pty` adds binary native module complexity, streaming complexity, and shell injection surface. The existing `execFile()` pattern (used in `WorkspaceService` for git and `run_tests`) is sufficient.
**Do this instead:** `execFile()` with `cwd`, `timeout`, `maxBuffer`, captured `stdout`/`stderr`. Add to `WorkspaceService.runCommand()` using the same pattern as existing `git()` method.

### Anti-Pattern 2: Separate Queue for Every New Feature

**What people do:** Add `journal-queue`, `autonomy-queue`, `cost-queue` as new BullMQ queues.
**Why it's wrong:** More queues = more workers = more Redis connections = more complexity in `startWorkers()`. Journal entries are a sub-type of briefings. Autonomy decisions are synchronous (not async jobs). Cost aggregation runs as a scheduled cron.
**Do this instead:** Extend existing `BriefingJob` for journal. Autonomy evaluation is synchronous in `tool-executor.ts`. Add a new job type to `briefings` queue for cost alert checks.

### Anti-Pattern 3: Duplicating Project Context in DB

**What people do:** Ingest full project file trees into DB for "project awareness."
**Why it's wrong:** File trees change constantly. Keeping them in sync is a maintenance problem. Storage bloat. The RAG ingestion pipeline already handles chunking and embedding code — that's the right abstraction.
**Do this instead:** `project_registry` stores lightweight index (path, name, type, last seen). Deep context comes from RAG retrieval of the project's `documentChunks` (already ingested via `ingest_repo`). `get_project_context` tool triggers a fresh RAG query scoped to that project's `sourceId`.

### Anti-Pattern 4: Blocking Orchestrator on Journal Generation

**What people do:** Generate journal narrative inline when orchestrator starts up or when user asks for standup.
**Why it's wrong:** LLM call for narrative generation blocks the current request for 5-10 seconds.
**Do this instead:** Pre-generate via scheduled BullMQ job. `GET /api/journal/today` reads from `journal_entries` cache. If no entry for today, trigger async generation and return "generating, check back in 30s." The `get_work_journal` tool uses the cached entry.

### Anti-Pattern 5: Hardcoding Autonomy Rules

**What people do:** Hardcode a fixed list of "safe" vs "unsafe" commands.
**Why it's wrong:** Lists go stale. A command that was safe yesterday may be dangerous with a new argument. Misses context (git push to `main` is red, git push to a feature branch is yellow).
**Do this instead:** Rule-based evaluation with context: command + args + target repo + session autonomy level. `AutonomyService` evaluates the full `(toolName, input)` tuple. Keep a configurable `autonomy.config.ts` with rule sets that can be updated without code changes.

---

## Sources

- Codebase inspection: `packages/rag/`, `packages/queue/`, `packages/db/src/schema.ts`, `apps/agent-server/src/services/`, `apps/agent-server/src/agents/`
- Architecture pattern: Human-in-the-Loop agent design — [StackAI HITL Guide](https://www.stackai.com/insights/human-in-the-loop-ai-agents-how-to-design-approval-workflows-for-safe-and-scalable-automation)
- Tiered autonomy pattern: [From HITL to HOTL](https://bytebridge.medium.com/from-human-in-the-loop-to-human-on-the-loop-evolving-ai-agent-autonomy-c0ae62c3bf91)
- Shell sandboxing: [INNOQ: I sandboxed my coding agents](https://www.innoq.com/en/blog/2025/12/dev-sandbox/) (PTY vs execFile tradeoffs)
- RAG architecture: [RAG Architectures 2025](https://medium.com/data-science-collective/rag-architectures-a-complete-guide-for-2025-daf98a2ede8c)
- LLM cost tracking: [TrueFoundry LLM Cost Tracking](https://www.truefoundry.com/blog/llm-cost-tracking-solution)
- Agentic AI patterns: [Google Cloud Agentic AI Design Patterns](https://docs.cloud.google.com/architecture/choose-design-pattern-agentic-ai-system)

---
*Architecture research for: AI Cofounder v2.0 Autonomous Cofounder*
*Researched: 2026-03-09*
