# Phase 4: Tests & Quick Wins - Research

**Researched:** 2026-03-08
**Domain:** E2E integration testing (Vitest + Fastify inject), workspace tool safety, API utility features
**Confidence:** HIGH

## Summary

Phase 4 implements E2E integration tests and six quick-win features. The research reveals that most of the Quick Win work (QWIN-01 through QWIN-06) is already implemented in the codebase. The E2E testing work (TEST-01 through TEST-06) requires a specific test harness approach: using the real PostgreSQL test database that CI already provisions, with truncate-based cleanup between tests, rather than mocked DB calls.

The current E2E test file (`e2e-execution.test.ts`) mocks `@ai-cofounder/db` and only tests the HTTP-level enqueueing behavior. The requirement for TEST-03 is a true end-to-end test that exercises the full goal lifecycle through the `TaskDispatcher` and `Orchestrator` with MockLlmRegistry against a real database. This is the only new ground to break.

**Primary recommendation:** The planner should audit what's already done, skip re-implementing anything that exists, and focus the three planned plan files on: (1) E2E test infrastructure with real DB isolation, (2) E2E lifecycle test using MockLlmRegistry + real DB, and (3) verifying and testing the already-implemented quick wins.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TEST-01 | E2E test suite runs against a dedicated test database isolated from dev/prod | Real DB via `TEST_DATABASE_URL` env var, `createDb()` client already available |
| TEST-02 | E2E tests use Fastify `inject()` for HTTP-level testing without actual network | Already proven pattern — all 44+ route tests use `app.inject()` via `buildServer()` |
| TEST-03 | Full goal lifecycle: create → dispatch → orchestrator tool loop → completion | `TaskDispatcher.runGoal()` + `Orchestrator` + MockLlmRegistry — needs real DB writes |
| TEST-04 | LLM responses mocked using existing MockLlmRegistry for deterministic tests | `MockLlmRegistry` from `packages/test-utils` + `toolUseResponse()`/`textResponse()` helpers |
| TEST-05 | Test database cleaned between test runs (truncate or transaction rollback) | Drizzle `db.execute(sql`TRUNCATE TABLE ... CASCADE`)` — truncate is simpler than transactions |
| TEST-06 | E2E test suite runs in GitHub Actions CI pipeline alongside existing unit tests | CI already provisions postgres and runs `npm run test` — E2E test file just needs to be added |
| QWIN-01 | `deleteFile` workspace tool removes a file with path validation | Already implemented: `WorkspaceService.deleteFile()` + `DELETE_FILE_TOOL` + orchestrator case |
| QWIN-02 | `deleteDirectory` workspace tool removes directory with recursive option + safety | Already implemented: `WorkspaceService.deleteDirectory(force)` + `DELETE_DIRECTORY_TOOL` + orchestrator case |
| QWIN-03 | `GET /api/agents/roles` returns list of available agent roles with descriptions | Already implemented: `agentRoutes` exports `GET /roles` returning `AGENT_ROLES` constant |
| QWIN-04 | `GET /api/conversations/:id/export` returns full conversation as JSON | Already implemented: `conversationRoutes` exports `GET /:id/export` with Content-Disposition header |
| QWIN-05 | OpenAPI spec auto-generated from Fastify route schemas via `@fastify/swagger` | Already implemented: `server.ts` registers `fastifySwagger` with full OpenAPI config |
| QWIN-06 | Swagger UI serves interactive API docs at configurable endpoint | Already implemented: `fastifySwaggerUi` registered at `/docs` in `server.ts` |
</phase_requirements>

## What Is Already Implemented (Critical Audit)

This is the most important finding from research. The planner must NOT re-implement these:

### Quick Wins — All Already Done

