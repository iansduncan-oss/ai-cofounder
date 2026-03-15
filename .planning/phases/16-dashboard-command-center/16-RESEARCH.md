# Phase 16: Dashboard Command Center - Research

**Researched:** 2026-03-15
**Domain:** React + TanStack Query dashboard UI — new pages, project switcher, notification center, settings extensions
**Confidence:** HIGH

## Summary

Phase 16 is a pure frontend phase. All six DASH requirements map to dashboard UI work in `apps/dashboard`. The backend already exposes every API endpoint needed: journal entries, approvals, cost data, projects, monitoring status, and tool tier configuration. No new backend routes or DB migrations are required for this phase.

The codebase has a mature, established dashboard pattern: React + Vite + TanStack Query + React Router + Tailwind v4 + Recharts + Sonner for toasts. Every route is a lazy-loaded TSX file in `src/routes/`, registered in `src/routes/index.tsx`. Queries live in `src/api/queries.ts`, mutations in `src/api/mutations.ts`, and shared UI components in `src/components/`.

The key insight: several DASH requirements are partially or substantially already implemented. `JournalPage` (`/dashboard/journal`) already exists with timeline view, search, and type filtering (DASH-01 is largely done). `ApprovalsPage` (`/dashboard/approvals`) is fully implemented with approve/deny actions (DASH-02 is done). `UsagePage` (`/dashboard/usage`) is fully implemented with charts, budget gauges, and optimization suggestions (DASH-03 is done). `SettingsPage` already has the autonomy tier configurator (partial DASH-06). The notification bell in the sidebar is a partial DASH-05. What is genuinely missing: the multi-project switcher (DASH-04), a dedicated full-page notification center (DASH-05), and settings extensions for budget thresholds and project registrations (DASH-06).

