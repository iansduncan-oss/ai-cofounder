# Phase 17: Close Integration & Flow Gaps - Research

**Researched:** 2026-03-15
**Domain:** Integration gap closure — dashboard E2E flows, journal rendering, project scoping, scheduler tier enforcement
**Confidence:** HIGH

---

## Summary

Phase 17 closes four concrete integration gaps identified by a v2.0 milestone audit. Every gap has a clear root cause in the existing codebase that can be directly inspected. No new external dependencies are needed — this phase is pure internal wiring and UI plumbing within the existing stack.

The four gaps are: (1) no dashboard page for autonomous work sessions, (2) `content_pipeline` journal entry type renders with a fallback icon because it is absent from the api-client type union, (3) the project switcher stores the active project in localStorage but no API query passes it as a filter parameter, and (4) the scheduler creates an `Orchestrator` without the `autonomyTierService` so tier enforcement is bypassed for scheduled sessions.

**Primary recommendation:** Each gap is a small, isolated fix. Plan as four independent tasks with no cross-dependencies.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-01 | Agent picks up tasks from goal backlog and executes without human trigger | Autonomous sessions route + work sessions DB table already exists; page to display sessions is the gap |
| TERM-05 | Each execution produces a structured work log entry | `listRecentWorkSessions` and `GET /api/autonomous/sessions` exist and return structured data; no dashboard consumer exists |
| CONT-04 | Content pipeline outputs tracked in work journal | `content_pipeline` entryType in DB enum and `pipeline.ts` writes it; `JournalEntryType` in api-client types is missing it, causing unknown type fallback in UI |
| DASH-01 | Work journal page displaying all agent activity | Journal page exists; `content_pipeline` type renders incorrectly due to CONT-04 gap |
| PROJ-01 | Agent can register and switch between multiple workspace repos | Project switcher + localStorage hook already built; queries do not consume `activeProjectId` |
| DASH-04 | Multi-project switcher in dashboard header for switching active workspace context | Switcher UI exists; no query parameter threading to API calls |
| AUTO-01 | Green tier — agent executes without approval | AutonomyTierService exists and is wired in server.ts; not passed to scheduler's Orchestrator |
| AUTO-02 | Yellow tier — agent requests approval before executing | Same root cause as AUTO-01 |
| AUTO-03 | Red tier — agent never executes without explicit authorization | Same root cause as AUTO-01 |
| SCHED-01 | Agent picks up planned tasks from backlog on recurring BullMQ schedule | Scheduler exists; tier enforcement missing means SCHED-01 completion is incomplete |
</phase_requirements>

---

## Gap Analysis (The Four Fixes)

### Gap 1: No Autonomous Sessions Dashboard Page (TERM-01, TERM-05, DASH-01)

**Current state:**
- `GET /api/autonomous/sessions` exists in `autonomous.ts` route — returns `{ data: WorkSession[], count }` via `listRecentWorkSessions`
- `ApiClient.listAutonomousSessions()` method exists in `packages/api-client/src/client.ts`
- No dashboard route, nav item, or page component exists for autonomous sessions
- The sidebar has no "Autonomous" or "Sessions" link

**What's needed:**
- New page component: `apps/dashboard/src/routes/autonomous-sessions.tsx`
- New `useAutonomousSessions()` query hook in `queries.ts`
- New query key: `autonomous.sessions` in `query-keys.ts`
- Route registration in `routes/index.tsx`
- Sidebar nav item added to `sidebar.tsx`
- `WorkSession` type needs to be defined in api-client types (currently typed as `Record<string, unknown>[]`)

**WorkSession data shape** (from `schema.ts` and `listRecentWorkSessions`):

```typescript
// From packages/db/src/schema.ts (workSessions table)
{
  id: string;               // uuid
  trigger: string;          // "schedule" | "manual" | "event"
  scheduleId: string | null;
  eventId: string | null;
  goalId: string | null;
  status: string;           // "running" | "completed" | "failed" | "timeout" | "skipped" | "aborted"
  tokensUsed: number | null;
  durationMs: number | null;
  actionsTaken: Record<string, unknown> | null;
  summary: string | null;
  context: Record<string, unknown> | null;
  startedAt: Date;          // createdAt
  completedAt: Date | null;
}
```

