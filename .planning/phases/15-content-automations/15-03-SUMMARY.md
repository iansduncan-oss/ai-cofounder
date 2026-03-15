---
phase: 15-content-automations
plan: 03
subsystem: api-client, dashboard
tags: [dashboard-ui, n8n, pipeline-templates, content-automations, api-client]
dependency_graph:
  requires: [15-01, 15-02]
  provides: [N8nWorkflowsPage, pipeline-template-trigger-ui, api-client-n8n-methods]
  affects: [packages/api-client, apps/dashboard]
tech_stack:
  added: []
  patterns: [TanStack-Query-useMutation, sonner-toast, lazy-route-import, lucide-react-Workflow]
key_files:
  created:
    - apps/dashboard/src/routes/n8n-workflows.tsx
  modified:
    - packages/api-client/src/client.ts
    - packages/api-client/src/index.ts
    - apps/dashboard/src/lib/query-keys.ts
    - apps/dashboard/src/routes/pipelines.tsx
    - apps/dashboard/src/routes/index.tsx
    - apps/dashboard/src/components/layout/sidebar.tsx
decisions:
  - PipelineTemplate, N8nExecution, TriggerTemplateResponse types defined in client.ts and re-exported from index.ts — consistent with existing ClientOptions pattern
  - Quick Launch section hidden when templates array is empty (no noise for users without templates)
  - triggerMutation isPending disables all Run buttons simultaneously — prevents double-triggering any template during inflight request
metrics:
  duration: 3.5 min
  completed: "2026-03-15"
  tasks: 2/2
  files: 6
---

# Phase 15 Plan 03: Content Automations Dashboard UI Summary

**One-liner:** ApiClient pipeline template and n8n execution methods, N8n Workflows dashboard page with execution history table, one-click template trigger on pipelines page.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | ApiClient methods + types + query keys | 1d7b31e | packages/api-client/src/client.ts, apps/dashboard/src/lib/query-keys.ts |
| 2 | N8n Workflows page + pipeline template trigger + route registration | dbe095a | n8n-workflows.tsx, pipelines.tsx, index.tsx, sidebar.tsx, api-client/index.ts |

## What Was Built

### ApiClient Methods (client.ts)
- `listPipelineTemplates()` — GET /api/pipeline-templates, returns PipelineTemplate[]
- `getPipelineTemplate(id)` — GET /api/pipeline-templates/:id, returns PipelineTemplate
- `triggerPipelineTemplate(name, opts?)` — POST /api/pipeline-templates/:name/trigger, returns TriggerTemplateResponse
- `listN8nExecutions(opts?)` — GET /api/n8n/executions with workflowId/status/limit query params, returns { data: N8nExecution[] }
- `listN8nWorkflows()` — GET /api/n8n/workflows, returns workflow array

### New Types (client.ts + index.ts)
- `PipelineTemplate` — id, name, description, stages, defaultContext, isActive, createdAt, updatedAt
- `N8nExecution` — id, workflowId, status (success/error/waiting/canceled), finished, mode, startedAt, stoppedAt
- `TriggerTemplateResponse` — jobId, template
- All three types exported from package index

### Query Keys (query-keys.ts)
- `queryKeys.n8n.workflows` — `["n8n", "workflows"]`
- `queryKeys.n8n.executions(opts?)` — `["n8n", "executions", opts ?? "all"]`
- `queryKeys.pipelineTemplates.all` — `["pipeline-templates"]`
- `queryKeys.pipelineTemplates.list` — `["pipeline-templates", "list"]`

### N8n Workflows Page (n8n-workflows.tsx)
- Registered at `/dashboard/n8n`
- Workflows section: card grid showing name, description, active badge, direction badge, webhook URL
- Execution history section: table with status badge (icon + color-coded), workflowId, mode, started (RelativeTime), duration (computed from startedAt/stoppedAt)
- Auto-refreshes executions every 30s
- Handles loading with ListSkeleton, empty states with EmptyState

### Pipeline Template Trigger (pipelines.tsx)
- Quick Launch section above pipeline runs list (hidden when no templates)
- Per-template cards with name, description, and Run button
- useMutation calls `apiClient.triggerPipelineTemplate(template.name)`
- On success: sonner toast "Pipeline queued", invalidates `queryKeys.pipelines.all`
- On error: sonner toast with error message
- isPending disables all Run buttons during mutation

### Route Registration (index.tsx)
- Lazy import of N8nWorkflowsPage
- Route at `{ path: "n8n", element: <N8nWorkflowsPage /> }` inside /dashboard children

### Sidebar (sidebar.tsx)
- Imported `Workflow` from lucide-react
- Nav entry `{ to: "/dashboard/n8n", icon: Workflow, label: "N8n Workflows" }` after Pipelines

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] New types not re-exported from api-client index.ts**
- **Found during:** Task 2 TypeScript compilation check (n8n-workflows.tsx imported N8nExecution from @ai-cofounder/api-client)
- **Issue:** PipelineTemplate, N8nExecution, TriggerTemplateResponse were defined in client.ts but not re-exported from the package's index.ts — TypeScript could not resolve them as package imports
- **Fix:** Added all three types to the `export { ... } from "./client.js"` statement in index.ts
- **Files modified:** packages/api-client/src/index.ts
- **Commit:** dbe095a

## Decisions Made

1. Types defined in `client.ts` and re-exported from `index.ts` via named export — consistent with how `ClientOptions` is already exported from the client module rather than types.ts
2. Quick Launch section conditionally rendered only when `templatesLoading || templates.length > 0` — avoids rendering an empty section when server has no templates configured
3. Single `triggerMutation.isPending` flag disables all template Run buttons simultaneously — safe default that prevents any double-trigger during network round-trip

## Self-Check: PASSED

- FOUND: apps/dashboard/src/routes/n8n-workflows.tsx
- FOUND: packages/api-client/src/client.ts (listN8nExecutions, triggerPipelineTemplate)
- FOUND: apps/dashboard/src/lib/query-keys.ts (n8n and pipelineTemplates sections)
- FOUND: apps/dashboard/src/routes/pipelines.tsx (Quick Launch section)
- FOUND: apps/dashboard/src/routes/index.tsx (n8n route)
- FOUND: apps/dashboard/src/components/layout/sidebar.tsx (N8n Workflows entry)
- FOUND: commit 1d7b31e (Task 1)
- FOUND: commit dbe095a (Task 2)
- TypeScript: 0 errors in new/modified files (pre-existing errors in analytics.tsx, dlq.tsx, journal.tsx, subagents.tsx are out of scope)
