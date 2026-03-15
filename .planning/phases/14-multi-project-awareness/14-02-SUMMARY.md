---
phase: 14-multi-project-awareness
plan: 02
subsystem: agent-server, api-client, db
tags: [fastify, drizzle-orm, orchestrator, rag, tool-executor, monitoring, vitest]

# Dependency graph
requires:
  - phase: 14-multi-project-awareness-plan-01
    provides: registeredProjects/projectDependencies DB tables, ProjectRegistryService, Fastify plugin

provides:
  - 5 orchestrator tools (register_project, switch_project, list_projects, analyze_cross_project_impact, query_vps)
  - Per-conversation active project stored in conversations.metadata.activeProjectId
  - RAG retrieval scoped to active project's slug via sourceId filter
  - VPS monitoring extended with per-container CPU%, memory usage, memory% from docker stats
  - 7 REST endpoints for project CRUD + dependency management
  - ApiClient typed methods for all project endpoints
  - 17 passing tests (8 tool tests + 9 route tests)

affects:
  - All orchestrator integrations that depend on tool-executor (SubagentRunner uses buildSharedToolList)
  - Dashboard project management UI (can now call /api/projects CRUD)
  - MCP server (12 tools wrapping ApiClient — can add project tools)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Active project resolved from conversation.metadata.activeProjectId at start of run() and runStream()"
    - "RAG sourceId scoping: activeProjectSlug passed to retrieve() to filter chunks to one project"
    - "Tool executor services pattern extended — new optional services injected without breaking existing tools"
    - "Orchestrator constructor positional optional params pattern maintained for backward compatibility"
    - "Route tests use dynamic import for buildServer() after vi.mock declarations"
    - "projectRegistryPlugin registered before jwtGuardPlugin so app.projectRegistry is available in all routes"

key-files:
  created:
    - apps/agent-server/src/agents/tools/project-tools.ts
    - apps/agent-server/src/agents/tools/vps-tools.ts
    - apps/agent-server/src/routes/projects.ts
    - packages/db/drizzle/0026_add_conversation_metadata.sql
    - apps/agent-server/src/__tests__/project-tools.test.ts
    - apps/agent-server/src/__tests__/project-routes.test.ts
  modified:
    - apps/agent-server/src/agents/tool-executor.ts
    - apps/agent-server/src/agents/orchestrator.ts
    - apps/agent-server/src/services/monitoring.ts
    - apps/agent-server/src/plugins/jwt-guard.ts
    - apps/agent-server/src/routes/agents.ts
    - apps/agent-server/src/server.ts
    - packages/db/src/schema.ts
    - packages/db/src/repositories.ts
    - packages/test-utils/src/mocks/db.ts
    - packages/api-client/src/client.ts
    - packages/api-client/src/types.ts
    - packages/api-client/src/index.ts

key-decisions:
  - "monitoringService added to Orchestrator constructor as param 11 (after projectRegistryService) — positional param pattern maintained for backward compat"
  - "projectRegistryPlugin registered in server.ts BEFORE jwtGuardPlugin to ensure app.projectRegistry is available when routes initialize"
  - "Route file uses full paths (/api/projects) rather than prefix injection pattern — registered via app.register(projectRoutes) without prefix"
  - "analyze_cross_project_impact is data-retrieval only (no nested LLM call) — returns structured JSON for the orchestrator LLM to reason over"
  - "docker stats timeout increased from 15s to 30s in SSH call — docker stats --no-stream can take a few seconds on busy hosts"

requirements-completed: [PROJ-02, PROJ-03]

# Metrics
duration: 14min
completed: 2026-03-15
---

# Phase 14 Plan 2: Multi-Project Awareness Agent Integration Summary

**5 orchestrator tools (register_project, switch_project, list_projects, analyze_cross_project_impact, query_vps) with RAG scoping by active project, per-container VPS stats, and full project CRUD REST API**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-03-15T17:01:07Z
- **Completed:** 2026-03-15T17:15:15Z
- **Tasks:** 2/2
- **Files modified:** 12 (6 created, 6 modified)