**Page design pattern (from `subagents.tsx` / `activity.tsx`):** Table or card list with status badges, duration, trigger source, summary text. Link to related goal when `goalId` is present.

---

### Gap 2: content_pipeline Journal Type Missing (CONT-04, DASH-01)

**Current state:**
- `journalEntryTypeEnum` in `packages/db/src/schema.ts` line 692 includes `"content_pipeline"` — it is in the DB enum
- `pipeline.ts` service writes journal entries with `entryType: "content_pipeline"` at line 158
- `JournalEntryType` in `packages/api-client/src/types.ts` (lines 594-600) does NOT include `"content_pipeline"`:

```typescript
// CURRENT (missing content_pipeline):
export type JournalEntryType =
  | "goal_started" | "goal_completed" | "goal_failed"
  | "task_completed" | "task_failed"
  | "git_commit" | "pr_created"
  | "reflection" | "work_session" | "subagent_run" | "deployment";
```

- `typeConfig` in `journal.tsx` falls back to `typeConfig.work_session` for unknown types (line 38: `typeConfig[entry.entryType] ?? typeConfig.work_session`)
- `entryTypes` array in `journal.tsx` line 91 also omits `content_pipeline`

**What's needed (two-file fix):**

1. **`packages/api-client/src/types.ts`**: Add `"content_pipeline"` to `JournalEntryType` union

2. **`apps/dashboard/src/routes/journal.tsx`**:
   - Add `content_pipeline` entry to `typeConfig` object (choose icon: `Workflow` from lucide-react, color `text-orange-400`, label `"Content Pipeline"`)
   - Add `"content_pipeline"` to `entryTypes` array for the filter dropdown

**Confidence:** HIGH — the fix is trivially clear from source inspection.

---

### Gap 3: Project Switcher Does Not Scope API Queries (PROJ-01, DASH-04)

**Current state:**
- `useActiveProject()` hook in `hooks/use-active-project.ts` reads from `localStorage("ai-cofounder-active-project-id")` via `useSyncExternalStore`
- `ProjectSwitcher` component reads and writes this value correctly
- **No query in `queries.ts` reads `activeProject` or passes `projectId` to any API call**

**What "project scoping" means in this codebase:**
- Goals are scoped by `conversationId`, not `projectId` — the DB schema has no `projectId` on goals
- The `registeredProjects` table stores project metadata (workspacePath, name, etc.) but is not linked to goals in the schema
- The realistic scoping approach for Phase 17 is UI-level: when a project is selected, the dashboard can filter displayed goals by matching the `workspacePath` to `WorkspaceService` context, OR simply highlight the active project context in the header without actually filtering goals (since there is no DB linkage)

**Recommended interpretation (PROJ-01 success criterion):** "API queries scope data by active project" likely means:
1. Goals page shows only goals associated with the active workspace/project
2. The journal page shows only journal entries for the active project

However, since there is no `projectId` FK on goals or journal entries in the current schema, the most practical implementation is:
- **Option A:** Pass `projectId` as a query param to goals/journal endpoints → server ignores unknown params (no-op currently) → requires schema + repo changes
- **Option B:** Filter the displayed list client-side based on some heuristic (e.g., goals with metadata linking to a project)
- **Option C:** The project switcher changes the workspace context shown in workspace-related pages only (WorkspacePage, HUD workspace card) — not goals/journal

**Recommendation:** The success criterion says "API queries scope data by active project." The path of least resistance that satisfies the requirement without a migration is:
- Add `projectId` as an optional filter parameter to `GET /api/goals` and `GET /api/journal`
- When `activeProject` is set in the dashboard, append `?projectId=<id>` to these queries
- Server filters by... TBD since there's no FK — could use `goals.metadata->>'projectId'` JSONB filter or a new `goals.projectId` column