**Primary recommendation:** The planner should scope Phase 16 around the genuine gaps — multi-project switcher (header component + localStorage/context for active project), a full `/dashboard/notifications` page that consolidates approvals, budget alerts, and CI events, and extending `SettingsPage` with budget threshold inputs (writing `DAILY_BUDGET_USD`/`WEEKLY_BUDGET_USD` env override via a new settings route) and a project registration form. The existing journal, approvals, and usage pages may need minor polish (date-range filtering on journal, tier context on approvals queue) but should not be rebuilt.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DASH-01 | Work journal page displaying all agent activity in chronological timeline view | `JournalPage` already exists at `/dashboard/journal` with timeline, search, type filter. May need date-range picker and pagination for "all activity" view per JRNL-04. |
| DASH-02 | Approval queue page showing pending yellow/red tier requests with context and approve/deny actions | `ApprovalsPage` already exists at `/dashboard/approvals` with full approve/deny actions. May need tier badge on each approval card to show yellow vs red context. |
| DASH-03 | Cost dashboard page with charts — daily spend, per-model breakdown, cumulative trend, budget gauge | `UsagePage` already exists at `/dashboard/usage` with LineChart (daily trend), PieChart (distribution), BarChart (by provider, model, agent), and budget gauges. This requirement is met. |
| DASH-04 | Multi-project switcher in dashboard header for switching active workspace context | Does not exist. Backend has full CRUD at `/api/projects`. Needs: `useProjects` query hook, project switcher dropdown in sidebar header, active project stored in `localStorage`/context, propagated to relevant queries. |
| DASH-05 | Notification center aggregating agent updates, approval requests, budget alerts, and CI events | `NotificationBell` component in sidebar is a partial implementation. Full-page `/dashboard/notifications` center missing. Needs aggregation from approvals, monitoring status, budget alerts, journal events. |
| DASH-06 | Settings page for configuring autonomy tiers per-tool, budget thresholds, and project registrations | Autonomy tier config is in `SettingsPage`. Budget threshold fields (DAILY_BUDGET_USD / WEEKLY_BUDGET_USD) and project registration form are missing. Needs new API endpoint to update budget env/config at runtime or persist to DB. |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.x | UI rendering | Already in use throughout dashboard |
| React Router | 6.x (v7 API) | Client-side routing | Already in use — `createBrowserRouter`, lazy routes |
| TanStack Query | 5.x | Server state, caching, refetch | Already in use — all API calls go through `useQuery`/`useMutation` |
| Tailwind CSS | v4 | Utility-first styling | Already in use — CSS variables via `var(--color-*)` |
| Recharts | 2.x | Charts | Already in use in `UsagePage` and `AnalyticsPage` |
| Sonner | latest | Toast notifications | Already in use via `toast.success`/`toast.error` in mutations |
| Lucide React | latest | Icons | Already in use throughout — `lucide-react` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tanstack/react-query` devtools | 5.x | Debug queries | Dev only — already configured |
| `@ai-cofounder/api-client` | local | Typed HTTP client | All backend calls go through `apiClient.*` methods |
| `@ai-cofounder/shared` | local | WS types, shared types | WebSocket channel definitions for real-time |

### No New Dependencies
No new npm packages are needed for Phase 16. All required libraries are already installed.

**Installation:** None required.

---

## Architecture Patterns

### Existing Page Pattern (Follow Exactly)
```
src/routes/my-page.tsx         ← route component (exported named function)
src/routes/index.tsx           ← register lazy import + route
src/api/queries.ts             ← add useMyQuery() hook
src/api/mutations.ts           ← add useMySave() mutation hook
src/lib/query-keys.ts          ← add queryKeys.myDomain.*
```

### Recommended Project Structure for Phase 16 Additions
```
src/routes/
├── notifications.tsx          ← NEW: full-page notification center (DASH-05)
src/components/
├── layout/
│   └── project-switcher.tsx   ← NEW: dropdown in sidebar header (DASH-04)
├── settings/
│   └── budget-settings.tsx    ← NEW: budget threshold fields extracted from SettingsPage
│   └── project-settings.tsx   ← NEW: project registration panel
```

### Pattern 1: TanStack Query hook
**What:** Wrap every API call in a typed `useQuery` hook in `queries.ts`
**When to use:** Any data fetch from backend

```typescript
// Source: existing pattern in apps/dashboard/src/api/queries.ts
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list,
    queryFn: () => apiClient.listProjects(),
    staleTime: 60_000,
  });
}
```

### Pattern 2: Mutation with cache invalidation
**What:** `useMutation` with `onSuccess` cache invalidation + Sonner toast
**When to use:** Any write operation (approve, save settings, create project)

```typescript
// Source: existing pattern in apps/dashboard/src/api/mutations.ts
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProjectInput) => apiClient.createProject(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.projects.all });
      toast.success("Project registered");
    },
    onError: (err) => {
      toast.error(`Failed to register project: ${err.message}`);
    },
  });
}
```

### Pattern 3: Lazy route registration
**What:** `lazy()` import + `createBrowserRouter` route entry
**When to use:** Every new page

```typescript
// Source: apps/dashboard/src/routes/index.tsx
const NotificationsPage = lazy(() =>
  import("./notifications").then((m) => ({ default: m.NotificationsPage })),
);
// ... in children array:
{ path: "notifications", element: <NotificationsPage /> },
```

### Pattern 4: QueryKey namespace
**What:** Add new namespace to `queryKeys` object
**When to use:** Every new data domain

```typescript
// Source: apps/dashboard/src/lib/query-keys.ts
projects: {
  all: ["projects"] as const,
  list: ["projects", "list"] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
},
notifications: {
  all: ["notifications"] as const,
  list: (params?: string) => ["notifications", "list", params ?? ""] as const,
},
```

### Pattern 5: Sidebar nav item
**What:** Add entry to `navItems` array in `sidebar.tsx`
**When to use:** Every new route that should be globally accessible

```typescript
// Source: apps/dashboard/src/components/layout/sidebar.tsx
{ to: "/dashboard/notifications", icon: Bell, label: "Notifications" },
```

### Pattern 6: WebSocket real-time invalidation
**What:** Add channel → query key mapping so WS `invalidate` messages auto-refetch
**When to use:** Any query that should update in real time
**Note:** `WS_CHANNEL_QUERY_KEYS` in `packages/shared/src/ws-types.ts` already has "approvals", "journal", "monitoring" channels wired. Adding "projects" channel would require a backend ws-emitter call, but for Phase 16 that is optional — projects rarely change.

### Anti-Patterns to Avoid
- **Don't add `refetchInterval`:** Real-time sync is handled by WebSocket `invalidate` messages. Only add polling if the WS channel doesn't cover the data. `usePendingApprovals` and `usePendingTasks` already have `refetchInterval` as fallback.
- **Don't use Proxy for vi.mock:** Per MEMORY.md critical note — all mocks use `...mockDbModule()` spread pattern.
- **Don't put business logic in route components:** Keep route components thin. Extract hooks and sub-components.
- **Don't duplicate badge/status components:** Reuse `GoalStatusBadge`, `ApprovalStatusBadge`, `TaskStatusBadge` from `src/components/common/status-badge.tsx`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Charts | Custom SVG charts | Recharts (already installed) | `BarChart`, `LineChart`, `PieChart` from recharts already in usage.tsx |
| Toast notifications | Custom alert UI | Sonner `toast.success/error` | Already wired via `<Toaster>` in main.tsx |
| Dialog/Modal | Custom modal | `Dialog` component from `src/components/ui/dialog` | Already exists, used in ApprovalsPage |
| Server state caching | Custom cache | TanStack Query `useQuery`/`useMutation` | Already configured, handles staleTime, refetch, invalidation |
| Real-time updates | Polling intervals | WebSocket `useRealtimeSync` via `RealtimeProvider` | Already connected — send `invalidate` from backend, dashboard auto-refetches |
| Loading states | Custom spinners | `ListSkeleton`, `CardSkeleton` from `src/components/common/loading-skeleton` | Consistent UX already established |
| Empty states | Custom empty UI | `EmptyState` from `src/components/common/empty-state` | Already used across 5 pages |
| Relative timestamps | Date formatting | `RelativeTime` from `src/components/common/relative-time` | Already used across journal, activity, approvals |

**Key insight:** The dashboard component library is already comprehensive. Phase 16 should compose existing primitives, not introduce new UI patterns.

---

## Common Pitfalls

### Pitfall 1: Rebuilding existing pages
**What goes wrong:** Implementing DASH-01/02/03 as new pages when they already exist as `/dashboard/journal`, `/dashboard/approvals`, `/dashboard/usage`.
**Why it happens:** Requirements are stated as "page displaying X" which sounds like new work.
**How to avoid:** The planner should audit what already exists. For Phase 16, the actual gaps are DASH-04 (project switcher), the full-page notification center (DASH-05), and budget threshold + project registration in settings (DASH-06).
**Warning signs:** If a plan creates `journal.tsx` or `approvals.tsx` as new files, something is wrong.

### Pitfall 2: Budget threshold persistence
**What goes wrong:** Building a budget settings form that only updates env vars which don't persist across server restarts.
**Why it happens:** `DAILY_BUDGET_USD` and `WEEKLY_BUDGET_USD` are currently read via `optionalEnv()` — env-only, not DB-backed.
**How to avoid:** Either (a) add a `settings` DB table to persist these values and have the `budget` route read from DB first, or (b) accept the limitation and make the UI clearly say "these values are applied from env vars" with a note about `.env` file. Option (a) is better for DASH-06's "settings changes take effect immediately" success criterion. This likely requires a new minimal route `PUT /api/settings/budget`.
**Warning signs:** If the plan has a form that writes budget values but no backend endpoint to store them.

### Pitfall 3: Project switcher state management
**What goes wrong:** Storing active project ID in component state — it gets lost on navigation.
**Why it happens:** React Router doesn't preserve non-URL state between route transitions.
**How to avoid:** Persist active project ID in `localStorage` with a key like `ai-cofounder-active-project-id`. Use a React context (similar to how `conversation-id` is stored in localStorage). The `ProjectSwitcher` component writes to localStorage; other components that need project context read from it.
**Warning signs:** If active project resets every time the user navigates to a different page.

### Pitfall 4: Notification center data aggregation
**What goes wrong:** Fetching too many sources independently in the notification center, causing waterfall loads or showing stale data.
**Why it happens:** Notifications come from multiple sources: pending approvals, monitoring alerts, budget breaches, journal events.
**How to avoid:** Reuse existing queries (`usePendingApprovals`, `useMonitoringStatus`, `useBudgetStatus`) — TanStack Query caches deduplicates. The `NotificationBell` already shows approvals + failed tasks. Extend with monitoring alerts from `useMonitoringStatus().data.alerts`. Don't add a new `/api/notifications` endpoint — aggregate on the client from existing cached queries.
**Warning signs:** If the plan proposes a new backend aggregation endpoint just for notifications.

### Pitfall 5: Missing queryKeys entries
**What goes wrong:** New `useQuery` calls without a corresponding `queryKeys` entry break cache invalidation — WS `invalidate` messages can't find the right key.
**Why it happens:** Developers write `queryKey: ["projects"]` inline instead of using `queryKeys.projects.list`.
**How to avoid:** Always add new entries to `src/lib/query-keys.ts` first. Reference `queryKeys.*` everywhere.
**Warning signs:** Hardcoded string arrays in `queryKey` properties.

### Pitfall 6: ApiClient methods missing for projects
**What goes wrong:** Dashboard code calls `apiClient.listProjects()` but the method doesn't exist in `packages/api-client/src/client.ts`.
**Why it happens:** The backend `/api/projects` routes exist (from Phase 14) but were never wired into ApiClient dashboard-facing methods.
**How to avoid:** Check `client.ts` first. The client already has lines 1030-1054 for project CRUD. The types `RegisteredProject`, `CreateProjectInput`, `UpdateProjectInput`, `CreateProjectDependencyInput`, `ProjectDependency` are already in `types.ts`. ApiClient methods `listProjects()`, `createProject()`, `getProject()`, `updateProject()`, `deleteProject()` at lines 1030-1054 already exist.
**Warning signs:** Confusion about whether ApiClient needs new methods — it does NOT for projects.

---

## Code Examples

Verified patterns from the existing codebase:

### Project Switcher (new component)
```typescript
// apps/dashboard/src/components/layout/project-switcher.tsx
import { useProjects } from "@/api/queries";
import { useActiveProject, useSetActiveProject } from "@/hooks/use-active-project";
import { Select } from "@/components/ui/select";
import { FolderOpen } from "lucide-react";

