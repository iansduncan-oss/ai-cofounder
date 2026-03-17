# Phase 21 — Operational Hardening: Summary

## Overview

Phase 21 hardened test infrastructure and fixed server resource leaks. Migrated to per-workspace vitest configs for test isolation and fixed a Fastify server leak in context-routes tests.

## What Was Built

### Per-Workspace Vitest Configs (`59c461a`)

**Problem:** Shared module caches and env state leaked between test files across workspaces, causing intermittent failures.

**Solution:** Each workspace now has its own `vitest.config.ts` using `defineProject`. Root config lists workspace directories as `projects`.

- Dashboard tests run in `jsdom` environment
- Package tests run in `node` environment
- Agent-server tests get their own isolated config with `testTimeout: 15000`
- 13 named vitest projects total

### Context-Routes Server Leak Fix (`39b6dce`)

**Problem:** `context-routes.test.ts` called `buildServer()` but didn't call `await app.close()` in `afterAll`, causing Fastify servers to leak between test files.

**Solution:** Added proper cleanup. Established as a critical pattern:
> Tests that call `buildServer()` MUST call `await app.close()` in `afterAll`

### Agent-Server Test Setup (`7fe91a5`)

- `apps/agent-server/src/__tests__/setup.ts` auto-snapshots/restores `process.env` and `globalThis.fetch`
- Clears all mocks in `afterEach`
- Prevents env variable pollution between test files

## Files Added/Modified

| File | Change |
|------|--------|
| `vitest.config.ts` (root) | Lists 13 workspace directories as projects |
| `apps/agent-server/vitest.config.ts` | Per-workspace config with timeouts |
| `apps/dashboard/vitest.config.ts` | Per-workspace config with jsdom |
| `packages/*/vitest.config.ts` | Per-workspace configs for all packages |
| `apps/agent-server/src/__tests__/setup.ts` | Env snapshot/restore, mock cleanup |
| `apps/agent-server/src/__tests__/context-routes.test.ts` | Fixed server leak |

## Test Coverage

- All ~1772 tests pass across 150 files in 13 workspaces
- No cross-workspace test pollution
- `hookTimeout: 15000` prevents flaky timeouts under parallel load

## Requirements Fulfilled

| ID | Requirement | Status |
|----|-------------|--------|
| OPS-01 | Pagination on journal/notification/agent message endpoints | Done (from prior work) |
| OPS-02 | Queue health dashboard (DLQ, completion rate, stale jobs) | Partial — DLQ metrics exist, stale job detection planned |
| OPS-03 | Autonomous budget hard-abort with real token counts | Done (from Phase 11) |
| OPS-04 | Error reporting aggregated by type + frequency | Planned |
