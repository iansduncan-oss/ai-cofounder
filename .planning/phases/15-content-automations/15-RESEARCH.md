# Phase 15: Content Automations - Research

**Researched:** 2026-03-15
**Domain:** n8n REST API, managed pipeline templates, work journal integration, content scheduling
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONT-01 | YouTube Shorts pipeline registered as a managed pipeline template (triggerable from dashboard or schedule) | PipelineExecutor + DB pipeline template pattern + dashboard trigger button |
| CONT-02 | n8n workflow status and recent execution history visible in dashboard | n8n REST API `/api/v1/executions` + new N8nService methods + dashboard page |
| CONT-03 | Agent can trigger n8n workflows as part of autonomous task execution (via existing trigger_workflow tool) | trigger_workflow tool already wired — needs YouTube Shorts workflow registered in n8nWorkflows table |
| CONT-04 | Content pipeline outputs (scripts, assets, publish status) tracked in work journal | New `content_pipeline` journal entry type + JournalService.writeEntry() calls from PipelineExecutor |
</phase_requirements>

---

## Summary

Phase 15 bridges two existing infrastructure pieces that are not yet connected: the n8n workflow registry (webhooks, but no execution history visibility) and the work journal (entries exist for goals/tasks/deployments, but not content pipeline events). The four requirements split cleanly into: registering a YouTube pipeline template (CONT-01), surfacing n8n execution history through the dashboard (CONT-02), verifying the existing agent trigger path works end-to-end for content workflows (CONT-03), and extending the journal schema and journal service to record content pipeline outcomes (CONT-04).

The most significant new work is adding an n8n execution history API bridge: the project's n8n instance exposes `GET /api/v1/executions` authenticated via `X-N8N-API-KEY` header (requires generating an API key in the n8n UI). The agent-server must add a new `N8nExecutionService` (or extend `N8nService`) that calls this endpoint, and a new REST route proxies execution data to the dashboard. No new queues or tables are required for CONT-02 — execution state lives in n8n itself.

CONT-01 requires a "pipeline template" concept: a named, pre-configured set of PipelineStage definitions stored in the DB (or seeded via migration) and triggerable as a one-click action from the dashboard. The YouTube Shorts template maps to the existing `PipelineExecutor` and `enqueuePipeline()` machinery. CONT-04 requires one new `journalEntryTypeEnum` value (`content_pipeline`) in the DB schema plus a call to `JournalService.writeEntry()` at the end of any pipeline execution.

**Primary recommendation:** Add N8nExecutionService (fetches n8n REST API execution history), add a pipeline template DB table with a YouTube Shorts seed, add `content_pipeline` journal entry type, extend the dashboard with an N8n Workflows page and a one-click pipeline trigger.

---

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| BullMQ | ~5.x | Pipeline job queue | `getPipelineQueue()`, `enqueuePipeline()` already exist |
| Drizzle ORM | ~0.x | DB schema + migrations | `journalEntryTypeEnum`, `n8nWorkflows`, `journalEntries` tables already exist |
| Fastify | ~4.x | Agent-server routes | New routes follow established plugin pattern |
| React + TanStack Query | latest | Dashboard data fetching | Existing query key pattern in `@/lib/query-keys` |