| Feature | File(s) | Status |
|---------|---------|--------|
| `deleteFile` tool definition | `apps/agent-server/src/agents/tools/filesystem-tools.ts` | Done — `DELETE_FILE_TOOL` exported |
| `deleteFile` service method | `apps/agent-server/src/services/workspace.ts:76-79` | Done — calls `fs.unlink()` with `resolveSafe()` |
| `deleteFile` orchestrator case | `apps/agent-server/src/agents/orchestrator.ts:914-923` | Done — `case "delete_file"` wired |
| `deleteDirectory` tool definition | `apps/agent-server/src/agents/tools/filesystem-tools.ts` | Done — `DELETE_DIRECTORY_TOOL` exported |
| `deleteDirectory` service method | `apps/agent-server/src/services/workspace.ts:81-89` | Done — calls `fs.rm()` or `fs.rmdir()` |
| `deleteDirectory` orchestrator case | `apps/agent-server/src/agents/orchestrator.ts:925-934` | Done — `case "delete_directory"` wired |
| `GET /api/agents/roles` | `apps/agent-server/src/routes/agents.ts:54-57` | Done — returns `AGENT_ROLES` array |
| `GET /api/conversations/:id/export` | `apps/agent-server/src/routes/conversations.ts:74-97` | Done — JSON with Content-Disposition header |
| `@fastify/swagger` OpenAPI | `apps/agent-server/src/server.ts:90-123` | Done — full OpenAPI 3.0 config |
| `@fastify/swagger-ui` at `/docs` | `apps/agent-server/src/server.ts:125-127` | Done — registered at `/docs` |

### What Is NOT Done

| Gap | What's Needed |
|-----|--------------|
| TEST-01/05: E2E test infra | Helper that creates real DB connection via `TEST_DATABASE_URL`, truncates tables before/after each test |
| TEST-02: E2E Fastify harness | `buildServer(registry)` with real DB plugin wired to test DB — `dbPlugin` must connect to `TEST_DATABASE_URL` |
| TEST-03: Full lifecycle test | Test that calls `POST /api/goals`, then `TaskDispatcher.runGoal()` directly with `MockLlmRegistry`, verifying DB rows |
| TEST-04: Deterministic MockLlmRegistry | Scripted sequence: first call returns `tool_use` (create_plan), second returns text completion |
| TEST-06: CI runs E2E | Already works since CI runs `npm test` — just need new test files with correct structure |
| Tests for quick wins | `deleteFile`/`deleteDirectory` in workspace service tests, `GET /roles`, `GET /:id/export` in routes tests |

## Standard Stack

### Core (Confidence: HIGH — verified from codebase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Vitest | ^4.0.18 | Test runner | Already in use across all 45 test files |
| Fastify `app.inject()` | ^5.7.4 | HTTP test harness | Already proven — all route tests use this pattern |
| `@ai-cofounder/db` `createDb()` | local | Real DB connection for E2E | Already the DB client; supports real postgres.js connections |
| `packages/test-utils` MockLlmRegistry | local | Deterministic LLM in tests | `toolUseResponse()` and `textResponse()` helpers ready |
| `@sinclair/typebox` | ^0.34.48 | Request/response schema | Already used in all routes |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js `sql` template tag (Drizzle) | via drizzle-orm | Truncate tables | Use `db.execute(sql`TRUNCATE ... CASCADE`)` for cleanup |
| `packages/test-utils` `setupTestEnv()` | local | Set `DATABASE_URL` etc. | Use in E2E `beforeAll` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TRUNCATE between tests | Transaction rollback | TRUNCATE is simpler, no transaction savepoint complexity; rollback approach fragile with Fastify's own DB plugin lifecycle |
| Real DB for E2E | Fully mocked DB | Mocked DB can't verify actual writes; TEST-03 specifically requires verifying real DB state changes |
| Separate test DB server | Same CI postgres | CI already provisions postgres — use `TEST_DATABASE_URL` env var pointing to same server but different DB name |

**Installation:** No new packages needed. All dependencies already installed.

## Architecture Patterns

### E2E Test Infrastructure Pattern

The project's CI workflow (`/.github/workflows/ci.yml`) provisions a real PostgreSQL 16 database at `postgresql://ci:ci@localhost:5432/ai_cofounder_test` and runs `npm run db:push` before tests. E2E tests can use this database directly.

The key insight: existing unit tests mock `@ai-cofounder/db`. E2E tests must NOT mock it — they must use a real `createDb()` connection so actual rows are written.

