---
phase: 04-tests-quick-wins
plan: "02"
subsystem: agent-server/tests
tags: [tests, workspace-service, routes, swagger, quick-wins]
dependency_graph:
  requires: []
  provides:
    - deleteFile and deleteDirectory test coverage in workspace-service.test.ts
    - Route tests for GET /api/agents/roles (QWIN-03)
    - Route tests for GET /api/conversations/:id/export (QWIN-04)
    - Route tests for GET /docs/json (QWIN-05)
    - Route tests for GET /docs (QWIN-06)
  affects:
    - apps/agent-server/src/__tests__/workspace-service.test.ts
    - apps/agent-server/src/__tests__/quick-win-routes.test.ts
tech_stack:
  added: []
  patterns:
    - vitest route test pattern with full DB/LLM/queue mocks
    - requireEnv export required in @ai-cofounder/shared mock (for db.ts plugin)
key_files:
  created:
    - apps/agent-server/src/__tests__/quick-win-routes.test.ts
  modified:
    - apps/agent-server/src/__tests__/workspace-service.test.ts
decisions:
  - requireEnv must be added to the @ai-cofounder/shared mock alongside optionalEnv — db.ts plugin calls requireEnv("DATABASE_URL") which is not covered by optionalEnv
metrics:
  duration: "7 minutes"
  completed: "2026-03-09"
  tasks_completed: 2
  files_modified: 2
---

# Phase 04 Plan 02: Quick Win Tests Summary

**One-liner:** 7 new test cases proving deleteFile/deleteDirectory, GET /api/agents/roles, GET conversations export, and Swagger endpoints work correctly.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Add deleteFile and deleteDirectory tests | bf33d8b | workspace-service.test.ts |
| 2 | Create quick-win-routes.test.ts for roles, export, swagger | 5dfc0a9 | quick-win-routes.test.ts (new) |

## What Was Built

### Task 1: deleteFile and deleteDirectory tests (workspace-service.test.ts)

Added 7 new tests in two `describe` blocks inserted after the existing `listDirectory` block:

**`describe("deleteFile")`** — 3 tests:
- Deletes a file within the workspace (write then delete, read throws)
- Rejects path traversal `../../etc/passwd` with "Path traversal denied"
- Throws ENOENT when deleting a non-existent file

**`describe("deleteDirectory")`** — 4 tests:
- Deletes an empty directory (mkdir, delete, listDirectory throws)
- Fails to delete non-empty directory without force (ENOTEMPTY)
- Deletes non-empty directory with `force=true` (recursive)
- Rejects path traversal `../../tmp` with "Path traversal denied"

All 47 workspace-service tests pass.

### Task 2: quick-win-routes.test.ts (new file, 5 tests)

Created `apps/agent-server/src/__tests__/quick-win-routes.test.ts` using the established route test pattern:

**`describe("GET /api/agents/roles -- QWIN-03")`** — 1 test:
- Returns array of role objects with `role` and `description` properties
- Confirms `orchestrator` and `researcher` roles exist
- Confirms at least 5 roles in the array

**`describe("GET /api/conversations/:id/export -- QWIN-04")`** — 2 tests:
- Returns 200 with `Content-Disposition: attachment` header, `application/json` content-type, and `{ conversation, messages, exportedAt }` body
- Returns 404 when conversation not found

**`describe("Swagger UI and OpenAPI spec -- QWIN-05, QWIN-06")`** — 2 tests:
- `GET /docs/json` returns 200 with valid OpenAPI spec (`info.title`, `paths` defined)
- `GET /docs` returns 200 or redirect (Swagger UI served correctly)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added `requireEnv` to `@ai-cofounder/shared` mock**

- **Found during:** Task 2 initial test run
- **Issue:** `db.ts` plugin imports `requireEnv` from `@ai-cofounder/shared` and calls `requireEnv("DATABASE_URL")`. The plan's mock template only included `optionalEnv`, so Vitest threw: `No "requireEnv" export is defined on the "@ai-cofounder/shared" mock.`
- **Fix:** Added `requireEnv: (_name: string) => "postgres://test:test@localhost:5432/test"` to the `vi.mock("@ai-cofounder/shared")` factory in `quick-win-routes.test.ts`
- **Files modified:** `apps/agent-server/src/__tests__/quick-win-routes.test.ts`
- **Commit:** 5dfc0a9

## Verification Results

```
Test Files  2 passed (2)
      Tests  52 passed (52)
```

- `workspace-service.test.ts`: 47 tests pass (40 pre-existing + 7 new)
- `quick-win-routes.test.ts`: 5 tests pass (all new)

Note: The full agent-server suite has pre-existing failures in unrelated test files (e2e tests requiring a real DB, observability tests, etc.). None of these failures are caused by this plan's changes.

## Self-Check: PASSED

- FOUND: apps/agent-server/src/__tests__/workspace-service.test.ts
- FOUND: apps/agent-server/src/__tests__/quick-win-routes.test.ts
- FOUND: .planning/phases/04-tests-quick-wins/04-02-SUMMARY.md
- FOUND commit bf33d8b (workspace-service deleteFile/deleteDirectory tests)
- FOUND commit 5dfc0a9 (quick-win-routes tests)
