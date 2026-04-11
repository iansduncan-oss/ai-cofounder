# Test Coverage Analysis

**Date:** 2026-04-09
**Test Suite:** 217/220 files pass, 2385/2415 tests pass
**Current Thresholds:** 58% lines, 50% functions, 47% branches, 58% statements

---

## Executive Summary

The codebase has **solid coverage for the core agent-server** (149 test files for 177 source files) and **exemplary coverage for the RAG pipeline** (7/7 modules tested). However, there are significant gaps in test _quality_ (over-mocking, weak assertions, missing error paths) and several workspace-level blind spots (discord-bot, plugins, LLM providers, specialist agents). The current threshold of 58% lines is low for a production system orchestrating AI agents with financial and security implications.

---

## 1. Structural Coverage Gaps (files with no tests)

### Priority 1 — High Risk, No Tests

These files contain critical business logic and have zero test coverage:

| File                               | Lines | Risk         | Why It Matters                                                                                                                             |
| ---------------------------------- | ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `agents/specialists/base.ts`       | 235   | **Critical** | Base class for all specialist agents — tool loop, retry logic, error handling. Untested means every specialist inherits untested behavior. |
| `agents/specialists/coder.ts`      | ~200  | **Critical** | Self-review logic for generated code. Bugs here produce unreviewed AI output.                                                              |
| `agents/specialists/researcher.ts` | ~150  | **High**     | Research agent used for web search + synthesis.                                                                                            |
| `agents/specialists/planner.ts`    | ~150  | **High**     | Planning agent — generates task DAGs.                                                                                                      |
| `agents/specialists/reviewer.ts`   | ~150  | **High**     | Reviews generated artifacts.                                                                                                               |
| `services/briefing.ts`             | 504   | **High**     | Daily briefing aggregation (Calendar + Gmail + action items). Complex data merging with multiple failure modes.                            |
| `services/monitoring.ts`           | 491   | **High**     | GitHub, VPS, and service health monitoring. Side effects (notifications) need verification.                                                |
| `services/pipeline.ts`             | ~300  | **High**     | Multi-step pipeline execution. State machine logic with many edge cases.                                                                   |
| `plugins/auth.ts`                  | 55    | **Critical** | JWT + cookie auth. Security-critical, compact enough to test exhaustively.                                                                 |
| `plugins/websocket.ts`             | ~200  | **High**     | WebSocket lifecycle management. Connection/disconnection edge cases.                                                                       |

### Priority 2 — Untested Tool Definitions (~2,175 lines across 21 files)

The following agent tools have no tests:

- `analytics-tools.ts`, `discord-tools.ts`, `episodic-tools.ts`, `filesystem-tools.ts`
- `follow-up-tools.ts`, `git-tools.ts`, `knowledge-tools.ts`, `memory-tools.ts`
- `n8n-tools.ts`, `procedural-tools.ts`, `reminder-tools.ts`, `review-tools.ts`
- `sandbox-tools.ts`, `template-tools.ts`, `verification-tools.ts`
- `vps-command-tools.ts`, `vps-tools.ts`, `web-search.ts`, `webhook-tools.ts`

These are the functions the AI orchestrator calls. Each tool definition includes parameter schemas and execution logic — untested tools risk runtime failures that are hard to diagnose in production.

### Priority 3 — Untested Plugins (~2,768 lines across 9 files)

- `plugins/db.ts` — Database connection lifecycle
- `plugins/jwt-guard.ts` — JWT middleware
- `plugins/pubsub.ts` — Redis pub/sub bridge
- `plugins/queue.ts` — BullMQ integration
- `plugins/workspace-context.ts` — Request-scoped workspace resolution
- `plugins/ws-chat.ts` — WebSocket chat handler
- `plugins/ws-emitter.ts` — WebSocket event emission

### Priority 4 — LLM Providers (626 lines, 0 tests)

All provider implementations lack tests:

- `providers/anthropic.ts`, `providers/groq.ts`, `providers/gemini.ts`
- `providers/openrouter.ts`, `providers/cerebras.ts`, `providers/ollama.ts`
- `providers/together.ts`, `providers/huggingface.ts`

While they share an `openai-compatible` base class, provider-specific quirks (auth headers, error shapes, rate limit handling) are untested.

### Priority 5 — Apps with Minimal Tests