```typescript
// Source: packages/db/src/client.ts
// Pattern for E2E test setup
import { createDb } from "@ai-cofounder/db";
import { sql } from "drizzle-orm";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
  ?? process.env.DATABASE_URL
  ?? "postgresql://ci:ci@localhost:5432/ai_cofounder_test";

export function createTestDb() {
  return createDb(TEST_DATABASE_URL);
}

// Tables to truncate in dependency order (children before parents)
const TRUNCATE_ORDER = [
  "tool_executions", "llm_usage", "code_executions",
  "approvals", "tasks", "goals",
  "conversation_summaries", "messages", "conversations",
  "schedules", "events", "work_sessions", "memories",
  "n8n_workflows", "prompts", "reflections",
  "document_chunks", "ingestion_state",
  "provider_health", "personas", "admin_users",
  "channel_conversations", "milestones", "users",
];

export async function truncateAllTables(db: ReturnType<typeof createDb>) {
  await db.execute(
    sql.raw(`TRUNCATE TABLE ${TRUNCATE_ORDER.join(", ")} CASCADE`)
  );
}
```

### E2E Server Wiring Pattern

The server's `dbPlugin` reads `DATABASE_URL` from the environment. For E2E tests, set `DATABASE_URL` to the test DB URL before calling `buildServer()`:

```typescript
// Source: apps/agent-server/src/server.ts — buildServer(registry?) pattern
import { buildServer } from "../server.js";
import { MockLlmRegistry, textResponse, toolUseResponse } from "@ai-cofounder/test-utils";

// DO NOT mock @ai-cofounder/db in E2E tests
// Instead: set DATABASE_URL env to test DB

const mockComplete = vi.fn();
const registry = new MockLlmRegistry(mockComplete);
const { app } = buildServer(registry);
```

### Full Goal Lifecycle Test Pattern

The full lifecycle (TEST-03) must exercise:
1. `POST /api/agents/run` with a user message → orchestrator calls `create_plan` tool
2. Verify `goals` + `tasks` rows created in DB
3. `TaskDispatcher.runGoal(goalId)` with MockLlmRegistry → tasks executed in sequence
4. Verify goal status updated to `completed`

```typescript
// Scripted LLM sequence for deterministic lifecycle test
import { toolUseResponse, textResponse } from "@ai-cofounder/test-utils";

// First call: orchestrator returns create_plan tool use
mockComplete.mockResolvedValueOnce(
  toolUseResponse("create_plan", {
    goal_title: "Test Goal",
    goal_description: "A test goal",
    goal_priority: "low",
    tasks: [{ title: "Research task", description: "Do research", assigned_agent: "researcher" }],
  })
);
// Second call: orchestrator text response after plan created
mockComplete.mockResolvedValueOnce(
  textResponse("Plan created. Tasks are queued for execution.")
);
// Third+ calls: specialist agent responses for each task
mockComplete.mockResolvedValueOnce(
  textResponse("Research complete. Found relevant information.")
);
```

### Quick Win Testing Pattern

Since all QWIN features already exist, Phase 4 testing for them follows the existing route test pattern:

```typescript
// Source: apps/agent-server/src/__tests__/conversation-routes.test.ts pattern
// For GET /api/agents/roles — mock @ai-cofounder/db, use app.inject()
describe("GET /api/agents/roles", () => {
  it("returns all agent roles", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/agents/roles" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toBeInstanceOf(Array);
    expect(body.some(r => r.role === "orchestrator")).toBe(true);
  });
});
```

### Path Traversal Testing Pattern

For QWIN-01/02 verification, the tests must confirm `resolveSafe()` blocks traversal:

```typescript
// Source: apps/agent-server/src/__tests__/workspace-service.test.ts — existing pattern
it("rejects path traversal on deleteFile", async () => {
  await expect(workspace.deleteFile("../../etc/passwd")).rejects.toThrow("Path traversal denied");
});

it("deletes a file within workspace", async () => {
  await workspace.writeFile("temp.txt", "content");
  await workspace.deleteFile("temp.txt");
  await expect(workspace.readFile("temp.txt")).rejects.toThrow();
});
```

### Recommended Test File Structure

```
apps/agent-server/src/__tests__/
├── e2e-goal-lifecycle.test.ts   # TEST-01,02,03,04,05,06 — real DB, MockLlmRegistry
├── workspace-delete.test.ts     # QWIN-01, QWIN-02 — WorkspaceService deleteFile/deleteDirectory
├── agents-roles.test.ts         # QWIN-03 — GET /api/agents/roles route test
├── conversation-export.test.ts  # QWIN-04 — GET /api/conversations/:id/export route test
└── swagger-docs.test.ts         # QWIN-05, QWIN-06 — GET /docs/json and GET /docs accessible
```

