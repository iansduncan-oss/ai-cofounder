---
phase: 15-content-automations
plan: 01
subsystem: db, agent-server
tags: [db-migration, schema, repository, n8n, content-automations]
dependency_graph:
  requires: []
  provides: [pipelineTemplates-schema, pipelineTemplates-repository, N8nService-listExecutions]
  affects: [packages/db, apps/agent-server]
tech_stack:
  added: []
  patterns: [drizzle-pgTable, repository-CRUD, N8nService-extension]
key_files:
  created:
    - packages/db/drizzle/0027_add_content_pipeline_and_templates.sql
  modified:
    - packages/db/src/schema.ts
    - packages/db/src/repositories.ts
    - apps/agent-server/src/services/n8n.ts
    - apps/agent-server/src/routes/projects.ts
decisions:
  - stages column typed as generic jsonb in schema — type assertion happens in repository layer
  - listExecutions returns empty array when N8N_API_KEY not configured — graceful no-op
  - listPipelineTemplates defaults activeOnly=true — matches n8nWorkflows list pattern
metrics:
  duration: 2.5 min
  completed: "2026-03-15"
  tasks: 2/2
  files: 5
---

# Phase 15 Plan 01: Content Automations Data Layer Summary

**One-liner:** DB migration + pipelineTemplates CRUD repository + N8nService extended with execution history fetching via n8n REST API.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | DB migration + schema for pipelineTemplates | 494e1ea | packages/db/drizzle/0027_add_content_pipeline_and_templates.sql, packages/db/src/schema.ts |
| 2 | Repository CRUD + N8nService listExecutions | 0ec4a1e | packages/db/src/repositories.ts, apps/agent-server/src/services/n8n.ts, apps/agent-server/src/routes/projects.ts |

## What Was Built

### DB Migration (0027)
- `ALTER TYPE journal_entry_type ADD VALUE IF NOT EXISTS 'content_pipeline'` — adds content_pipeline enum value for journal entries
- `CREATE TABLE IF NOT EXISTS pipeline_templates` — id, name (unique), description, stages (jsonb), default_context (jsonb), is_active, created_at, updated_at

### Schema (schema.ts)
- Added `"content_pipeline"` to `journalEntryTypeEnum`
- Added `pipelineTemplates` Drizzle table with all 8 columns

### Repository Functions (repositories.ts)
- `createPipelineTemplate(db, data)` — inserts and returns with `.returning()`
- `getPipelineTemplate(db, id)` — select by UUID
- `getPipelineTemplateByName(db, name)` — select by unique name
- `listPipelineTemplates(db, activeOnly?)` — list with optional active filter (default: true)
- `updatePipelineTemplate(db, id, data)` — partial update with `.returning()`
- `deletePipelineTemplate(db, id)` — hard delete returning boolean

### N8nService Extension (n8n.ts)
- Added `N8nExecution` interface with id, workflowId, status, finished, mode, startedAt, stoppedAt, retryOf, retrySuccessId
- Extended `N8nService` interface with `listExecutions(opts?)` method
- Implemented `listExecutions` reading N8N_BASE_URL + N8N_API_KEY from env, 10s abort timeout, returns `[]` on missing key or error

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing TS2345 in projects.ts GET route**
- **Found during:** Task 2 agent-server build verification
- **Issue:** `GET /api/projects` had `response: { 200: ... }` TypeScript schema, causing Fastify TypeScript to reject `reply.status(500).send()` calls with TS2345 (Argument of type '500' not assignable to '200')
- **Fix:** Removed the `response` constraint from the GET route, matching the pattern used by all other routes in the file (none declare response schemas)
- **Files modified:** apps/agent-server/src/routes/projects.ts
- **Commit:** 0ec4a1e

## Decisions Made

1. `stages` column typed as generic `jsonb` in Drizzle schema — the `PipelineStage[]` type assertion happens in repository/route layer, keeping schema layer clean
2. `listExecutions` returns `[]` when `N8N_API_KEY` not configured — graceful no-op matching existing n8n service pattern for optional integrations
3. `listPipelineTemplates` defaults `activeOnly=true` — consistent with `listN8nWorkflows` active-only default in the codebase

## Self-Check: PASSED

- FOUND: packages/db/drizzle/0027_add_content_pipeline_and_templates.sql
- FOUND: packages/db/src/schema.ts
- FOUND: packages/db/src/repositories.ts
- FOUND: apps/agent-server/src/services/n8n.ts
- FOUND: commit 494e1ea (Task 1)
- FOUND: commit 0ec4a1e (Task 2)