| Workspace             | Test Files | Source Files | Ratio |
| --------------------- | ---------- | ------------ | ----- |
| `apps/discord-bot`    | 3          | 24           | 0.12  |
| `packages/mcp-server` | 1          | 3            | 0.33  |
| `packages/sandbox`    | 1          | 3            | 0.33  |

The discord-bot commands are thin wrappers (5-22 lines each) that delegate to `bot-handlers`, so the low ratio is partially justified. But `handlers/message-watcher.ts` and `register.ts` (66 lines) have real logic worth testing.

---

## 2. Test Quality Issues

### 2a. Over-Mocking — Tests That Verify Mock Behavior

The most pervasive issue. Many tests mock so aggressively that they test the mock infrastructure rather than real code:

**`packages/db` — repositories.test.ts:**
Uses a 67-line `Proxy`-based mock that simulates Drizzle's query builder chain. Tests verify that `select().from().where()` was called with the right arguments — but never verify actual SQL semantics, JOIN behavior, or constraint handling. This means:

- A broken WHERE clause passes tests
- A missing JOIN passes tests
- Incorrect column references pass tests

**`apps/agent-server` — orchestrator.test.ts (lines 25-66):**
Every DB function is wrapped in `vi.fn()`. Tests assert `mockCreateGoal.toHaveBeenCalledWith(...)` — verifying the call was made with the right shape, but not that the goal was persisted or retrievable.

**Recommendation:** Add a small suite of integration tests against a real (test) Postgres instance for the repository layer. Even 5-10 tests validating actual queries would catch the class of bugs that mocks hide.

### 2b. Weak Assertions

Several tests use assertions too loose to catch regressions:

- **orchestrator.test.ts:400** — `expect(result.response).toBeDefined()` when testing error on unrecognized tool. Should verify the error message content.
- **registry.test.ts:316-323** — `expect(Array.isArray(states)).toBe(true)` for circuit breaker states. Doesn't verify count, values, or structure.
- **security.test.ts:237-261** — Rate limiting test uses `toBeGreaterThanOrEqual(2)` instead of an exact count, masking over/under-limiting.

### 2c. Missing Error Path Coverage

Key error-handling code that exists in source but has no test:

| Location                    | Error Case                                       | Impact                                       |
| --------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `orchestrator.ts:276-277`   | Invalid dependency index in task graph           | Could silently accept bad plans              |
| `orchestrator.ts:300`       | Dependency cycle detection                       | Could deadlock on circular task dependencies |
| `orchestrator.ts:1023,1075` | Request abort / signal handling                  | Leaked resources on cancellation             |
| `orchestrator.ts:1448-1451` | RAG retrieval failure                            | Silent degradation not verified              |
| `dispatcher.ts:174`         | Fire-and-forget verification failure             | Goal completion status could be wrong        |
| `dispatcher.ts:421`         | Deadlock safety valve (empty batch + no running) | Could hang forever in untested scenario      |

### 2d. Test Anti-Patterns Found

1. **No-op tests:** Some tests assert mock calls happened but never verify the _result_ of those calls. Example: dispatcher onProgress callback — verified it was called twice, but not verified it was called at the right _time_ relative to task execution.

2. **Duplicated setup:** The same mock initialization (MockLlmRegistry, mock DB functions, env vars) is copy-pasted across 100+ test files. The `packages/test-utils` package exists but isn't leveraged consistently — some tests use `setupTestEnv()` while others manually set `process.env`.

3. **Implementation-detail coupling:** Tests that track execution order via mocked side effects (`executionOrder.push(...)`) but then don't assert on the actual order — they assert on call counts instead.

---

## 3. Recommended Improvements (Prioritized)

### Tier 1 — High Impact, Moderate Effort

1. **Test specialist agent base class (`base.ts`, 235 lines)**
   - Tool loop execution (0, 1, max rounds)
   - `completeWithRetry()` retry behavior (429, timeout, ECONNRESET, 503)
   - Non-retryable error passthrough
   - Signal/abort handling
   - _Why:_ Every specialist inherits this. A bug here affects all 7 agents.

2. **Test auth plugin (`auth.ts`, 55 lines)**
   - JWT validation (valid, expired, malformed, missing)
   - Cookie auth fallback
   - Internal/localhost bypass
   - _Why:_ Security-critical, small surface area, high ROI.