Note: `workspace-delete.test.ts` may be merged into the existing `workspace-service.test.ts` by adding new `describe` blocks. Similarly, `agents-roles.test.ts` may be added to `conversation-routes.test.ts`. The planner should choose whether to add to existing files or create new ones.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DB table cleanup | Custom delete-each-row loops | `TRUNCATE ... CASCADE` via Drizzle `sql.raw()` | CASCADE handles FK dependencies; orders of magnitude faster |
| LLM determinism in tests | Custom provider class | `MockLlmRegistry` from `packages/test-utils` | Already maintained, has `toolUseResponse()`/`textResponse()` helpers |
| HTTP test harness | `supertest` or actual HTTP calls | Fastify `app.inject()` | Already in 44+ tests; no network overhead; no port conflicts |
| Swagger config | Custom OpenAPI builder | `@fastify/swagger` + `@fastify/swagger-ui` | Already registered in `server.ts`; not a new install |
| Path safety | Custom regex path checker | `WorkspaceService.resolveSafe()` | Already implemented and tested |

**Key insight:** Every QWIN feature is already done. The planner should treat QWIN items as "write tests for existing code," not as new feature development.

## Common Pitfalls

### Pitfall 1: Mocking @ai-cofounder/db in E2E Tests

**What goes wrong:** Developer applies the standard `vi.mock("@ai-cofounder/db", ...)` pattern to E2E tests because it's used in all unit tests.
**Why it happens:** Copy-pasting the test boilerplate from existing route tests.
**How to avoid:** E2E tests must NOT mock `@ai-cofounder/db`. They need a real `createDb(TEST_DATABASE_URL)` connection. Use an explicit comment: `// NOTE: Do not mock @ai-cofounder/db — E2E tests require real DB writes`.
**Warning signs:** `createGoal` returns `{ id: "goal-1" }` instead of a real UUID — the DB mock is active.

### Pitfall 2: dbPlugin Reads DATABASE_URL at Registration Time

**What goes wrong:** Setting `process.env.DATABASE_URL` after `buildServer()` has no effect because `dbPlugin` reads the env var when the plugin registers.
**Why it happens:** Fastify plugins capture env vars during `app.register()`, which happens synchronously in `buildServer()`.
**How to avoid:** Set `process.env.DATABASE_URL = TEST_DATABASE_URL` in `beforeAll()` BEFORE calling `buildServer()`. Dynamic import of `server.ts` may also be needed to ensure the env is set before the module is first loaded.
**Warning signs:** E2E test connects to the wrong DB or fails with connection refused.

### Pitfall 3: Table Truncation Order (FK Violations)

**What goes wrong:** `TRUNCATE users` fails because `conversations` still references it.
**Why it happens:** PostgreSQL enforces FK constraints even in TRUNCATE (unless CASCADE is used).
**How to avoid:** Always use `TRUNCATE ... CASCADE` which handles the dependency graph automatically. The TRUNCATE_ORDER list in the Architecture section above handles this.
**Warning signs:** `ERROR: update or delete on table "users" violates foreign key constraint`.

### Pitfall 4: buildServer() Creates Multiple Scheduler/Health Flush Timers

**What goes wrong:** Each `buildServer()` call in tests starts the scheduler daemon and health flush `setInterval` — if `app.close()` is not called, timers leak.
**Why it happens:** `server.ts` starts scheduler in `onReady` hook; tests that don't call `app.close()` leave timers running.
**How to avoid:** Always `await app.close()` in `afterEach` or after each test. Consider using `afterAll` with one shared server instance for E2E tests to reduce startup cost.
**Warning signs:** Test suite hangs after completion, or `--forceExit` is needed.

### Pitfall 5: E2E Tests Require ANTHROPIC_API_KEY Set

**What goes wrong:** `buildServer()` calls `createLlmRegistry()` which reads `ANTHROPIC_API_KEY`. If not set, the provider may error during registration.
**Why it happens:** The AnthropicProvider constructor validates the key.
**How to avoid:** Set `process.env.ANTHROPIC_API_KEY = "test-key-not-real"` in `beforeAll` (existing pattern from all route tests). The MockLlmRegistry passed to `buildServer(registry)` bypasses actual LLM calls.
**Warning signs:** `Missing required API key` error during server startup.