export function ProjectSwitcher() {
  const { data: projects } = useProjects();
  const activeProjectId = useActiveProject();
  const setActiveProject = useSetActiveProject();

  if (!projects || projects.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b">
      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <Select
        value={activeProjectId ?? ""}
        onChange={(e) => setActiveProject(e.target.value || null)}
        className="text-xs h-7 w-full"
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </Select>
    </div>
  );
}
```

### Active Project Hook (new hook)
```typescript
// apps/dashboard/src/hooks/use-active-project.ts
const STORAGE_KEY = "ai-cofounder-active-project-id";

export function useActiveProject(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function useSetActiveProject() {
  return (id: string | null) => {
    if (id) {
      localStorage.setItem(STORAGE_KEY, id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    // Trigger re-render by dispatching a storage event
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
  };
}
```

### New query hook for projects
```typescript
// Source: apps/dashboard/src/api/queries.ts (add)
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects.list,
    queryFn: () => apiClient.listProjects(),
    staleTime: 60_000,
  });
}
```

### Notification center page structure
```typescript
// apps/dashboard/src/routes/notifications.tsx
export function NotificationsPage() {
  usePageTitle("Notifications");
  const { data: approvals } = usePendingApprovals();
  const { data: monitoring } = useMonitoringStatus();
  const { data: budget } = useBudgetStatus();

  // Aggregate into unified list — no new API endpoint needed
  const notifications: NotificationItem[] = [
    ...(approvals?.map(toApprovalNotification) ?? []),
    ...(monitoring?.alerts?.map(toAlertNotification) ?? []),
    ...(budgetBreaches(budget) ?? []),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  // ...
}
```

### Budget settings form (new section in SettingsPage)
**Note:** Requires a new backend endpoint `PUT /api/settings/budget` that persists to a `settings` table (or updates env-backed config in DB). This is the main backend work in Phase 16.

```typescript
// Mutation for budget threshold updates
export function useUpdateBudgetThresholds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { dailyUsd: number; weeklyUsd: number }) =>
      apiClient.updateBudgetThresholds(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.usage.budget });
      toast.success("Budget thresholds updated");
    },
    onError: (err) => {
      toast.error(`Failed to update budget: ${err.message}`);
    },
  });
}
```

---

## What Already Exists (Confirmed by Code Review)

| DASH Req | Already Exists? | Route | Notes |
|----------|----------------|-------|-------|
| DASH-01 Work Journal | YES — `JournalPage` | `/dashboard/journal` | Timeline, search, type filter. Registered in sidebar and routes/index.tsx. |
| DASH-02 Approval Queue | YES — `ApprovalsPage` | `/dashboard/approvals` | Full approve/deny dialog, real-time via WS "approvals" channel. |
| DASH-03 Cost Dashboard | YES — `UsagePage` | `/dashboard/usage` | LineChart daily trend, PieChart distribution, budget gauges, optimization suggestions. |
| DASH-04 Project Switcher | NO | — | Backend exists. Needs: `ProjectSwitcher` component, `useActiveProject` hook, sidebar integration. |
| DASH-05 Notification Center | PARTIAL — `NotificationBell` | Sidebar only | Full-page `/dashboard/notifications` missing. Bell only shows approvals + failed tasks. Needs CI events, budget alerts. |
| DASH-06 Settings Extensions | PARTIAL — `SettingsPage` | `/dashboard/settings` | Autonomy tiers done. Budget threshold inputs and project registration missing. Needs backend persistence endpoint. |

---

## Backend Work Required

Phase 16 is predominantly frontend, but has one backend gap:

**Budget threshold persistence** (for DASH-06 "settings changes take effect immediately"):
- Current: `DAILY_BUDGET_USD` and `WEEKLY_BUDGET_USD` are read from env at runtime via `optionalEnv()`.
- Needed: A lightweight `settings` table or key-value store so the dashboard can write budget values that persist across restarts.
- Approach: Add `appSettings` table (key varchar, value text), `getAppSetting(key)`, `upsertAppSetting(key, value)` DB functions, `PUT /api/settings` route, and modify `usageRoutes` `/budget` to read from DB first, env as fallback.
- Alternatively: Store budget thresholds in the existing `registeredProjects` config field or a new `systemConfig` table. Simple key-value approach is cleanest.

**Project registration from dashboard** (for DASH-06 — project registrations):
- Backend already has full CRUD at `/api/projects`. ApiClient already has `listProjects()`, `createProject()`, etc.
- Only frontend work needed: add a project registration form in SettingsPage using `useCreateProject` mutation.

---

## State of the Art

| Area | Current Approach | Notes |
|------|-----------------|-------|
| Real-time dashboard updates | WebSocket `invalidate` messages → TanStack Query invalidation | Wired via `useRealtimeSync` hook and `RealtimeProvider`. WS channels: tasks, approvals, monitoring, queue, health, tools, pipelines, briefing, goals, deploys, patterns, context, journal. |
| Charts | Recharts with CSS variable theming | `var(--color-card)`, `var(--color-border)` in Tooltip contentStyle |
| Active project state | Not yet implemented | `conversation-id` uses `localStorage.getItem("ai-cofounder-conversation-id")` as precedent |
| Settings persistence | Env vars only (DAILY_BUDGET_USD etc.) | Needs DB-backed persistence for Phase 16 success criterion |

---

## Open Questions

1. **Budget threshold persistence strategy**
   - What we know: `optionalEnv("DAILY_BUDGET_USD", "0")` is the current approach. DB has no settings table.
   - What's unclear: Should a new `appSettings` table be added, or should budget values be stored in an existing table (e.g., per-project config)?
   - Recommendation: Add a lightweight `appSettings` (key/value) table in Drizzle. Two rows: `daily_budget_usd` and `weekly_budget_usd`. The planner should include a DB migration task.

2. **Project switcher scope**
   - What we know: The project switcher changes "active workspace context." PROJ-01 says agent can switch between repos.
   - What's unclear: Does the project switcher change which workspace path the orchestrator uses, or just filter dashboard data?
   - Recommendation: For Phase 16, implement as a dashboard-level filter (affects what data is shown) stored in localStorage. Full orchestrator switching is a deeper integration that would require server-side session context — out of scope.

3. **Notification center data sources**
   - What we know: Approvals and monitoring status are queryable. Budget alerts fire via Slack/Discord but aren't stored in DB.
   - What's unclear: Should budget alert history be DB-persisted for display in notification center?
   - Recommendation: For Phase 16, derive budget notification state from live `useBudgetStatus()` (show a warning if `percentUsed > 90`) rather than persisting alert history. This avoids a new DB table.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts`) + `@testing-library/react` for dashboard |