### New dependencies needed
None. All work uses existing installed packages.

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-fetch` / native `fetch` | Node 24+ built-in | n8n REST API calls | Already used in N8nService for webhook triggering |

### Installation
No new packages needed.

---

## Architecture Patterns

### What Already Exists

**n8n Integration (outbound direction):**
- `apps/agent-server/src/services/n8n.ts` — `N8nService.trigger()` sends POST to registered webhook URLs
- `apps/agent-server/src/agents/tools/n8n-tools.ts` — `trigger_workflow` and `list_workflows` LLM tools
- `apps/agent-server/src/routes/n8n.ts` — `GET/POST/PATCH/DELETE /api/n8n/workflows`
- `packages/db/src/schema.ts` — `n8nWorkflows` table (name, webhookUrl, direction, inputSchema, isActive)
- `packages/db/src/repositories.ts` — `listN8nWorkflows`, `getN8nWorkflowByName`, `createN8nWorkflow`, etc.

**Pipeline Execution:**
- `apps/agent-server/src/services/pipeline.ts` — `PipelineExecutor.execute()` runs stages via specialist agents
- `packages/queue/src/queues.ts` — `PipelineJob`, `getPipelineQueue()`, `enqueuePipeline()`
- `apps/agent-server/src/routes/pipeline.ts` — `GET/POST /api/pipelines`
- `apps/dashboard/src/routes/pipelines.tsx` — existing pipelines page with "Run Pipeline" dialog

**Work Journal:**
- `packages/db/src/schema.ts` — `journalEntries` table, `journalEntryTypeEnum` (11 values)
- `packages/db/src/repositories.ts` — `createJournalEntry()`, `listJournalEntries()`
- `apps/agent-server/src/services/journal.ts` — `JournalService.writeEntry()`
- `apps/dashboard/src/routes/journal.tsx` — timeline view with type filter, standup display

**Dashboard:**
- `apps/dashboard/src/routes/pipelines.tsx` — existing pipeline run list + submit dialog
- No existing n8n-specific dashboard page

### What is Missing

1. **n8n execution history API** — `N8nService` only sends webhooks, does not query n8n's REST API for execution history
2. **n8n API key** — `docker-compose.yml` uses basic auth but n8n REST API requires an API key (generated from n8n UI settings)
3. **YouTube pipeline template** — No registered pipeline templates; the existing `POST /api/pipelines` takes arbitrary stages
4. **Pipeline template DB table** — No `pipelineTemplates` table; templates would need to be stored somewhere
5. **`content_pipeline` journal type** — The `journalEntryTypeEnum` does not include `content_pipeline`; PipelineExecutor does not write journal entries
6. **Dashboard n8n page** — No `/dashboard/n8n` route or component
7. **ApiClient n8n methods** — `packages/api-client/src/client.ts` has no methods for n8n workflow endpoints (they exist on the server but are not exposed to dashboard)

### Recommended Project Structure Changes

```
apps/agent-server/src/
├── services/
│   └── n8n.ts                      # EXTEND: add getExecutions(), getWorkflowsFromN8n()
├── routes/
│   └── n8n.ts                      # EXTEND: add GET /api/n8n/executions
└── plugins/
    └── n8n-execution-poller.ts     # OPTIONAL: periodic sync to cache in DB

packages/db/src/
├── schema.ts                       # EXTEND: add content_pipeline to journalEntryTypeEnum
│                                   # EXTEND: add pipelineTemplates table
└── repositories.ts                 # EXTEND: CRUD for pipelineTemplates

apps/dashboard/src/
└── routes/
    ├── n8n-workflows.tsx            # NEW: n8n workflow list + execution history
    └── pipelines.tsx                # EXTEND: add "Run Template" shortcut for YouTube pipeline
```

### Pattern 1: N8n Execution History Service Extension

The existing `N8nService` only does outbound webhook triggers. Extend it to also query the n8n REST API for execution history.

**Authentication:** n8n REST API requires `X-N8N-API-KEY` header. The API key is generated from n8n UI Settings > API. Store as `N8N_API_KEY` env var. The base URL is `N8N_BASE_URL` (e.g., `http://localhost:5678`).

```typescript
// Source: n8n community docs, verified via WebSearch
export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "success" | "error" | "waiting" | "canceled";
  finished: boolean;
  mode: "manual" | "trigger" | "webhook" | "retry";
  startedAt: string;     // ISO timestamp
  stoppedAt: string;     // ISO timestamp
  retryOf: string | null;
  retrySuccessId: string | null;
}

// Extend N8nService interface
export interface N8nService {
  trigger(webhookUrl, workflowName, payload): Promise<N8nTriggerResult>;
  listExecutions(opts?: { workflowId?: string; status?: string; limit?: number }): Promise<N8nExecution[]>;
  listWorkflowsFromApi(): Promise<N8nWorkflowSummary[]>;
}

// Implementation
async listExecutions(opts = {}) {
  const baseUrl = optionalEnv("N8N_BASE_URL", "http://localhost:5678");
  const apiKey = optionalEnv("N8N_API_KEY", "");
  if (!apiKey) return [];

  const qs = new URLSearchParams();
  if (opts.workflowId) qs.set("workflowId", opts.workflowId);
  if (opts.status) qs.set("status", opts.status);
  if (opts.limit) qs.set("limit", String(opts.limit));

  const url = `${baseUrl}/api/v1/executions?${qs}`;
  const resp = await fetch(url, {
    headers: { "X-N8N-API-KEY": apiKey },
  });
  const json = await resp.json() as { data: N8nExecution[] };
  return json.data ?? [];
}
```

### Pattern 2: Pipeline Templates Table

Rather than hard-coding templates, add a DB-backed `pipelineTemplates` table. The YouTube Shorts template is seeded at startup.