### Pitfall 6: Swagger UI Route May Require JWT in Test

**What goes wrong:** `GET /docs` returns 401 because `/docs` is inside the `jwtGuardPlugin` scope.
**Why it happens:** Looking at `server.ts`, `jwtGuardPlugin` wraps all protected routes, but `/docs` is registered via `fastifySwagger` which is registered before `jwtGuardPlugin`. In practice, `/docs` should be public.
**How to avoid:** Verify that `GET /docs/json` returns 200 in the test. If it returns 401, the swagger prefix needs to be registered before `jwtGuardPlugin` (it already is in `server.ts`).
**Warning signs:** `GET /docs` returns 401 in test output.

### Pitfall 7: QWIN Tests Are NOT New Features

**What goes wrong:** Planner creates implementation tasks for QWIN items that are already done.
**Why it happens:** Requirements are written as features to build, but they were already implemented.
**How to avoid:** All QWIN plan tasks should be "add tests for..." not "implement...". Read the existing code first.
**Warning signs:** Plan tasks say "implement deleteFile" — that's wrong.

## Code Examples

Verified patterns from the codebase:

### E2E Test File Header (No DB Mock)

```typescript
// Source: Derived from apps/agent-server/src/__tests__/dispatcher.test.ts + workspace-service.test.ts patterns

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

// Set env BEFORE any dynamic imports — server reads these at module load time
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  // Use the test DB from CI or local test DB
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL
    ?? "postgresql://ci:ci@localhost:5432/ai_cofounder_test";
  // Prevent scheduler from running (BRIEFING_HOUR=25 is an invalid hour = no-op)
  process.env.BRIEFING_HOUR = "25";
});

// DO NOT mock @ai-cofounder/db here — E2E needs real DB writes

// DO mock @ai-cofounder/queue (no Redis needed in E2E DB tests)
vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-123"),
  enqueueReflection: vi.fn().mockResolvedValue(undefined),
}));

// DO mock @ai-cofounder/llm — MockLlmRegistry is what "mock LLM" means here
const mockComplete = vi.fn();
vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");
const { createDb } = await import("@ai-cofounder/db");
```

### Table Truncation Helper

```typescript
// Source: Drizzle ORM sql.raw() pattern — verified against drizzle-orm/postgres-js API
import { sql } from "drizzle-orm";

async function truncateTestDb(db: ReturnType<typeof createDb>) {
  await db.execute(
    sql.raw(`TRUNCATE TABLE
      tool_executions, llm_usage, code_executions,
      approvals, tasks, goals,
      conversation_summaries, messages, conversations,
      schedules, events, work_sessions, memories,
      n8n_workflows, prompts, reflections,
      document_chunks, ingestion_state,
      provider_health, personas, admin_users,
      channel_conversations, milestones, users
    CASCADE`)
  );
}
```

### Full Lifecycle Test Structure

```typescript
describe("E2E goal lifecycle — real DB", () => {
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateTestDb(db);
  });

  afterAll(async () => {
    await truncateTestDb(db);
    // postgres.js connection will be garbage collected; no explicit close needed
    // (or call db.$client.end() if using postgres.js directly)
  });

  it("creates goal and executes task via dispatcher", async () => {
    // 1. Mock LLM: first call = create_plan tool_use, second = text confirmation
    mockComplete
      .mockResolvedValueOnce(toolUseResponse("create_plan", { /* ... */ }))
      .mockResolvedValueOnce(textResponse("Plan created."))
      // Specialist agent responses for each task:
      .mockResolvedValueOnce(textResponse("Task complete."));

    // 2. Call agents/run via Fastify inject
    const { app } = buildServer();
    const runRes = await app.inject({
      method: "POST",
      url: "/api/agents/run",
      payload: { message: "Build me a feature", userId: "ext-user-1" },
    });
    expect(runRes.statusCode).toBe(200);
    const { plan } = runRes.json();
    expect(plan.goalId).toBeDefined();
    const goalId = plan.goalId;

    // 3. Verify DB has goal + tasks
    const { getGoal, listTasksByGoal } = await import("@ai-cofounder/db");
    const goal = await getGoal(db, goalId);
    expect(goal?.status).toBe("active");
    const tasks = await listTasksByGoal(db, goalId);
    expect(tasks.length).toBeGreaterThan(0);

    // 4. Run dispatcher against real DB
    const { TaskDispatcher } = await import("../agents/dispatcher.js");
    const dispatcher = new TaskDispatcher(app.llmRegistry, db);
    const result = await dispatcher.runGoal(goalId);
    expect(result.status).toBe("completed");

    // 5. Verify goal completed in DB
    const completed = await getGoal(db, goalId);
    expect(completed?.status).toBe("completed");

    await app.close();
  });
});
```

