# Phase 14: Multi-Project Awareness - Research

**Researched:** 2026-03-15
**Domain:** Multi-workspace management, per-project RAG namespacing, VPS container monitoring, cross-project reasoning
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROJ-01 | Agent can register and switch between multiple workspace repos with per-project configuration | DB schema for `registered_projects` table; extend `WorkspaceService` or introduce `ProjectRegistry`; new orchestrator tools `register_project`, `switch_project`, `list_projects` |
| PROJ-02 | Agent maintains per-project context — architecture, conventions, recent changes, key files | RAG `sourceId` already scopes by repo name; add `projectId` metadata to RAG chunks; ingest `CLAUDE.md` / README on registration |
| PROJ-03 | VPS infrastructure state (running containers, services, resource utilization) queryable by agent | `checkVPSHealth()` already returns container list + disk/mem/cpu; extend SSH script to emit `docker stats --no-stream` per-container; add new orchestrator tool `query_vps` |
| PROJ-04 | Cross-project operations — agent can reason about how changes in one project affect another | DB `project_dependencies` join table; system-prompt injection of active project + topology; add `analyze_cross_project_impact` tool backed by LLM reasoning over dependency map |
</phase_requirements>

---

## Summary

Phase 14 extends the AI Cofounder from a single-workspace tool into a multi-project-aware agent. The existing `WorkspaceService` is hard-coded to a single `WORKSPACE_DIR`, all RAG chunks share one vector space with no project-level scoping, and the monitoring service reports VPS containers as a flat list but does not map them to projects. None of the four PROJ requirements can be satisfied without new DB schema, service layer changes, and new orchestrator tools.

The codebase is well-structured for this extension. The `WorkspaceService` is already injected as an optional service into the `Orchestrator`; the `tool-executor.ts` pattern (buildSharedToolList + executeSharedTool) means new tools follow a clear additive pattern; the RAG pipeline already supports `sourceId` scoping and metadata-based filtering in `searchChunksByVector`; and the `MonitoringService` already SSHes to the VPS and parses `docker ps` output.

The primary architectural decision is how to scope RAG chunks per project. Two options exist: (A) use `sourceId` as `{projectId}/{file}` — this is the minimal-change path, works today, but makes cross-project retrieval awkward; (B) add a `projectId` column to `document_chunks` and a `namespace` filter parameter to `searchChunksByVector` — this is the clean path and enables per-project context isolation for PROJ-02 and PROJ-04.

**Primary recommendation:** Add a `registered_projects` DB table. Extend the RAG schema with a `project_id` metadata field (not a new column — store it in existing `metadata` jsonb). Introduce a `ProjectRegistryService` that wraps per-project `WorkspaceService` instances. Add three orchestrator tools: `register_project`, `switch_project`, `list_projects`. Extend VPS health to include per-container resource stats. The cross-project impact tool should be LLM-powered, reading the project dependency map and active diffs.

---

## Standard Stack

### Core (all already in the project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | existing | DB schema, migrations, queries | Already used for all tables |
| pgvector | existing | Vector search, RAG retrieval | Already in use for embeddings |
| Fastify | existing | REST route handlers | Server framework |
| BullMQ | existing | Async RAG ingestion | Already used for ingest_repo queue |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:child_process execFile | built-in | SSH commands to VPS | Already used in MonitoringService |
| @sinclair/typebox | existing | Route schema validation | Already used in all routes |

No new dependencies are needed. This phase is purely additive within the existing stack.

**Installation:** None required — all dependencies are already present.

---

## Architecture Patterns

### Recommended Project Structure

```
packages/db/src/
  schema.ts                    # Add: registered_projects table
  repositories.ts              # Add: project CRUD functions
  drizzle/0025_add_projects.sql

apps/agent-server/src/
  services/
    project-registry.ts        # NEW: ProjectRegistryService
  agents/tools/
    project-tools.ts           # NEW: register_project, switch_project, list_projects tools
    vps-tools.ts               # NEW: query_vps tool (or extend monitoring-tools)
  routes/
    projects.ts                # NEW: REST CRUD for registered projects
```