```typescript
// packages/db/src/schema.ts — NEW TABLE
export const pipelineTemplates = pgTable("pipeline_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),   // "youtube-shorts"
  description: text("description"),
  stages: jsonb("stages").notNull().$type<PipelineStage[]>(),
  defaultContext: jsonb("default_context"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Seed the YouTube Shorts pipeline template via a new DB migration (or startup seed). The pipeline stages call the `researcher` agent for script generation, then `trigger_workflow` for publishing via n8n.

### Pattern 3: Content Pipeline Journal Entry Type

The `journalEntryTypeEnum` in `packages/db/src/schema.ts` must be extended. This requires a DB migration since Postgres enums require `ALTER TYPE`.

```sql
-- Migration: 0023_add_content_pipeline_journal_type.sql
ALTER TYPE journal_entry_type ADD VALUE 'content_pipeline';
```

The `PipelineExecutor` completes a run and emits a notification (it already calls `notificationService.sendBriefing()`). Extend it to also call `journalService.writeEntry()`:

```typescript
// At end of PipelineExecutor.execute()
if (this.journalService) {
  await this.journalService.writeEntry({
    entryType: "content_pipeline",
    title: `Pipeline ${pipelineId} ${pipelineStatus}`,
    summary: `${completedStages}/${stages.length} stages completed`,
    goalId,
    details: {
      pipelineId,
      stageResults: stageResults.map(r => ({ agent: r.agent, status: r.status })),
      template: context.templateName,
    },
  }).catch(() => {});
}
```

### Pattern 4: Dashboard N8n Workflows Page

Follow the established pattern from `pipelines.tsx`:

```typescript
// apps/dashboard/src/routes/n8n-workflows.tsx
export function N8nWorkflowsPage() {
  const { data: executions } = useQuery({
    queryKey: queryKeys.n8n.executions(),
    queryFn: () => apiClient.listN8nExecutions({ limit: 50 }),
    refetchInterval: 30_000,
  });
  // Render execution list with status badges
}
```

New API client methods needed:
- `apiClient.listN8nWorkflows()` — `GET /api/n8n/workflows`
- `apiClient.listN8nExecutions(opts?)` — `GET /api/n8n/executions?workflowId=...&limit=...`
- `apiClient.triggerTemplate(templateName, goalId?)` — `POST /api/pipeline-templates/:name/trigger`

### Anti-Patterns to Avoid

- **Polling n8n executions in real-time:** n8n does not have WebSocket push — polling every 30s from dashboard is correct
- **Storing full n8n execution data in Postgres:** Store only job metadata in journal entries; leave full execution data in n8n itself
- **Modifying the journalEntryTypeEnum in schema.ts without a migration:** Drizzle enums require `ALTER TYPE` in Postgres — must use a SQL migration, not just `db:push`
- **Treating the trigger_workflow tool as broken:** CONT-03 is nearly done — the tool already resolves workflow by name from DB, fetches webhookUrl, and POSTs. The only gap is the YouTube Shorts workflow must be registered in the `n8nWorkflows` table

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| n8n execution polling | Custom DB table + periodic sync | Direct `/api/v1/executions` API calls from route handler | Unnecessary complexity; n8n already stores execution state |
| Pipeline template storage | Hardcoded in-memory config | `pipelineTemplates` DB table | Dashboard needs to read/display templates; DB is the right source of truth |
| Journal type enum changes | `db:push` only | Drizzle migration with `ALTER TYPE` SQL | Postgres enums cannot be altered with db:push safely in production |
| YouTube pipeline orchestration | New custom service | Existing `PipelineExecutor` + `enqueuePipeline()` | These handle stages, concurrency, failure propagation, and queue persistence already |

---

## Common Pitfalls

### Pitfall 1: n8n API Authentication Mode Mismatch

**What goes wrong:** The n8n instances (dev + prod) are configured with basic auth, but the REST API (`/api/v1/*`) requires an API key created from within n8n (Settings > n8n API). Basic auth credentials are for the UI only and do not work on the REST API.

**Why it happens:** The n8n REST API was introduced separately from basic auth. The two authentication systems are independent.

**How to avoid:** Add `N8N_API_KEY` env var. Add `N8N_BASE_URL` env var (default `http://localhost:5678`). Guard `listExecutions()` with an early return if `N8N_API_KEY` is empty.

**Warning signs:** `GET /api/v1/executions` returns 401 even with basic auth credentials.

### Pitfall 2: Postgres Enum Immutability with db:push

**What goes wrong:** Running `db:push` after adding `content_pipeline` to `journalEntryTypeEnum` in schema.ts fails silently or errors in production because Postgres cannot re-create an existing enum value via the typical push flow.

**Why it happens:** Drizzle `db:push` does not generate incremental enum migrations. Adding values to an existing enum requires `ALTER TYPE ... ADD VALUE`.

**How to avoid:** Use `db:generate` → `db:migrate` workflow. The migration SQL must include `ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'content_pipeline';`. Similarly for any new enum values in `pipelineTemplates` if needed.

**Warning signs:** `db:push` succeeds locally but production deploy fails with "invalid input value for enum".

### Pitfall 3: PipelineExecutor Has No JournalService Reference

**What goes wrong:** `PipelineExecutor` has a `notificationService` parameter but no `journalService`. Adding journal writes requires threading `journalService` through `PipelineExecutor` constructor.

**Why it happens:** Journal service was added in Phase 12 after PipelineExecutor was already built.

**How to avoid:** Add optional `journalService?: JournalService` parameter to `PipelineExecutor` constructor. The queue plugin (`apps/agent-server/src/plugins/queue.ts`) constructs `PipelineExecutor` — it must also receive `journalService` from `app.journalService`.

**Warning signs:** Pipeline completes but no journal entries appear for content pipelines.

### Pitfall 4: YouTube Shorts Template Stage Design

**What goes wrong:** The YouTube Shorts pipeline needs to both generate content (researcher/coder agents) AND trigger n8n for distribution. But `PipelineStage.agent` only accepts specialist agent roles (`planner|coder|reviewer|debugger|researcher`). Triggering n8n is not a specialist agent.

**Why it happens:** `PipelineStage` was designed for agent-to-agent workflows, not for hybrid agent+webhook flows.

**How to avoid:** The YouTube Shorts "template" should be modeled as two connected actions:
1. A `PipelineJob` with researcher stages (script generation)
2. After pipeline completion, a call to `n8nService.trigger()` to hand off to n8n for YouTube publishing

Alternatively, the template could be a single n8n workflow that is triggered by the agent with a content brief as payload. Keep it simple: register the YouTube Shorts n8n workflow in `n8nWorkflows` table, then the "trigger" button on dashboard calls `trigger_workflow` with a brief.

The recommended approach for CONT-01: model "YouTube Shorts pipeline" as a `pipelineTemplate` whose final stage is a `researcher` agent that generates a content brief, followed by auto-triggering the registered n8n workflow. This avoids a new stage type.

### Pitfall 5: n8n Execution History May Be Purged

**What goes wrong:** n8n's default behavior prunes old execution data. If the n8n instance is configured to prune after N executions or N days, `GET /api/v1/executions` will return an empty list for old runs.

**Why it happens:** n8n has built-in execution pruning controlled by `EXECUTIONS_DATA_MAX_AGE` and `EXECUTIONS_DATA_SAVE_ON_SUCCESS`.

**How to avoid:** For dashboard display purposes, showing last 50 executions is sufficient. Don't build features that depend on full historical n8n data. If long-term history matters, mirror execution metadata to journal entries on trigger (CONT-04 pattern).

---

## Code Examples

### Example 1: n8n Execution History API Call

```typescript
// Source: n8n community docs + WebSearch verification
// apps/agent-server/src/services/n8n.ts — extension

async listExecutions(opts: {
  workflowId?: string;
  status?: "success" | "error" | "waiting" | "canceled";
  limit?: number;
} = {}): Promise<N8nExecution[]> {
  const baseUrl = optionalEnv("N8N_BASE_URL", "http://localhost:5678");
  const apiKey = optionalEnv("N8N_API_KEY", "");

  if (!apiKey) {
    logger.warn("N8N_API_KEY not set — execution history unavailable");
    return [];
  }

  const qs = new URLSearchParams();
  if (opts.workflowId) qs.set("workflowId", opts.workflowId);
  if (opts.status) qs.set("status", opts.status);
  qs.set("limit", String(opts.limit ?? 50));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(`${baseUrl}/api/v1/executions?${qs}`, {
      headers: { "X-N8N-API-KEY": apiKey },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      logger.error({ status: resp.status }, "n8n execution history fetch failed");
      return [];
    }

    const json = (await resp.json()) as { data: N8nExecution[] };
    return json.data ?? [];
  } catch (err) {
    logger.error({ err }, "n8n execution history fetch error");
    return [];
  }
}
```

### Example 2: Pipeline Template Trigger Route

```typescript
// apps/agent-server/src/routes/pipeline-templates.ts

// POST /api/pipeline-templates/:name/trigger
app.post<{ Params: { name: string }; Body: { goalId?: string; context?: Record<string, unknown> } }>(
  "/:name/trigger",
  { schema: { tags: ["pipeline-templates"] } },
  async (request, reply) => {
    const template = await getPipelineTemplate(app.db, request.params.name);
    if (!template || !template.isActive) {
      return reply.status(404).send({ error: "Template not found" });
    }

    const jobId = await enqueuePipeline({
      goalId: request.body.goalId ?? `template-${template.name}-${Date.now()}`,
      stages: template.stages as PipelineStage[],
      context: { ...template.defaultContext, ...request.body.context, templateName: template.name },
    });

    return reply.status(202).send({ jobId, template: template.name });
  },
);
```

### Example 3: DB Migration for content_pipeline enum

```sql
-- packages/db/migrations/0023_add_content_pipeline_journal_type.sql
ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'content_pipeline';
```

### Example 4: Pipeline Templates DB Table

```typescript
// packages/db/src/schema.ts — addition
import type { PipelineStage } from "@ai-cofounder/queue";

export const pipelineTemplates = pgTable("pipeline_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  stages: jsonb("stages").notNull().$type<PipelineStage[]>(),
  defaultContext: jsonb("default_context"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Example 5: YouTube Shorts Pipeline Seed

```typescript
// packages/db/src/seed.ts or a migration seed
await db.insert(pipelineTemplates).values({
  name: "youtube-shorts",
  description: "Generate a YouTube Shorts script and trigger n8n publishing workflow",
  stages: [
    {
      agent: "researcher",
      prompt: "Research trending topics and generate a YouTube Shorts script (60 seconds max). Output: title, hook, script, hashtags.",
      dependsOnPrevious: false,
    },
    {
      agent: "reviewer",
      prompt: "Review the YouTube Shorts script for quality, hook strength, and SEO. Suggest improvements.",
      dependsOnPrevious: true,
    },
  ],
  defaultContext: {
    templateName: "youtube-shorts",
    n8nWorkflow: "youtube-shorts-publish",  // triggers n8n after pipeline
  },
  isActive: true,
}).onConflictDoNothing();
```

### Example 6: Dashboard N8n Route Registration

```typescript
// apps/dashboard/src/app.tsx — add route entry
{ path: "n8n", element: <N8nWorkflowsPage /> }

// apps/dashboard/src/routes/n8n-workflows.tsx
export function N8nWorkflowsPage() {
  usePageTitle("N8n Workflows");
  const { data: workflows } = useQuery({
    queryKey: queryKeys.n8n.workflows(),
    queryFn: () => apiClient.listN8nWorkflows(),
  });
  const { data: executions } = useQuery({
    queryKey: queryKeys.n8n.executions(),
    queryFn: () => apiClient.listN8nExecutions({ limit: 50 }),
    refetchInterval: 30_000,
  });
  // Render workflow cards with recent execution history per workflow
}
```

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Basic auth only for n8n | REST API with `X-N8N-API-KEY` header | n8n v1.x added public REST API |
| Manual workflow triggering | `trigger_workflow` LLM tool | Already in project — needs content workflow registered |
| No pipeline templates | `pipelineTemplates` table with seeded YouTube Shorts | New for this phase |
| Journal ignores pipelines | `content_pipeline` entry type | New for this phase |

**What this version of n8n supports (1.76.1 dev / `latest` prod):**
- `GET /api/v1/executions?workflowId=&status=&limit=` — list executions
- `GET /api/v1/workflows` — list workflows known to n8n
- `POST /api/v1/workflows/{id}/run` — trigger without custom payload (use webhooks for payload delivery)
- Status values: `success`, `error`, `waiting`, `canceled` (NOT `running` — known n8n limitation)

**Deprecated/outdated:**
- Basic auth on REST API: Does not work — API key is the only supported auth for `/api/v1/*`

---

## Open Questions

1. **Does the production n8n instance have a YouTube Shorts workflow already built?**
   - What we know: `apps/n8n/workflows/` has 3 workflows (GitHub issue, deploy alerts, weekly cost digest) — no YouTube Shorts workflow
   - What's unclear: Whether a YouTube Shorts n8n workflow exists in the production n8n UI
   - Recommendation: Create a YouTube Shorts n8n workflow JSON file in `apps/n8n/workflows/` as part of this phase, even if simplified. The DB registration via `POST /api/n8n/workflows` can be a seed.

2. **Should n8n execution history be cached in the agent-server DB?**
   - What we know: n8n prunes execution data after N days/executions; REST API polling is simple
   - What's unclear: How long the user needs execution history to persist
   - Recommendation: Do NOT cache in DB for this phase. Poll `/api/v1/executions` live from the route handler (with 10s timeout). The dashboard can show last 50. If n8n data is pruned, journal entries (CONT-04) provide the long-term record.

3. **Should the YouTube Shorts pipeline template trigger n8n automatically after completing its stages?**
   - What we know: `PipelineExecutor` does not currently call n8n after completion; `n8nService` is not available in `PipelineExecutor`
   - What's unclear: Whether CONT-01 means "agent pipeline generates content, then n8n publishes" or "n8n workflow IS the pipeline"
   - Recommendation: Keep it pragmatic. CONT-01 says "triggerable from dashboard as a one-click managed pipeline." The simplest implementation: dashboard button calls `POST /api/pipeline-templates/youtube-shorts/trigger`, which enqueues a PipelineJob. The pipeline runs researcher stages. On completion, PipelineExecutor (if it has n8nService) triggers the registered YouTube Shorts n8n webhook. This requires threading `n8nService` into `PipelineExecutor` which is low-risk.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (root vitest.config.ts) |
| Config file | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="n8n\|pipeline\|journal\|content"` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONT-01 | Pipeline template CRUD + trigger endpoint | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="pipeline-templates"` | Wave 0 |
| CONT-01 | YouTube Shorts template enqueues pipeline job | unit | same | Wave 0 |
| CONT-02 | N8nService.listExecutions() calls API with X-N8N-API-KEY | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="n8n-service"` | Extend existing |
| CONT-02 | GET /api/n8n/executions route proxies n8n data | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="n8n-routes"` | Extend existing |
| CONT-03 | trigger_workflow resolves youtube-shorts-publish from DB | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="n8n-service"` | Extend existing |
| CONT-04 | PipelineExecutor writes content_pipeline journal entry | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="pipeline-executor"` | Wave 0 |
| CONT-04 | content_pipeline appears in journal list response | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="journal"` | Extend existing |

### Sampling Rate
- **Per task commit:** `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="n8n\|pipeline\|journal\|content" --reporter=dot`
- **Per wave merge:** `npm run test -w @ai-cofounder/agent-server && npm run test -w @ai-cofounder/dashboard`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/agent-server/src/__tests__/pipeline-templates.test.ts` — covers CONT-01 (template CRUD, trigger endpoint)
- [ ] `apps/agent-server/src/__tests__/pipeline-executor-journal.test.ts` — covers CONT-04 (journal write on pipeline completion)
- [ ] DB migration: `packages/db/migrations/0023_add_content_pipeline_journal_type.sql`
- [ ] DB migration: `packages/db/migrations/0024_add_pipeline_templates.sql`

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `apps/agent-server/src/services/n8n.ts`, `routes/n8n.ts`, `tools/n8n-tools.ts`, `agents/tool-executor.ts`
- Direct codebase inspection — `packages/db/src/schema.ts` (journalEntryTypeEnum, n8nWorkflows, journalEntries)
- Direct codebase inspection — `packages/queue/src/queues.ts` (PipelineJob, PipelineStage, queue names)
- Direct codebase inspection — `apps/agent-server/src/services/pipeline.ts` (PipelineExecutor)
- Direct codebase inspection — `apps/dashboard/src/routes/journal.tsx`, `pipelines.tsx`

### Secondary (MEDIUM confidence)
- n8n community docs (WebSearch verified): `GET /api/v1/executions` returns `{ data: N8nExecution[] }` with fields `id, workflowId, status, finished, startedAt, stoppedAt`
- n8n community docs: Status filter values are `success | error | waiting | canceled` (not `running`)
- n8n REST API auth: `X-N8N-API-KEY` header required, separate from basic auth credentials

### Tertiary (LOW confidence)
- n8n execution pruning behavior — assumed from general n8n knowledge; verify via `docker-compose.yml` `EXECUTIONS_DATA_*` env vars

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all core libraries already installed and in use
- Architecture patterns: HIGH — derived from direct codebase reading
- n8n REST API: MEDIUM — verified via community docs + WebSearch, not Context7 (n8n not in Context7)
- Pitfalls: HIGH — derived from schema analysis + established project patterns

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (n8n API stable; project dependencies stable)