### Export Endpoint Test

```typescript
// Source: apps/agent-server/src/routes/conversations.ts:74-97 — already implemented
describe("GET /api/conversations/:id/export", () => {
  it("returns conversation as downloadable JSON", async () => {
    const convId = "00000000-0000-0000-0000-000000000001";
    mockGetConversation.mockResolvedValueOnce({ id: convId, title: "Test" });
    mockGetConversationMessages.mockResolvedValueOnce([
      { id: "msg-1", role: "user", content: "hi", createdAt: new Date() },
    ]);
    mockListGoalsByConversation.mockResolvedValueOnce([]);

    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: `/api/conversations/${convId}/export` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-type"]).toContain("application/json");
    const body = JSON.parse(res.body);
    expect(body.conversation.id).toBe(convId);
    expect(body.messages).toBeInstanceOf(Array);
  });
});
```

### Swagger/Docs Endpoint Test

```typescript
// Source: apps/agent-server/src/server.ts — fastifySwaggerUi registered at /docs
describe("Swagger UI and OpenAPI spec", () => {
  it("GET /docs/json returns OpenAPI spec", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/docs/json" });
    await app.close();

    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.info.title).toBe("AI Cofounder API");
    expect(spec.paths).toBeDefined();
  });

  it("GET /docs redirects to Swagger UI", async () => {
    const { app } = buildServer();
    const res = await app.inject({ method: "GET", url: "/docs" });
    await app.close();

    // Swagger UI serves HTML
    expect([200, 301, 302]).toContain(res.statusCode);
  });
});
```

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Unit tests only | E2E integration tests with real DB | Phase 4 adds real-DB tests to existing suite |
| Mocked DB in all tests | Real DB for lifecycle tests | E2E tests must use real postgres |
| Manual API testing | Swagger UI at `/docs` | Already in `server.ts` |

**Already current:**
- `@fastify/swagger` + `@fastify/swagger-ui`: correct modern approach, already installed and configured
- Vitest over Jest: correct choice for this monorepo, already established
- Fastify `inject()` over supertest: correct for Fastify apps, already established

## Open Questions

1. **Does `dbPlugin` support overriding DB via `buildServer(registry, db)` parameter?**
   - What we know: `buildServer(registry?)` only accepts a registry, not a DB instance. The `dbPlugin` reads `DATABASE_URL` from env.
   - What's unclear: Whether `TEST_DATABASE_URL` env var is the right mechanism, or whether `buildServer` needs a second `db` parameter added.
   - Recommendation: The simplest approach is setting `process.env.DATABASE_URL` to the test DB URL in `beforeAll`. This avoids modifying `buildServer`. If the planner wants a cleaner API, they could add a `db?` param to `buildServer` — but this is optional.

2. **Does `TaskDispatcher.runGoal()` need to be called directly, or via a worker test?**
   - What we know: TEST-03 requires "create → dispatch → orchestrator tool loop → completion". The dispatcher is already called by `worker.ts` in production.
   - What's unclear: Whether the intent is to test via HTTP (POST /api/goals/:id/execute → worker picks up) or direct dispatcher call.
   - Recommendation: Call `TaskDispatcher.runGoal()` directly in the E2E test — this avoids needing Redis/BullMQ in CI and still exercises the full goal lifecycle. The worker tests are a separate concern (TEST-V2-01).

3. **One E2E test file or three?**
   - What we know: The additional_context specifies three plan files: 04-01 (infra), 04-02 (lifecycle test), 04-03 (quick wins).
   - Recommendation: Infrastructure helpers in a shared setup file, lifecycle test in its own file, quick-win tests added to existing test files where appropriate.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| Quick run command | `npm run test -w @ai-cofounder/agent-server` |