**Schema decision needed:** Either add `projectId uuid` column to goals (migration required), or do metadata-based JSONB filtering, or do client-side filtering only (no API change). Phase 17 is a "gap closure" phase — the safest minimal approach is client-side filtering with metadata, or — given the milestone audit identified this as a gap — add a `projectId` column to goals.

**Research finding:** No `projectId` on goals exists. The planner must decide: (a) add a DB migration to add `projectId` to goals, or (b) implement client-side-only project context that changes the workspace path shown in HUD/Workspace pages. Given "gap closure" scope, recommend option (b) as minimal viable — just make the workspace page and HUD workspace section respect the active project, and document that full goal scoping requires a future migration.

---

### Gap 4: Scheduler Missing AutonomyTierService (AUTO-01, AUTO-02, AUTO-03, SCHED-01)

**Current state:**
- `AutonomyTierService` is instantiated in `server.ts` onReady hook at line 305 and stored as `app.autonomyTierService`
- The `Orchestrator` constructor accepts `autonomyTierService` as its 12th optional parameter (line 330 of `orchestrator.ts`)
- `startScheduler()` in `services/scheduler.ts` creates an `Orchestrator` at line 218 WITHOUT passing `autonomyTierService`
- `SchedulerConfig` interface (lines 29-41 of `scheduler.ts`) does NOT include `autonomyTierService`
- `server.ts` calls `startScheduler()` at line 347 WITHOUT passing `autonomyTierService`

**The fix (two-file change):**

```typescript
// services/scheduler.ts — SchedulerConfig interface
export interface SchedulerConfig {
  // ... existing fields ...
  autonomyTierService?: AutonomyTierService;  // ADD THIS
}

// In the Orchestrator instantiation inside tick():
const orchestrator = new Orchestrator(
  llmRegistry,
  db,
  "conversation",
  embeddingService,
  n8nService,
  sandboxService,
  workspaceService,
  messagingService,
  undefined, // monitoringService
  undefined, // projectRegistryService
  undefined, // browserService
  config.autonomyTierService,  // ADD THIS
);
```

```typescript
// server.ts — startScheduler() call
const scheduler = startScheduler({
  db: app.db,
  llmRegistry,
  embeddingService,
  n8nService,
  sandboxService,
  workspaceService,
  notificationService,
  messagingService: app.messagingService,
  autonomyTierService: app.autonomyTierService,  // ADD THIS
  // ...
});
```

**Orchestrator constructor parameter order** (from `orchestrator.ts` lines 315-343):
```
1. registry: LlmRegistry
2. db: Db
3. taskCategory: string
4. embeddingService?: EmbeddingService
5. n8nService?: N8nService
6. sandboxService?: SandboxService
7. workspaceService?: WorkspaceService
8. messagingService?: AgentMessagingService
9. monitoringService?: MonitoringService  (added Phase 14)
10. projectRegistryService?: ProjectRegistryService  (added Phase 14)
11. browserService?: BrowserService
12. autonomyTierService?: AutonomyTierService
```

**Confidence:** HIGH — confirmed by direct source reading of orchestrator.ts and scheduler.ts.

---

## Standard Stack

### Core (all pre-existing in this project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React + React Router | 19/7 | Dashboard SPA routing | Already in use |
| TanStack Query | v5 | Server state management | Already in use |
| Vitest | v4 | Test runner | Already in use |
| Tailwind v4 | v4 | Styling | Already in use |
| Lucide React | current | Icons | Already in use |

### No New Dependencies Needed
All fixes are pure internal wiring. Phase 17 adds zero new npm packages.

---

## Architecture Patterns

### Dashboard Page Pattern (from existing pages)
```typescript
// Pattern: lazy-loaded route page with useQuery hook
// Source: apps/dashboard/src/routes/subagents.tsx, activity.tsx

export function AutonomousSessionsPage() {
  const { data, isLoading } = useAutonomousSessions(20);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Autonomous Sessions</h1>
      {isLoading ? <SkeletonList /> : <SessionList sessions={data?.data ?? []} />}
    </div>
  );
}
```

