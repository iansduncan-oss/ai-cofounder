# Next Session Prompt — AI Cofounder Continued Improvements

## Context

The prior session delivered massive improvements to the AI Cofounder codebase (see `TEST_COVERAGE_ANALYSIS.md` for the starting state). Merged work includes:

- **~320 new tests** (2385 → 2713+ passing)
- **6 security fixes** (SQL injection, sandbox injection, SSRF, lock tokens, rate limiting, JSON.parse crash)
- **6 real bugs fixed** (React rules-of-hooks, 2× stale-closures, SSE memoization, procedural memory embedding, unstable arrays)
- **Zero lint warnings** locked in with pre-commit hooks (husky + lint-staged, `--max-warnings=0`)
- **20+ Prometheus alerts** (including budget, security, circuit breakers, sandbox)
- **Dependabot** config for automated weekly updates
- **React Query cache tuning** for specific queries
- **6 new database indexes** (migration 0053) on hot query paths
- Shared `createTestApp()` / `mockQueueModule()` test factory
- Docker HEALTHCHECK on all containers
- OpenTelemetry tracing wired and verified
- Graceful shutdown verified in server.ts and worker.ts

The codebase is **production-ready**. Remaining work is incremental quality improvements and feature development, not urgent bug fixes.

## Prioritized Work Queue

### 🔴 High Value — Take these first

#### 1. Refactor the giants (orchestrator, tool-executor, dispatcher)

Three files account for **~4,100 lines**:
- `apps/agent-server/src/agents/orchestrator.ts` — 1571 lines
- `apps/agent-server/src/agents/tool-executor.ts` — 1505 lines
- `apps/agent-server/src/agents/dispatcher.ts` — 1001 lines

These are monolithic and hide bugs. Break them into focused modules:

**orchestrator.ts** → split into:
- `orchestrator/core.ts` — main class, request lifecycle
- `orchestrator/tool-loop.ts` — agentic loop with max rounds
- `orchestrator/rag-context.ts` — RAG retrieval + history trimming
- `orchestrator/plan-execution.ts` — plan persistence + dependency validation
- `orchestrator/memory-integration.ts` — save/recall memory integration

**tool-executor.ts** → organize by tool category:
- `tool-executor/core.ts` — dispatch logic
- `tool-executor/memory-tools.ts` — save_memory, recall_memories, touchMemory
- `tool-executor/workflow-tools.ts` — n8n, schedules, follow-ups
- `tool-executor/approval-flow.ts` — yellow/red tier approval polling

**dispatcher.ts** → consider splitting:
- `dispatcher/core.ts` — main runGoal method
- `dispatcher/dag-execution.ts` — parallel task scheduling + dependency resolution
- `dispatcher/failure-handling.ts` — block downstream, verify, plan repair

**Existing tests MUST continue to pass.** The dispatcher and orchestrator have 15+ test files covering error paths, tool loops, and edge cases. Run `npx vitest run apps/agent-server/src/__tests__/orchestrator*.test.ts apps/agent-server/src/__tests__/dispatcher*.test.ts` before and after to verify parity.

#### 2. Migrate test files to the shared `createTestApp()` factory

150+ test files copy-paste the same ~50 lines of mock setup. PR #5 added `createTestApp()`, `mockQueueModule()`, etc. in `packages/test-utils/src/server-factory.ts`.

**Migration recipe** — find files that:
1. Build server + call `app.inject()` (route-level tests)
2. Have `vi.mock("@ai-cofounder/db", ...)` with large mockDbModule overrides

Replace their boilerplate with:
```typescript
import { createMockComplete, mockSharedModule, mockLlmModule, mockDbModule, mockQueueModule, createTestApp } from "@ai-cofounder/test-utils";

const mockComplete = createMockComplete();
vi.mock("@ai-cofounder/shared", () => mockSharedModule());
vi.mock("@ai-cofounder/db", () => ({ ...mockDbModule(), getGoal: vi.fn() })); // only override what's needed
vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));
const { queueModule } = mockQueueModule();
vi.mock("@ai-cofounder/queue", () => queueModule);

const { buildServer } = await import("../server.js");
const { app } = await createTestApp(buildServer);
```

Estimated savings: **~3000 lines of boilerplate** across 150+ files.

#### 3. OpenAPI docs enrichment

Only **3 of 55 routes** have a `summary` and **11 have a `description`**. The auto-generated docs at `/docs` are essentially just endpoint lists.

Add `summary` and `description` to schemas for the **top 30 most-used routes**:
- `/api/agents/run` — main agent execution endpoint
- `/api/goals/*` — goal CRUD
- `/api/tasks/*` — task CRUD
- `/api/approvals/*` — approval flow
- `/api/memories/*` — memory management
- `/api/briefings/today` — daily briefing
- `/api/pipelines/*` — pipeline execution
- `/api/subagents/*` — subagent runs
- All `/api/health*` endpoints

Also add **response schemas** (not just request schemas) so clients get typed responses. Fastify uses Typebox; see `packages/api-client/src/types.ts` for the expected shapes.