| Config file | `vitest.config.ts` at repo root (no dashboard-specific config — uses root config with `include: ["**/src/**/*.test.ts"]`) |
| Dashboard test pattern | `apps/dashboard/src/__tests__/routes/*.test.tsx` and `components/*.test.tsx` |
| Quick run command | `npm run test -w @ai-cofounder/dashboard` |
| Full suite command | `npm run test` |

**Note:** Dashboard tests use `.test.tsx` extension (not `.test.ts`) and are in `src/__tests__/`. The root vitest config only includes `*.test.ts` — dashboard may have its own config or the glob covers tsx too. Verify before Wave 0.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DASH-01 | JournalPage renders timeline, search, type filter | unit | `npm test -w @ai-cofounder/dashboard` | ❌ Wave 0 — `src/__tests__/routes/journal.test.tsx` |
| DASH-02 | ApprovalsPage renders pending approvals, approve/deny buttons work | unit | `npm test -w @ai-cofounder/dashboard` | ❌ Wave 0 — `src/__tests__/routes/approvals.test.tsx` |
| DASH-03 | UsagePage renders cost charts and budget gauges | unit | `npm test -w @ai-cofounder/dashboard` | ❌ Wave 0 — `src/__tests__/routes/usage.test.tsx` |
| DASH-04 | ProjectSwitcher renders projects, selection persists to localStorage | unit | `npm test -w @ai-cofounder/dashboard` | ❌ Wave 0 — `src/__tests__/components/project-switcher.test.tsx` |
| DASH-05 | NotificationsPage aggregates approvals + monitoring + budget | unit | `npm test -w @ai-cofounder/dashboard` | ❌ Wave 0 — `src/__tests__/routes/notifications.test.tsx` |
| DASH-06 | SettingsPage renders budget inputs; save updates budget status query | unit | `npm test -w @ai-cofounder/dashboard` | ❌ Wave 0 — existing `settings.test.tsx` (may not exist) |