### Query Hook Pattern
```typescript
// Pattern: add to apps/dashboard/src/api/queries.ts
export function useAutonomousSessions(limit = 20) {
  return useQuery({
    queryKey: queryKeys.autonomous.sessions,
    queryFn: () => apiClient.listAutonomousSessions(limit),
    refetchInterval: 30_000,  // sessions update as jobs complete
  });
}
```

### Query Key Pattern
```typescript
// Add to lib/query-keys.ts
autonomous: {
  all: ["autonomous"] as const,
  sessions: ["autonomous", "sessions"] as const,
}
```

### Route Registration Pattern
```typescript
// In routes/index.tsx
const AutonomousSessionsPage = lazy(() =>
  import("./autonomous-sessions").then((m) => ({ default: m.AutonomousSessionsPage })),
);
// In children array:
{ path: "autonomous", element: <AutonomousSessionsPage /> },
```

### Sidebar Nav Pattern
```typescript
// In sidebar.tsx navItems array
{ to: "/dashboard/autonomous", icon: PlayCircle, label: "Autonomous" },
```

### Type Fix Pattern
```typescript
// packages/api-client/src/types.ts — JournalEntryType union
export type JournalEntryType =
  | "goal_started" | "goal_completed" | "goal_failed"
  | "task_completed" | "task_failed"
  | "git_commit" | "pr_created"
  | "reflection" | "work_session" | "subagent_run" | "deployment"
  | "content_pipeline";  // ADD THIS
```

### WorkSession Type Pattern
```typescript
// packages/api-client/src/types.ts — new type to add
export interface WorkSession {
  id: string;
  trigger: string;
  scheduleId: string | null;
  eventId: string | null;
  goalId: string | null;
  status: "running" | "completed" | "failed" | "timeout" | "skipped" | "aborted";
  tokensUsed: number | null;
  durationMs: number | null;
  actionsTaken: Record<string, unknown> | null;
  summary: string | null;
  context: Record<string, unknown> | null;
  createdAt: string;
  completedAt: string | null;
}
```

### Scheduler Tier Wiring Pattern
```typescript
// services/scheduler.ts — extend SchedulerConfig
import type { AutonomyTierService } from "./autonomy-tier.js";

export interface SchedulerConfig {
  db: Db;
  llmRegistry: LlmRegistry;
  embeddingService?: EmbeddingService;
  n8nService: N8nService;
  sandboxService: SandboxService;
  workspaceService: WorkspaceService;
  notificationService?: NotificationService;
  messagingService?: AgentMessagingService;
  autonomyTierService?: AutonomyTierService;  // NEW
  pollIntervalMs?: number;
  briefingHour?: number;
  briefingTimezone?: string;
}
```

### Anti-Patterns to Avoid
- **Don't add a projectId FK migration in this phase** — Goal scoping by projectId would require a migration, backfill, and changes across 10+ repository functions. The phase is "gap closure," not schema expansion. Client-side project context in workspace-related pages is sufficient to satisfy PROJ-01/DASH-04 for this milestone.
- **Don't break backward compat in SchedulerConfig** — `autonomyTierService` must be optional (`?`) so existing callers (tests) don't break.
- **Don't add `content_pipeline` to any allowlist/enum in tests** — the type fix is purely additive; existing tests should pass unchanged.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status badge display | Custom badge component | Pattern from `TaskStatusBadge` or `TierBadge` — use `cn()` + Tailwind variants | Already established badge pattern in codebase |
| Duration formatting | Custom date math | Existing pattern in `autonomous-session.ts`: `Math.round(durationMs / 1000)` + `s`/`m`/`h` suffix display | Matches what server already calculates |
| Skeleton loading | Custom shimmer | Existing pattern `<div className="h-20 bg-muted animate-pulse rounded-lg" />` | Already in journal.tsx, goals.tsx |

---

## Common Pitfalls