## Accomplishments

- Added 4 project management tools + 1 VPS tool to the orchestrator via tool-executor
- Extended Orchestrator constructor with `projectRegistryService` and `monitoringService` params; passes to buildSharedToolList and executeWithTierCheck
- Active project resolved from `conversation.metadata.activeProjectId` at start of both `run()` and `runStream()`
- RAG retrieval scoped to active project's slug as `sourceId` filter in `retrieve()` call
- Added `metadata` jsonb column to `conversations` table + migration 0026
- Extended `ContainerStatus` interface with optional `cpuPercent`, `memUsage`, `memPercent` fields
- Extended `checkVPSHealth()` to run `docker stats --no-stream` and merge per-container resource usage into the containers array
- Created 7 REST endpoints at `/api/projects` (list, create, get, update, delete, create-dep, list-deps)
- Registered `projectRegistryPlugin` in server.ts; passed projectRegistry to Orchestrator in agents.ts route
- Added 7 ApiClient methods with typed interfaces in api-client types.ts + client.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Orchestrator tools, tool executor wiring, and RAG scoping** - `2fd886d` (feat)
2. **Task 2: VPS monitoring extension and REST API routes** - `27e17c1` (feat)

## Files Created/Modified

- `apps/agent-server/src/agents/tools/project-tools.ts` — 4 tool definitions (REGISTER_PROJECT, SWITCH_PROJECT, LIST_PROJECTS, ANALYZE_CROSS_PROJECT_IMPACT)
- `apps/agent-server/src/agents/tools/vps-tools.ts` — QUERY_VPS tool definition
- `apps/agent-server/src/agents/tool-executor.ts` — Added projectRegistryService/monitoringService to ToolExecutorServices; wired all 5 tool cases
- `apps/agent-server/src/agents/orchestrator.ts` — Added projectRegistryService/monitoringService params; active project resolution; scoped RAG retrieval
- `apps/agent-server/src/services/monitoring.ts` — ContainerStatus extended; docker stats SSH command added; stats merged into containers
- `apps/agent-server/src/routes/projects.ts` — 7 REST endpoints for project CRUD and dependencies
- `apps/agent-server/src/plugins/jwt-guard.ts` — Registered projectRoutes
- `apps/agent-server/src/routes/agents.ts` — Pass projectRegistry + monitoringService to Orchestrator
- `apps/agent-server/src/server.ts` — Register projectRegistryPlugin
- `packages/db/src/schema.ts` — Added metadata jsonb column to conversations table
- `packages/db/src/repositories.ts` — Added updateConversationMetadata()
- `packages/db/drizzle/0026_add_conversation_metadata.sql` — Migration: ALTER TABLE conversations ADD COLUMN metadata jsonb
- `packages/test-utils/src/mocks/db.ts` — Added updateConversationMetadata mock
- `packages/api-client/src/types.ts` — RegisteredProject, ProjectDependency, CreateProjectInput, UpdateProjectInput, CreateProjectDependencyInput types
- `packages/api-client/src/client.ts` — 7 project CRUD methods
- `packages/api-client/src/index.ts` — Exported new project types
- `apps/agent-server/src/__tests__/project-tools.test.ts` — 8 tool tests
- `apps/agent-server/src/__tests__/project-routes.test.ts` — 9 route tests

## Decisions Made

- `monitoringService` added to Orchestrator constructor as 11th positional param (after projectRegistryService) — maintains the positional pattern established by all previous services
- `projectRegistryPlugin` must be registered before `jwtGuardPlugin` in server.ts so `app.projectRegistry` is available when route handlers initialize their orchestrators
- `analyze_cross_project_impact` returns structured JSON for LLM reasoning rather than performing nested LLM analysis — avoids token cost and latency, LLM does the impact reasoning itself
- Docker stats SSH timeout increased to 30s (from 15s) — `docker stats --no-stream` can take a few extra seconds on hosts with many containers

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All 6 created files confirmed present. Both commits (2fd886d, 27e17c1) confirmed present. 27 tests pass (8 tool + 9 route + 10 registry).