### 🟡 Medium Value

#### 4. CSP hardening and verification

Current CSP at `apps/agent-server/src/server.ts:171`:
```typescript
scriptSrc: ["'self'"]    // good — no 'unsafe-inline'
styleSrc: ["'self'"]     // good — but Tailwind may break
```

Tasks:
1. Boot the production dashboard in a browser with DevTools open
2. Catch any CSP violations and document them
3. Either fix violations or add specific CSP exemptions with comments
4. Add `report-uri` or `report-to` directive pointing to an endpoint that logs violations
5. Consider adding Subresource Integrity (SRI) hashes if using CDNs

#### 5. Load testing suite

The codebase has 243 route handlers and zero load tests. Create a **k6** or **Artillery** suite for critical paths:

```javascript
// k6 example
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Hit /api/goals/:id, /api/tasks?goalId=:id, POST /api/agents/run
}
```

Store scripts in `scripts/load-tests/` and document how to run them. Target routes:
- `/api/agents/run` (creates goal, executes)
- `/api/goals/:id` (GET — heavy aggregation)
- `/api/dashboard` (summary — lots of parallel queries)
- WebSocket: `/ws/chat/:conversationId` (streaming)

#### 6. Tool efficacy audit — reduce token costs

The `ToolEfficacyService` tracks which tools the LLM actually uses. Tools that are defined but never called still consume tokens in the system prompt.

Tasks:
1. Query `tool_executions` table for 30-day usage stats per tool
2. Identify tools with <5 invocations in 30 days
3. For each, determine: is it broken? rarely needed? or just dormant?
4. Either fix, deprecate, or gate behind context-aware loading (only include when relevant)

**Estimated savings:** 10-20% on input tokens for the orchestrator's main loop.

#### 7. Structured error responses across routes

Different routes return different error shapes:
- Some return `{ error: "message" }`
- Some return `{ error, statusCode }`
- Some return `{ message, code }`

Standardize via a Fastify error handler:
```typescript
app.setErrorHandler((error, request, reply) => {
  reply.status(error.statusCode ?? 500).send({
    error: {
      code: error.code ?? "INTERNAL",
      message: error.message,
      details: error.validation ?? undefined,
      requestId: request.id,
    },
  });
});
```

Then update `packages/api-client` to parse the standard shape. Makes frontend error handling trivial.

### 🟢 Lower Priority

#### 8. CodeQL / SAST scanning in CI

Add a GitHub Actions workflow for CodeQL (free for public repos, paid for private):

```yaml
name: CodeQL
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 8 * * 1'  # Weekly Monday 8am

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
```

Alternative: Semgrep (more flexible, supports custom rules).

#### 9. Secret rotation runbook

Document how to rotate each secret without downtime:
- `ANTHROPIC_API_KEY` / other LLM keys (hot-swap via env reload?)
- `JWT_SECRET` (invalidates all sessions — plan grace period)
- `API_SECRET` (used by bots — coordinate bot updates)
- `DATABASE_URL` password (requires DB + app restart)
- OAuth tokens (Gmail, Calendar, GitHub)

Store in `docs/runbooks/secret-rotation.md`.

#### 10. API versioning strategy

Current API has no versioning. Decide: URL prefix (`/api/v1/`), header-based (`Accept: application/vnd.aicofounder.v1+json`), or never version (monolithic client + server deploys).

For a single-tenant tool, "never version" is often fine — but document the decision.

## Anti-recommendations (avoid these)

**Don't:**
- **Over-abstract the refactor.** orchestrator.ts is big but coherent. Don't split it into 20 files — 4-5 focused modules is enough.
- **Migrate all 150 tests to the factory at once.** Do it in batches of 10-20 tests with verification between batches.
- **Add OpenAPI descriptions by running a script that inserts placeholders.** The descriptions must be hand-written to be useful.
- **Add load tests without a real test environment.** Running k6 against production is a bad idea; set up a staging env first.

## Verification checklist

After any significant change:
1. `npm run lint` → 0 warnings
2. `npm run build` → all 14 packages build clean
3. `npx vitest run` → 2700+ tests passing (28 git-signing sandbox failures are pre-existing)
4. `npx tsc --noEmit` in each workspace → 0 errors

## How to start the next session

Paste this into a fresh Claude session:

> "I want to continue working on the AI Cofounder codebase. Read `.claude/primer.md` for prior context and `.claude/NEXT-SESSION-PROMPT.md` for the prioritized work queue. Start with item 1 (refactoring orchestrator.ts, tool-executor.ts, dispatcher.ts) since it's the highest value. Before making changes, run the existing tests on these files as a baseline so you can verify parity after the refactor."

## Session metadata

- **Branch to work on:** `claude/analyze-test-coverage-C2ekm` or new feature branch
- **Main branch state:** Clean, zero warnings, 2713+ passing tests
- **Deploy pipeline:** Push to `main` → CI → Tailscale SSH → Docker Compose restart on VPS
- **Budget/token considerations:** Large refactors consume lots of context — plan for 2-3 separate PRs rather than one mega-PR