| Full suite command | `npm run test` |
| Estimated runtime | ~60 seconds (agent-server alone); ~120 seconds full suite |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | Test DB isolation (separate from dev) | integration | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: `e2e-goal-lifecycle.test.ts` |
| TEST-02 | Fastify inject() HTTP harness | integration | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: same file |
| TEST-03 | Full goal lifecycle: create→dispatch→complete | integration | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: same file |
| TEST-04 | MockLlmRegistry deterministic responses | integration | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: same file |
| TEST-05 | DB cleaned between test runs | integration | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: truncate helper |
| TEST-06 | CI pipeline runs E2E | smoke | `npm run test` in GitHub Actions | ✅ CI yml exists; test file needed |
| QWIN-01 | deleteFile removes file, rejects traversal | unit | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: tests in workspace-service.test.ts |
| QWIN-02 | deleteDirectory removes dir, safety checks | unit | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: tests in workspace-service.test.ts |
| QWIN-03 | GET /api/agents/roles returns roles array | unit | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: agents-routes tests |
| QWIN-04 | GET /api/conversations/:id/export returns JSON | unit | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: conversation-routes export test |
| QWIN-05 | GET /docs/json returns OpenAPI spec | unit | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: swagger test |
| QWIN-06 | GET /docs serves Swagger UI | unit | `npm run test -w @ai-cofounder/agent-server` | ❌ Wave 0 gap: swagger test |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~60 seconds (agent-server test suite)

### Wave 0 Gaps (must be created before implementation)

- [ ] `apps/agent-server/src/__tests__/e2e-goal-lifecycle.test.ts` — covers TEST-01 through TEST-06 (new file)
- [ ] Truncate helper function (inline in e2e-goal-lifecycle.test.ts or as shared setup) — covers TEST-05
- [ ] `QWIN-01/02` tests added to `apps/agent-server/src/__tests__/workspace-service.test.ts` — covers QWIN-01, QWIN-02
- [ ] `QWIN-03` test added to existing routes test file (agents routes) — covers QWIN-03
- [ ] `QWIN-04` test added to `apps/agent-server/src/__tests__/conversation-routes.test.ts` — covers QWIN-04
- [ ] `QWIN-05/06` test added (new or existing swagger test) — covers QWIN-05, QWIN-06

Note: All QWIN items are tests for already-implemented features. No new source code needed for QWIN features.

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — all 45 test files, workspace.ts, orchestrator.ts, server.ts, routes/conversations.ts, routes/agents.ts
- `apps/agent-server/src/agents/tools/filesystem-tools.ts` — DELETE_FILE_TOOL, DELETE_DIRECTORY_TOOL verified present
- `apps/agent-server/src/agents/orchestrator.ts:914-934` — delete_file and delete_directory case handlers verified
- `apps/agent-server/src/routes/agents.ts:54-57` — GET /roles already implemented
- `apps/agent-server/src/routes/conversations.ts:74-97` — GET /:id/export already implemented
- `apps/agent-server/src/server.ts:90-127` — @fastify/swagger + @fastify/swagger-ui already registered
- `.github/workflows/ci.yml` — PostgreSQL 16 service confirmed, `npm run db:push` runs before tests

### Secondary (MEDIUM confidence)

- `packages/test-utils/src/mocks/llm.ts` — MockLlmRegistry with `toolUseResponse()`/`textResponse()` confirmed
- `packages/db/src/client.ts` — `createDb()` accepts any connection string, works for test DB
- `packages/test-utils/src/mocks/db.ts` — comprehensive `mockDbModule()` confirmed

### Tertiary (LOW confidence — not independently verified against external docs)

- Drizzle `sql.raw()` for TRUNCATE: standard Drizzle pattern; assumed to work based on Drizzle v0.45 API — verify in implementation
- `app.llmRegistry` accessible after `buildServer()` for passing to `TaskDispatcher`: should work based on the Fastify decorator pattern in `server.ts:136`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed, all patterns confirmed in codebase
- Architecture: HIGH — test infra approach confirmed by CI yml + existing test patterns
- Pitfalls: HIGH — all pitfalls derived from actual code inspection, not speculation
- QWIN implementation status: HIGH — confirmed by reading actual source files

**Research date:** 2026-03-08
**Valid until:** 2026-04-07 (stable stack, fast-moving: unlikely to change)