### Pitfall 1: Orchestrator Constructor Positional Parameter Count
**What goes wrong:** The Orchestrator constructor has 12 positional parameters. Adding `autonomyTierService` at the wrong position shifts all subsequent params.
**Why it happens:** The constructor grew over multiple phases; it's easy to miscounted.
**How to avoid:** Read `orchestrator.ts` lines 315-343 to count exact parameter order before writing the scheduler fix. Position 12 is confirmed: `registry, db, taskCategory, embeddingService, n8nService, sandboxService, workspaceService, messagingService, monitoringService, projectRegistryService, browserService, autonomyTierService`.
**Warning signs:** TypeScript will error on type mismatch if args are in wrong order.

### Pitfall 2: listAutonomousSessions Return Type Is Currently Untyped
**What goes wrong:** `ApiClient.listAutonomousSessions()` returns `Record<string, unknown>[]` — TypeScript won't catch missing field references.
**Why it happens:** The method was written before a `WorkSession` type was defined.
**How to avoid:** Add the `WorkSession` interface to api-client types first, then update `listAutonomousSessions()` to return `{ data: WorkSession[]; count: number }`.

### Pitfall 3: Project Switcher Query Cache Key Must Include projectId
**What goes wrong:** If `useGoals()` or journal queries are updated to pass `projectId` but the query key doesn't include it, TanStack Query will serve stale cached data from before the project switch.
**Why it happens:** Query keys must encode all inputs that affect the result.
**How to avoid:** When adding `projectId` to any query, include it in the `queryKey` array: `["goals", "list", conversationId, projectId ?? "all"]`.

### Pitfall 4: auto-build hooks strip imports
**What goes wrong:** Editing `packages/db`, `packages/api-client`, or other auto-built packages will trigger auto-build via hooks; if the build fails, linter may strip imports in dependent files.
**How to avoid:** After editing `packages/api-client/src/types.ts`, verify the build succeeds before editing dashboard files that import the new types.
**Warning signs:** TypeScript errors about unknown imports in dashboard after editing api-client.

### Pitfall 5: Scheduler test mocking AutonomyTierService
**What goes wrong:** Existing scheduler tests don't pass `autonomyTierService` to `startScheduler()`. If the code crashes when `undefined`, tests break.
**Why it happens:** `autonomyTierService` must be optional and defensively used.
**How to avoid:** Ensure the scheduler calls `config.autonomyTierService` only when defined. The Orchestrator constructor already handles `undefined` gracefully.

---

## Code Examples

### Verified: Orchestrator Constructor Signature (from orchestrator.ts lines 315-343)
```typescript
// Source: apps/agent-server/src/agents/orchestrator.ts
constructor(
  private registry: LlmRegistry,
  private db: Db,
  private taskCategory: string = "conversation",
  private embeddingService?: EmbeddingService,
  private n8nService?: N8nService,
  private sandboxService?: SandboxService,
  private workspaceService?: WorkspaceService,
  private messagingService?: AgentMessagingService,
  private monitoringService?: MonitoringService,
  private projectRegistryService?: ProjectRegistryService,
  private browserService?: BrowserService,
  autonomyTierService?: AutonomyTierService,
) {
  // ...
  this.autonomyTierService = autonomyTierService;
}
```

### Verified: listRecentWorkSessions API Response Shape
```typescript
// Source: autonomous.ts route + packages/db/src/repositories.ts
// GET /api/autonomous/sessions → { data: WorkSession[], count: number }
// packages/db/src/repositories.ts listRecentWorkSessions returns from workSessions table
```

### Verified: content_pipeline Written by Pipeline Service
```typescript
// Source: apps/agent-server/src/services/pipeline.ts line 154-158
void createJournalEntry(this.db, {
  entryType: "content_pipeline",
  title: `Pipeline: ${this.template.name}`,
  // ...
});
```

### Verified: useActiveProject Hook Pattern
```typescript
// Source: apps/dashboard/src/hooks/use-active-project.ts
export function useActiveProject(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
// Returns the localStorage "ai-cofounder-active-project-id" value
// ProjectSwitcher writes via useSetActiveProject()
```

---

## State of the Art