### Pattern 1: Per-Project WorkspaceService Registry

**What:** A `ProjectRegistryService` holds a map of `projectId -> WorkspaceService`. The orchestrator can resolve a workspace by project ID and pass it to tool execution.

**When to use:** Whenever a tool needs to operate on a specific named project rather than the default workspace root.

**Key constraint:** The current `WorkspaceService.resolveSafe()` prevents path traversal by requiring all paths to resolve within `rootDir`. Each registered project gets its own `WorkspaceService` instance scoped to its workspace path. This is the correct approach — do NOT modify `resolveSafe()` to support multiple roots; instead use multiple instances.

**Example:**
```typescript
// apps/agent-server/src/services/project-registry.ts
export interface RegisteredProject {
  id: string;
  name: string;
  workspacePath: string;        // absolute path on disk
  repoUrl?: string;
  description?: string;
  config: {
    defaultBranch?: string;
    testCommand?: string;
    language?: string;          // "typescript" | "python" | etc.
  };
  ragSourceId: string;          // the sourceId used in document_chunks
  isActive: boolean;
}

export class ProjectRegistryService {
  private workspaces = new Map<string, WorkspaceService>();

  getWorkspace(projectId: string): WorkspaceService | undefined {
    return this.workspaces.get(projectId);
  }

  async registerProject(db: Db, project: RegisteredProject): Promise<void> {
    const ws = new WorkspaceService(project.workspacePath);
    await ws.init();
    this.workspaces.set(project.id, ws);
  }

  async loadFromDb(db: Db): Promise<void> {
    const projects = await listRegisteredProjects(db);
    for (const p of projects) {
      const ws = new WorkspaceService(p.workspacePath);
      this.workspaces.set(p.id, ws);
    }
  }
}
```

### Pattern 2: RAG Namespacing via sourceId Convention

**What:** Rather than adding a new DB column, use a `sourceId` convention of `{projectSlug}:{filePath}` for project-scoped chunks. This follows the existing pattern where `sourceId` is already the repo directory name for git-ingested content.

**When to use:** For per-project RAG retrieval (PROJ-02) when scoping a search to one project's documents.

**Key insight:** `searchChunksByVector` already accepts `sourceId` as a filter. The existing `ingest_repo` queue action already uses the dir name as `sourceId`. The pattern already works — it just needs to be explicitly documented and used in the `retrieve()` call path.

**How retrieval scoping works today:**
```typescript
// retriever.ts — already supports sourceId filtering
const candidates = await searchChunksByVector(db, queryEmbedding, {
  limit: candidateLimit,
  sourceType: "git",
  sourceId: projectSlug,   // e.g. "ai-cofounder" scopes to that repo's chunks
});
```

**For per-project scoping in retrieval, pass the active project's sourceId:**
```typescript
// In orchestrator.retrieveRagContext(), when a project is active:
const chunks = await retrieve(db, embed, query, {
  limit: 5,
  sourceId: activeProject.ragSourceId,  // scoped to this project
  diversifySources: true,
});
```

**Cross-project retrieval:** Omit `sourceId` to search all projects, or pass a list of project `ragSourceId` values via multiple queries merged by score.

### Pattern 3: VPS Container Resource Stats

**What:** Extend the existing `checkVPSHealth()` SSH script to also run `docker stats --no-stream --format json` and parse per-container CPU/memory metrics.

**When to use:** For PROJ-03 — gives the agent queryable container-level resource utilization.

**Key insight:** `docker stats --no-stream` outputs one JSON object per line. The existing `execFile` + separator pattern in `MonitoringService` already handles multi-output SSH commands cleanly.

**Extended SSH script:**
```typescript
const script = [
  "df -h / | tail -1 | awk '{print $5}'",
  "free | grep Mem | awk '{printf \"%.1f\", $3/$2 * 100}'",
  "cat /proc/loadavg | awk '{print $1,$2,$3}'",
  "uptime -p",
  "docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null || echo 'no-docker'",
  // NEW: per-container resource stats
  "docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null || echo 'no-stats'",
].join(" && echo '---SEPARATOR---' && ");
```