3. **Add orchestrator error path tests**
   - Dependency cycle detection
   - Invalid dependency indices
   - Request abort handling
   - RAG retrieval failure graceful degradation
   - History trimming edge cases (empty, single huge message, boundary)
   - _Why:_ The orchestrator is the core of the system. These are _known_ error paths with code that handles them but no test proving it works.

4. **Add dispatcher edge case tests**
   - Deadlock safety valve
   - Mixed parallel/sequential ordering verification
   - All-tasks-fail with multiple tasks
   - Verification failure handling
   - _Why:_ The dispatcher runs goal execution. Untested edge cases can hang or misreport.

### Tier 2 — Medium Impact, Medium Effort

5. **Test 5-6 high-use agent tools**
   - Focus on: `git-tools.ts`, `filesystem-tools.ts`, `sandbox-tools.ts`, `memory-tools.ts`, `verification-tools.ts`
   - Test parameter validation, happy path execution, error responses
   - _Why:_ These are the tools the AI calls most frequently. Tool failures cascade into bad agent behavior.

6. **Add DB repository integration tests**
   - Test 10-15 critical queries against a real test database
   - Focus on: `createGoal`/`getGoal`, memory save/recall with vectors, conversation CRUD
   - Use `testcontainers` or a `docker-compose.test.yml` with ephemeral Postgres
   - _Why:_ Current Proxy-based mocks can't catch SQL-level bugs.

7. **Test LLM provider error handling**
   - Rate limit responses (429 + retry-after header)
   - Timeout behavior
   - Malformed response handling
   - Auth failures
   - _Why:_ Provider failures are the most common production issue. Each provider has different error shapes.

8. **Strengthen assertion quality across existing tests**
   - Replace `toBeDefined()` with content assertions
   - Replace `toBeGreaterThanOrEqual` with exact counts where deterministic
   - Add return-value checks alongside mock-call checks
   - _Why:_ Low-effort improvement that catches real regressions.

### Tier 3 — Lower Priority, Good Hygiene

9. **Test briefing service (`briefing.ts`, 504 lines)**
   - Calendar + Gmail data merging
   - Missing data graceful degradation
   - Date/timezone edge cases

10. **Test monitoring service (`monitoring.ts`, 491 lines)**
    - GitHub API failure handling
    - VPS connectivity check failures
    - Metric aggregation edge cases

11. **Test pipeline service (`pipeline.ts`)**
    - Step execution ordering
    - Failure mid-pipeline
    - Retry/resume semantics

12. **Consolidate test utilities**
    - Audit which tests use `setupTestEnv()` vs manual `process.env`
    - Create shared fixtures for common mock patterns (MockLlmRegistry, mock DB)
    - Reduce copy-paste across the 149 agent-server test files

13. **Raise coverage thresholds**
    - Current: 58% lines / 50% functions / 47% branches
    - Target: 70% lines / 65% functions / 60% branches
    - Enforce per-workspace thresholds (RAG is at ~100%, discord-bot near 0%)

---

## 4. Summary Statistics

| Workspace             | Source Files | Test Files | Ratio    | Assessment                               |
| --------------------- | ------------ | ---------- | -------- | ---------------------------------------- |
| apps/agent-server     | 177          | 149        | 0.84     | Good quantity, quality gaps              |
| apps/discord-bot      | 24           | 3          | 0.12     | Low (thin wrappers, partially justified) |
| apps/slack-bot        | 2            | 1          | 0.50     | Acceptable                               |
| apps/dashboard        | 20           | 10         | 0.50     | Acceptable                               |
| packages/db           | 8            | 4          | 0.50     | Needs integration tests                  |
| packages/llm          | 14           | 6          | 0.42     | Provider gap                             |
| packages/queue        | 7            | 3          | 0.42     | Acceptable                               |
| packages/rag          | 7            | 7          | **1.00** | Exemplary                                |
| packages/shared       | 6            | 3          | 0.50     | Acceptable                               |
| packages/api-client   | 3            | 2          | 0.66     | Good                                     |
| packages/bot-handlers | 4            | 3          | 0.75     | Good                                     |
| packages/sandbox      | 3            | 1          | 0.33     | Low                                      |
| packages/mcp-server   | 3            | 1          | 0.33     | Low                                      |

**Total: 220 test files, 2,385 passing tests across 13 workspaces.**