### Sampling Rate
- **Per task commit:** `npm run test -w @ai-cofounder/dashboard`
- **Per wave merge:** `npm run test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `apps/dashboard/src/__tests__/routes/journal.test.tsx` — covers DASH-01
- [ ] `apps/dashboard/src/__tests__/routes/approvals.test.tsx` — covers DASH-02
- [ ] `apps/dashboard/src/__tests__/routes/usage.test.tsx` — covers DASH-03
- [ ] `apps/dashboard/src/__tests__/components/project-switcher.test.tsx` — covers DASH-04
- [ ] `apps/dashboard/src/__tests__/routes/notifications.test.tsx` — covers DASH-05
- [ ] `apps/dashboard/src/__tests__/routes/settings-extended.test.tsx` — covers DASH-06 new sections
- [ ] Confirm root vitest.config.ts includes `.test.tsx` — may need update to `include: ["**/src/**/*.test.{ts,tsx}"]`

---

## Sources

### Primary (HIGH confidence)
- Direct codebase reading — `apps/dashboard/src/routes/*.tsx`, `api/queries.ts`, `api/mutations.ts`, `lib/query-keys.ts`, `components/layout/sidebar.tsx`, `components/common/notification-bell.tsx`
- `apps/agent-server/src/routes/projects.ts`, `approvals.ts`, `usage.ts`, `journal.ts`, `autonomy.ts`, `monitoring.ts`, `dashboard.ts` — verified all API endpoints
- `packages/api-client/src/client.ts` lines 1030-1054 — confirmed project CRUD methods exist
- `packages/shared/src/ws-types.ts` — confirmed WS channels and query key mappings
- `apps/dashboard/src/routes/index.tsx` — confirmed route registrations

### Secondary (MEDIUM confidence)
- Planning STATE.md and ROADMAP.md — phase context and dependency chain
- REQUIREMENTS.md — full requirement text for each DASH-* ID

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified by direct code reading of imports and package.json
- Architecture patterns: HIGH — extracted from 10+ existing route files and component files
- What already exists: HIGH — confirmed by reading actual source files, not assumptions
- Pitfalls: HIGH — derived from actual code patterns and explicit MEMORY.md warnings
- Backend gap (budget persistence): MEDIUM — confirmed optionalEnv pattern, DB schema requires investigation to confirm no settings table exists yet

**Research date:** 2026-03-15
**Valid until:** 2026-04-15 (stable tech stack, no fast-moving dependencies)