**Extended ContainerStatus:**
```typescript
export interface ContainerStatus {
  name: string;
  status: string;
  health: string;
  uptime: string;
  // NEW fields:
  cpuPercent?: number;
  memUsage?: string;
  memPercent?: number;
}
```

### Pattern 4: Cross-Project Impact Detection

**What:** An orchestrator tool `analyze_cross_project_impact` that: (1) reads the project dependency map from DB, (2) reads current diffs/changes in the affected project, (3) calls the LLM with a structured prompt to reason about cascade effects.

**When to use:** PROJ-04 — before pushing changes that might affect shared infrastructure or dependent projects.

**Architecture:** The tool does not need a separate LLM call in the tool layer — the orchestrator's existing LLM context is sufficient. The tool just gathers evidence (project map, recent changes, shared infra info) and returns structured data. The orchestrator LLM then reasons over it.

**DB schema for cross-project dependencies:**
```sql
-- project_dependencies table (lightweight join table)
CREATE TABLE project_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_project_id uuid NOT NULL REFERENCES registered_projects(id) ON DELETE CASCADE,
  target_project_id uuid NOT NULL REFERENCES registered_projects(id) ON DELETE CASCADE,
  dependency_type text NOT NULL,  -- "shared_infra" | "api_client" | "shared_db" | "deploys_together"
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### Pattern 5: DB Schema for registered_projects

**What:** New `registered_projects` table with all project metadata.

```typescript
// packages/db/src/schema.ts addition
export const projectLanguageEnum = pgEnum("project_language", [
  "typescript",
  "python",
  "javascript",
  "go",
  "other",
]);

