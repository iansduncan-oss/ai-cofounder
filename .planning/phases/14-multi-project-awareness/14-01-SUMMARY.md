---
phase: 14-multi-project-awareness
plan: 01
subsystem: db, agent-server
tags: [drizzle-orm, postgresql, fastify, project-registry, workspace, vitest]

# Dependency graph
requires: []

provides:
  - registeredProjects and projectDependencies DB tables with 9 repository CRUD functions
  - Migration 0025_add_projects.sql creating both tables with indexes
  - ProjectRegistryService managing per-project WorkspaceService instances with path validation
  - Fastify plugin decorating app.projectRegistry and loading from DB on startup
  - 10 passing unit tests covering all service behaviors

affects:
  - Phase 14 Plan 02 (project management REST routes build on these tables and service)
  - All orchestrator tools that use project-scoped WorkspaceService instances

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ProjectRegistryService uses Map<id, WorkspaceService> + Map<id, RegisteredProject> for O(1) per-project lookup"
    - "path.resolve() normalization for path traversal prevention in validateProjectPath"
    - "Per-project error isolation in loadFromDb: one bad path logs warning and continues, never blocks rest"
    - "PROJECTS_BASE_DIR env supports comma-separated list of allowed base directories"
    - "vitest 4.x: use importOriginal pattern for node built-in module mocks (node:fs/promises)"
    - "Static top-level import after vi.mock() declarations (not dynamic beforeEach import) for stable mock references"

key-files:
  created:
    - packages/db/drizzle/0025_add_projects.sql
    - apps/agent-server/src/services/project-registry.ts
    - apps/agent-server/src/plugins/project-registry.ts
    - apps/agent-server/src/__tests__/project-registry.test.ts
  modified:
    - packages/db/src/schema.ts
    - packages/db/src/repositories.ts
    - packages/test-utils/src/mocks/db.ts

key-decisions:
  - "Static top-level module import after vi.mock declarations — avoids dynamic import in beforeEach which caused mock reference instability with vitest module caching"
  - "importOriginal pattern for node:fs/promises mock — vitest 4.x requires default export to be present in mocked node built-ins"
  - "PROJECTS_BASE_DIR defaults to WORKSPACE_DIR env for backward compatibility with existing single-project deployments"

requirements-completed: [PROJ-01, PROJ-04]

# Metrics
duration: 4min
completed: 2026-03-15
---

# Phase 14 Plan 1: Multi-Project Awareness Data Layer Summary

**DB schema + migration for registered_projects/project_dependencies tables, 9 repository functions, ProjectRegistryService with per-project WorkspaceService isolation, Fastify plugin, and 10 passing tests**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-15T16:53:14Z
- **Completed:** 2026-03-15T16:57:04Z
- **Tasks:** 2/2
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- Added `registeredProjects` table (14 columns: id, name, slug, repoUrl, workspacePath, description, language, defaultBranch, testCommand, isActive, config, lastIngestedAt, createdAt, updatedAt)
- Added `projectDependencies` table (6 columns: id, sourceProjectId, targetProjectId, dependencyType, description, createdAt) with cascade delete on both FK columns
- Added `projectLanguageEnum` (typescript, python, javascript, go, other)
- Created migration `0025_add_projects.sql` with DO-block enum creation, CREATE TABLE IF NOT EXISTS, and 5 indexes
- Added 9 repository functions following existing Drizzle ORM patterns: createRegisteredProject, listRegisteredProjects (active only, ordered by name), getRegisteredProjectByName, getRegisteredProjectById, updateRegisteredProject (auto-sets updatedAt), deleteRegisteredProject (soft delete), createProjectDependency, listProjectDependencies (both source and target), deleteProjectDependency (hard delete with returning)
- Updated `mockDbModule()` in test-utils with all 9 new functions + 2 table refs preventing downstream test breakage
- Created `ProjectRegistryService` with `Map<id, WorkspaceService>` + `Map<id, RegisteredProject>` backing, path validation via `path.resolve()`, `loadFromDb()` with per-project error isolation
- Created Fastify plugin that decorates `app.projectRegistry` and calls `loadFromDb` if `app.db` exists
- 10 unit tests: validateProjectPath (3), registerProject (2), getWorkspace (2), listProjects (1), loadFromDb (2) — all pass

## Task Commits

Each task was committed atomically:

1. **Task 1: DB schema, migration, and repository functions** - `f9cc568` (feat)
2. **Task 2: ProjectRegistryService and Fastify plugin** - `cea7353` (feat)

## Files Created/Modified

- `packages/db/src/schema.ts` — Added projectLanguageEnum, registeredProjects table, projectDependencies table
- `packages/db/src/repositories.ts` — Added 9 repository functions + table imports
- `packages/db/drizzle/0025_add_projects.sql` — Migration with CREATE TYPE, CREATE TABLE IF NOT EXISTS, 5 indexes
- `packages/test-utils/src/mocks/db.ts` — Added 9 mock functions + 2 table refs to mockDbModule()
- `apps/agent-server/src/services/project-registry.ts` — ProjectRegistryService class (path validation, per-project workspace, DB loading)
- `apps/agent-server/src/plugins/project-registry.ts` — Fastify plugin decorating app.projectRegistry
- `apps/agent-server/src/__tests__/project-registry.test.ts` — 10 unit tests

## Decisions Made

- Static top-level module import after `vi.mock()` declarations instead of dynamic `await import()` in `beforeEach` — dynamic imports had unstable mock reference behavior when vitest caches modules between test runs
- `importOriginal` pattern for `node:fs/promises` mock — vitest 4.x requires the module's default export to be present; partial override via spread of actual module prevents the "No default export" error
- `PROJECTS_BASE_DIR` falls back to `WORKSPACE_DIR` which falls back to `/tmp/ai-cofounder-workspace` — preserves backward compatibility with existing single-project deployments without any config changes

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

All 8 files found. Both task commits (f9cc568, cea7353) confirmed present. All 10 tests pass.