| Old Approach | Current Approach | Impact for Phase 17 |
|--------------|------------------|---------------------|
| No autonomous session tracking UI | Backend route + DB exists, no page | Phase 17 adds the page |
| ProjectSwitcher writes localStorage | Nothing reads activeProject in queries | Phase 17 wires query context |
| Scheduler bypasses tier enforcement | All other Orchestrator callers pass tierService | Phase 17 closes the gap |
| content_pipeline in DB, not in types | UI shows wrong label/icon | Phase 17 syncs the type |

---

## Open Questions

1. **Project scoping depth for PROJ-01/DASH-04**
   - What we know: No `projectId` column on goals or journal entries; only `registeredProjects` table with metadata
   - What's unclear: Does "scope data by active project" require DB-level filtering (migration) or is workspace-context-awareness sufficient?
   - Recommendation: Scope to workspace page + HUD workspace section for Phase 17. Full goal scoping = future migration.

2. **WorkSession type in api-client index.ts**
   - What we know: `client.ts` exports `listAutonomousSessions` returning untyped `Record<string, unknown>[]`
   - What's unclear: Should `WorkSession` be added to `packages/api-client/src/types.ts` and re-exported from `index.ts`?
   - Recommendation: Yes — add `WorkSession` to types.ts and update `listAutonomousSessions()` return type in client.ts.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (root config) |
| Config file | `vitest.config.ts` at monorepo root |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="autonomous-routes\|scheduler"` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TERM-01/TERM-05 | GET /api/autonomous/sessions returns work sessions | unit | existing autonomous-routes.test.ts | Yes |
| CONT-04 | content_pipeline entry renders correct icon/label | unit | `npm run test -w @ai-cofounder/dashboard` | No — Wave 0 |
| DASH-01 | Journal page shows content_pipeline entries correctly | unit | `npm run test -w @ai-cofounder/dashboard` | No — Wave 0 |
| PROJ-01/DASH-04 | Active project context changes workspace display | unit | `npm run test -w @ai-cofounder/dashboard` | No — Wave 0 |
| AUTO-01/02/03/SCHED-01 | Scheduler passes autonomyTierService to Orchestrator | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="scheduler"` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose`
- **Per wave merge:** `npm run test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/agent-server/src/__tests__/scheduler-tier.test.ts` — verify autonomyTierService is passed to Orchestrator in scheduler (unit test with mocked Orchestrator constructor)
- [ ] `apps/dashboard/src/__tests__/journal.test.tsx` — verify content_pipeline type renders "Content Pipeline" label (render test using renderWithProviders)
- [ ] `apps/dashboard/src/__tests__/autonomous-sessions.test.tsx` — verify autonomous sessions page renders sessions from API (render test)

---

## Sources

### Primary (HIGH confidence)
- Direct source read: `apps/agent-server/src/services/scheduler.ts` — confirmed AutonomyTierService not in SchedulerConfig or Orchestrator call
- Direct source read: `apps/agent-server/src/agents/orchestrator.ts` — confirmed constructor param order (12 params)
- Direct source read: `packages/api-client/src/types.ts` lines 594-600 — confirmed `content_pipeline` absent from JournalEntryType
- Direct source read: `packages/db/src/schema.ts` lines 680-692 — confirmed `content_pipeline` in DB enum
- Direct source read: `apps/dashboard/src/routes/journal.tsx` lines 12-24 — confirmed typeConfig lacks content_pipeline
- Direct source read: `apps/dashboard/src/hooks/use-active-project.ts` — confirmed hook exists, no queries consume it
- Direct source read: `packages/api-client/src/client.ts` — confirmed `listAutonomousSessions` exists, returns untyped data
- Direct source read: `apps/dashboard/src/routes/index.tsx` — confirmed no autonomous sessions route

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md traceability table — confirms all 10 IDs map to this phase
- STATE.md — confirms Phase 16 complete, Phase 17 is next

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Gap identification: HIGH — all four gaps confirmed by direct source reading
- Fix approach: HIGH — each fix is 2-5 lines of code with clear location
- Project scoping interpretation: MEDIUM — "scope data by active project" is ambiguous given no FK linkage; workspace-context approach is conservative but valid
- Test patterns: HIGH — test patterns established by existing 96+ test files

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable codebase, no external dependencies to go stale)