export const registeredProjects = pgTable("registered_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),         // "ai-cofounder", "clip-automation"
  slug: text("slug").notNull().unique(),         // URL-safe, used as RAG sourceId
  repoUrl: text("repo_url"),
  workspacePath: text("workspace_path").notNull(), // absolute path on disk
  description: text("description"),
  language: projectLanguageEnum("language").notNull().default("typescript"),
  defaultBranch: text("default_branch").notNull().default("main"),
  testCommand: text("test_command"),
  isActive: boolean("is_active").notNull().default(true),
  config: jsonb("config"),                       // flexible per-project config
  lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectDependencies = pgTable("project_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceProjectId: uuid("source_project_id").notNull().references(() => registeredProjects.id, { onDelete: "cascade" }),
  targetProjectId: uuid("target_project_id").notNull().references(() => registeredProjects.id, { onDelete: "cascade" }),
  dependencyType: text("dependency_type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Pattern 6: Orchestrator Tool Additions

New tools to add to `apps/agent-server/src/agents/tools/project-tools.ts`:

```typescript
export const REGISTER_PROJECT_TOOL: LlmTool = {
  name: "register_project",
  description:
    "Register a new project workspace with the agent. " +
    "The agent will ingest project documentation into RAG and can then switch context to this project. " +
    "Use this when setting up a new codebase for the agent to work with.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Human-readable project name" },
      workspace_path: { type: "string", description: "Absolute path to the project on disk" },
      repo_url: { type: "string", description: "Optional git remote URL" },
      description: { type: "string", description: "Brief description of the project" },
      language: { type: "string", enum: ["typescript", "python", "javascript", "go", "other"] },
      test_command: { type: "string", description: "Default test command (e.g. npm test, pytest)" },
    },
    required: ["name", "workspace_path"],
  },
};

export const SWITCH_PROJECT_TOOL: LlmTool = {
  name: "switch_project",
  description:
    "Switch the active workspace context to a registered project. " +
    "After switching, file/git operations will apply to the selected project. " +
    "RAG retrieval will prioritize this project's documentation.",
  input_schema: {
    type: "object",
    properties: {
      project_name: { type: "string", description: "Name of the registered project to switch to" },
    },
    required: ["project_name"],
  },
};

export const LIST_PROJECTS_TOOL: LlmTool = {
  name: "list_projects",
  description: "List all registered projects with their workspace paths, languages, and last-ingested timestamps.",
  input_schema: { type: "object", properties: {} },
};

export const ANALYZE_CROSS_PROJECT_IMPACT_TOOL: LlmTool = {
  name: "analyze_cross_project_impact",
  description:
    "Analyze how changes in one project might affect other registered projects. " +
    "Returns the dependency map and any shared infrastructure. " +
    "Use before making changes that touch shared APIs, shared DB, or shared infrastructure.",
  input_schema: {
    type: "object",
    properties: {
      project_name: { type: "string", description: "The project being changed" },
      change_description: { type: "string", description: "Brief description of what is being changed" },
    },
    required: ["project_name", "change_description"],
  },
};
```

New VPS query tool in `apps/agent-server/src/agents/tools/vps-tools.ts`:

```typescript
export const QUERY_VPS_TOOL: LlmTool = {
  name: "query_vps",
  description:
    "Query the current state of VPS infrastructure: running containers, per-container CPU/memory usage, " +
    "disk and memory utilization, and service health. Returns structured data suitable for reasoning.",
  input_schema: {
    type: "object",
    properties: {
      include_stats: {
        type: "boolean",
        description: "If true, include per-container CPU/memory stats (default: true)",
      },
    },
  },
};
```

### Anti-Patterns to Avoid

- **Single shared WorkspaceService for multiple projects:** Each project must have its own `WorkspaceService` instance scoped to its `workspacePath`. Do not try to make a single service handle multiple roots — the `resolveSafe()` protection relies on a single root.
- **Storing projectId as a new vector column:** Adding a new column to `document_chunks` requires a migration and changes the vector index. The `sourceId` convention is sufficient for scoping and already works.
- **Blocking orchestrator constructor on projectRegistry init:** Load the project registry async (during server startup plugin init), not in the constructor.
- **LLM call inside the tool layer for cross-project impact:** The tool should gather facts and return them; the orchestrator's main LLM does the reasoning. Avoid nested LLM calls inside tool handlers.
- **Active project stored only in memory:** The "currently active project" must be stored per-conversation (in conversation metadata or a session store), not as global mutable state. This prevents concurrent conversations from stepping on each other.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Path traversal prevention | Custom path sanitizer | Existing `WorkspaceService.resolveSafe()` per project | Already battle-tested, throw on traversal |
| Vector search with filter | Custom SQL | Existing `searchChunksByVector(db, vec, { sourceId })` | Already supports sourceId + sourceType filters |
| RAG chunk ingestion | New ingestion pipeline | Existing `ingestFiles()` + `enqueueRagIngestion()` queue | Already handles batching, embedding, dedup |
| SSH command execution | New SSH client library | `execFile("ssh", [...])` as used in MonitoringService | Already proven pattern, no new dep needed |
| Docker container parsing | Docker SDK | `docker ps --format` + `docker stats --no-stream` via SSH | VPS doesn't need SDK; SSH script is simpler and already works |
| DB CRUD | Raw SQL queries | Drizzle ORM with existing repository pattern | Consistent with all other DB operations |

**Key insight:** Everything needed for PROJ-01 through PROJ-04 already exists as primitives. This phase is composition, not invention.

---

## Common Pitfalls

### Pitfall 1: Active Project Scope in Concurrent Requests

**What goes wrong:** Two concurrent orchestrator invocations (e.g., two simultaneous chat requests) both call `switch_project` — if the active project is stored as a singleton service property, they will race and corrupt each other's context.

**Why it happens:** The `Orchestrator` class is constructed per-request (via `buildServer`), so the class itself is safe. The `ProjectRegistryService` as a Fastify plugin-level singleton is fine for the project registry (which projects exist), but the "currently active project for this request" must be per-invocation.

**How to avoid:** Pass `activeProjectId` as a parameter to `run()` and `runStream()`, resolved from conversation metadata. Do NOT store it in the `ProjectRegistryService` instance. Store per-conversation active project in the `conversations` table `metadata` jsonb column.

**Warning signs:** Tests pass in isolation but fail when run concurrently; one project's files appear in another project's context.

### Pitfall 2: RAG Retrieval Cross-Contamination

**What goes wrong:** When the agent switches to project B, RAG retrieval still returns chunks from project A because `sourceId` filtering is not applied.

**Why it happens:** The current `orchestrator.retrieveRagContext()` calls `retrieve()` without a `sourceId` filter — it searches the entire `document_chunks` table.

**How to avoid:** When an active project is set, pass `sourceId: activeProject.slug` to `retrieve()`. For cross-project queries (PROJ-04), explicitly make two retrieve calls: one scoped, one unscoped.

**Warning signs:** Agent cites architecture details from wrong project; "wrong project's CLAUDE.md" appears in context.

### Pitfall 3: WorkspacePath Security on VPS vs. Local

**What goes wrong:** Registered `workspacePath` values on VPS are absolute paths like `/opt/ai-cofounder`. If a user registers a project with `workspacePath = /etc`, `resolveSafe()` will still allow reads of `/etc/` because it IS within the `rootDir`.

**Why it happens:** `resolveSafe()` only protects against traversal _out of_ rootDir. If rootDir is set to `/etc`, all of `/etc` is accessible.

**How to avoid:** Validate `workspacePath` against a whitelist of allowed base directories (e.g., must start with `WORKSPACE_DIR` or a configured `PROJECTS_BASE_DIR`). Add a `validateProjectPath()` function in the registration flow.

**Warning signs:** Agent can read arbitrary files by registering a project at root path.

### Pitfall 4: docker stats --no-stream Hanging

**What goes wrong:** `docker stats --no-stream` hangs if Docker daemon is unresponsive or if the container list changes mid-read.

**Why it happens:** `docker stats` without `--no-stream` runs indefinitely. With `--no-stream`, it should exit after one sample, but a slow daemon can block.

**How to avoid:** The existing `execFile` call already has a `timeout: 15_000` — ensure the docker stats command is part of the same bounded SSH call. Alternatively, use `timeout 5 docker stats --no-stream`.

**Warning signs:** VPS health checks time out intermittently.

### Pitfall 5: Stale RAG After git pull on Registered Project

**What goes wrong:** Agent does a `git_pull` on a registered project, then asks about recent changes — RAG still returns pre-pull content.

**Why it happens:** `ingest_repo` is only triggered on `git_clone`, not on `git_pull`.

**How to avoid:** After a `git_pull`, enqueue an `ingest_repo` job with the project's `ragSourceId`. Add this to the `git_pull` case in `tool-executor.ts`, mirroring the existing `git_clone` auto-ingest.

**Warning signs:** Agent describes old code after a pull; RAG chunk timestamps are stale.

---

## Code Examples

### Example 1: Repository function for registered projects

```typescript
// Source: packages/db/src/repositories.ts — follow existing pattern
export async function createRegisteredProject(
  db: Db,
  data: {
    name: string;
    slug: string;
    workspacePath: string;
    repoUrl?: string;
    description?: string;
    language?: string;
    defaultBranch?: string;
    testCommand?: string;
    config?: Record<string, unknown>;
  },
) {
  const [row] = await db.insert(registeredProjects).values(data).returning();
  return row;
}

export async function listRegisteredProjects(db: Db) {
  return db.select().from(registeredProjects).where(eq(registeredProjects.isActive, true)).orderBy(asc(registeredProjects.name));
}

export async function getRegisteredProjectByName(db: Db, name: string) {
  const rows = await db.select().from(registeredProjects).where(eq(registeredProjects.name, name)).limit(1);
  return rows[0] ?? null;
}
```

### Example 2: Wiring ProjectRegistryService as a Fastify plugin

```typescript
// apps/agent-server/src/plugins/project-registry.ts
import fp from "fastify-plugin";
import { ProjectRegistryService } from "../services/project-registry.js";

declare module "fastify" {
  interface FastifyInstance {
    projectRegistry: ProjectRegistryService;
  }
}

export default fp(async (app) => {
  const registry = new ProjectRegistryService();
  if (app.db) {
    await registry.loadFromDb(app.db);
  }
  app.decorate("projectRegistry", registry);
});
```

### Example 3: Per-conversation active project in metadata

```typescript
// Store active project in conversation metadata
await db.update(conversations)
  .set({ metadata: { ...existing.metadata, activeProjectId: projectId } })
  .where(eq(conversations.id, conversationId));

// Read it back at orchestrator start
const conv = await getConversation(db, conversationId);
const activeProjectId = (conv?.metadata as { activeProjectId?: string })?.activeProjectId;
const activeProject = activeProjectId
  ? await getRegisteredProjectById(db, activeProjectId)
  : null;
```

### Example 4: Scoped RAG retrieval when project is active

```typescript
// In orchestrator.ts — retrieveRagContext() with project scoping
private async retrieveRagContext(query: string, activeProjectSlug?: string): Promise<string | null> {
  if (!this.db || !this.embeddingService) return null;
  try {
    const chunks = await retrieve(
      this.db,
      this.embeddingService.embed.bind(this.embeddingService),
      query,
      {
        limit: 5,
        minScore: 0.3,
        diversifySources: true,
        // Scope to active project when set
        ...(activeProjectSlug ? { sourceId: activeProjectSlug } : {}),
      },
    );
    if (chunks.length === 0) return null;
    return formatContext(chunks);
  } catch (err) {
    this.logger.warn({ err }, "RAG retrieval failed (non-fatal)");
    return null;
  }
}
```

### Example 5: Extended docker stats SSH script

```typescript
// In MonitoringService.checkVPSHealth()
const script = [
  "df -h / | tail -1 | awk '{print $5}'",
  "free | grep Mem | awk '{printf \"%.1f\", $3/$2 * 100}'",
  "cat /proc/loadavg | awk '{print $1,$2,$3}'",
  "uptime -p",
  "docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null || echo 'no-docker'",
  // NEW: per-container resource stats (one line per container: name|cpu%|mem_usage|mem%)
  "docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' 2>/dev/null || echo 'no-stats'",
].join(" && echo '---SEPARATOR---' && ");
// parts[5] is the new stats output
```

---

## State of the Art

| Old Approach | Current Approach | Phase 14 Change | Impact |
|--------------|------------------|-----------------|--------|
| Single WORKSPACE_DIR env var | Single WorkspaceService instance | Per-project WorkspaceService via ProjectRegistryService | Agent can work across multiple repos |
| Unscoped RAG retrieval | sourceId available but unused in auto-retrieval | Pass activeProject.slug to retrieve() call | No cross-project RAG contamination |
| docker ps (container names + status only) | docker ps format string | Add docker stats --no-stream | Agent can see CPU/memory per container |
| No cross-project data model | None | registered_projects + project_dependencies tables | Foundation for impact analysis |

**No deprecated approaches to worry about.** This phase adds to existing patterns without replacing them.

---

## Open Questions

1. **Active project persistence scope**
   - What we know: Conversation `metadata` jsonb already exists and can store `activeProjectId`
   - What's unclear: Should the active project switch persist across new conversations, or only within a conversation? (The user could set a "default project" in user settings)
   - Recommendation: Per-conversation scope is simpler and correct. If needed later, add a `defaultProjectId` to the `users` table.

2. **projectPath security boundary on production VPS**
   - What we know: VPS workspace is `/opt/ai-cofounder`; the agent could register arbitrary paths
   - What's unclear: Should path registration require a configurable `PROJECTS_BASE_DIR` allow-list?
   - Recommendation: Yes. Add a `PROJECTS_BASE_DIR` env var (defaults to `WORKSPACE_DIR`). All registered project paths must be children of one of the allowed base dirs. Validate on registration.

3. **Cross-project impact detection depth**
   - What we know: PROJ-04 says "reason about how changes in one project affect another" — this is LLM reasoning over a dependency map
   - What's unclear: Should the dependency map be auto-populated from package.json/requirements.txt inspection, or manually curated?
   - Recommendation: Manual curation for Phase 14 (simpler, reliable). Add `project_dependencies` via the registration API. Auto-detection from package.json can be a follow-up.

4. **RAG namespace: sourceId convention vs. new column**
   - What we know: `searchChunksByVector` already supports `sourceId` filter; existing ingest uses dir name as sourceId
   - What's unclear: If two projects have dirs with the same name (e.g., both cloned as `src`), sourceId would collide
   - Recommendation: Use the project `slug` (unique) as the RAG sourceId prefix. When ingesting for a project, pass `sourceId = project.slug` to `ingestFiles()`. The slug is enforced unique in the DB schema.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2.x (root vitest.config.ts) |
| Config file | `vitest.config.ts` at monorepo root |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=project` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-01 | register_project creates DB record + WorkspaceService instance | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=project-registry` | ❌ Wave 0 |
| PROJ-01 | switch_project resolves correct WorkspaceService for file ops | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=project-tools` | ❌ Wave 0 |
| PROJ-01 | list_projects returns all registered projects | unit | same file | ❌ Wave 0 |
| PROJ-01 | project registration validates path is within PROJECTS_BASE_DIR | unit | same file | ❌ Wave 0 |
| PROJ-02 | RAG retrieve scopes to active project sourceId | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=project-rag` | ❌ Wave 0 |
| PROJ-02 | git_pull triggers ingest_repo re-ingestion for registered project | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=project-tools` | ❌ Wave 0 |
| PROJ-03 | checkVPSHealth returns per-container CPU/memory stats | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=monitoring` | ✅ (extend existing monitoring.test.ts) |
| PROJ-03 | query_vps tool returns structured container data | unit | same project-tools file | ❌ Wave 0 |
| PROJ-04 | analyze_cross_project_impact returns dependency map | unit | same project-tools file | ❌ Wave 0 |
| PROJ-04 | project_dependencies CRUD works correctly | unit | `npm run test -w @ai-cofounder/db -- --testPathPattern=repositories` | ✅ (extend existing) |

### Sampling Rate
- **Per task commit:** `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=project`
- **Per wave merge:** `npm run test -w @ai-cofounder/agent-server && npm run test -w @ai-cofounder/db`
- **Phase gate:** Full `npm run test` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/agent-server/src/__tests__/project-registry.test.ts` — covers PROJ-01 (ProjectRegistryService unit tests)
- [ ] `apps/agent-server/src/__tests__/project-tools.test.ts` — covers PROJ-01, PROJ-02 (register_project, switch_project, list_projects, analyze_cross_project_impact tool handlers)
- [ ] `apps/agent-server/src/__tests__/project-routes.test.ts` — covers PROJ-01 REST endpoints
- [ ] `apps/agent-server/src/services/project-registry.ts` — service implementation (Wave 0 stub)
- [ ] `apps/agent-server/src/agents/tools/project-tools.ts` — tool definitions (Wave 0 stub)
- [ ] DB migration: `packages/db/drizzle/0025_add_projects.sql`

---

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection — `apps/agent-server/src/services/workspace.ts` (WorkspaceService, single-root design)
- Direct codebase inspection — `apps/agent-server/src/services/monitoring.ts` (VPS SSH, docker ps parsing)
- Direct codebase inspection — `packages/rag/src/retriever.ts` + `ingester.ts` (sourceId scoping, ingestFiles API)
- Direct codebase inspection — `packages/db/src/schema.ts` (all existing tables, no projects table today)
- Direct codebase inspection — `packages/db/src/repositories.ts` L1760 (searchChunksByVector — accepts sourceId filter)
- Direct codebase inspection — `apps/agent-server/src/agents/tool-executor.ts` (additive tool registration pattern)
- Direct codebase inspection — `apps/agent-server/src/plugins/queue.ts` L267 (ingest_repo handler, workspace-based file read)
- Direct codebase inspection — `packages/db/drizzle/` (last migration is 0024 — next is 0025)

### Secondary (MEDIUM confidence)
- CLAUDE.md and MEMORY.md project context — architecture conventions and patterns confirmed against source

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — inspected all relevant source files directly
- Architecture: HIGH — patterns derived from existing codebase conventions, not speculation
- Pitfalls: HIGH — three of five pitfalls are direct consequences of observed code constraints (single-root resolveSafe, unscoped RAG retrieval, docker stats blocking)
- DB schema: HIGH — follows exact Drizzle ORM patterns used in schema.ts; next migration number confirmed as 0025

**Research date:** 2026-03-15
**Valid until:** 2026-06-15 (stable codebase — 90 days)
