---
phase: 13-financial-tracking
verified: 2026-03-15T16:30:00Z
status: human_needed
score: 4/4 success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "Every LLM call has an accurate dollar cost persisted within the request lifecycle"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Verify dashboard Usage page displays daily cost trend and budget gauges with real data"
    expected: "LineChart renders 30 data points, budget gauge cards show daily and weekly spend vs limits, optimization suggestions panel appears only when applicable"
    why_human: "Cannot verify React rendering, chart interactivity, or color-coded progress bar behavior programmatically"
  - test: "Trigger a BullMQ budget_check job and confirm Slack/Discord alert fires when threshold exceeded"
    expected: "Within 60 seconds of DAILY_BUDGET_USD being exceeded, a sendBriefing() call fires and the firedAlerts Set prevents duplicate messages for the same day"
    why_human: "Requires running Redis + BullMQ stack with a real DAILY_BUDGET_USD env var set below current spend"
---

# Phase 13: Financial Tracking Verification Report

**Phase Goal:** Know exactly what the agent costs — per request, per goal, per day — with budget enforcement and optimization suggestions
**Verified:** 2026-03-15T16:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 13-03)

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | Every LLM call has an accurate dollar cost persisted within the request lifecycle | ✓ VERIFIED | `LlmRegistry.onCompletion` hook fires after every successful `complete()` call. Wired once in `server.ts` line 104 to call `recordLlmUsage(app.db, ...)`. All 5 manual recording sites removed from routes/agents.ts (2), routes/voice.ts (1), dispatcher.ts (2). All 15+ call sites across orchestrator, specialists, briefing, journal, etc. now record automatically. Orchestrator passes `agentRole + conversationId` metadata in all 4 `complete()` calls (lines 478, 519, 666, 697). |
| 2   | Dashboard shows cost breakdown by any dimension (day, goal, model, agent) | ✓ VERIFIED | `GET /api/usage/daily` + daily trend LineChart in usage.tsx. `GET /api/usage?period=` returns byModel/byAgent/byProvider breakdowns. `getCostByGoal()` for per-goal cost. |
| 3   | Budget alert fires within 1 minute of threshold breach | ✓ VERIFIED | `budget-check` BullMQ job runs every 60s. `BudgetAlertService.checkBudgets()` wired in queue plugin. Tests confirm alert fires when threshold met. |
| 4   | Cost optimization suggestions generated based on usage patterns | ✓ VERIFIED | `generateOptimizationSuggestions()` — algorithmic rules (Opus >10 requests, orchestrator >70% share). Exposed via `GET /api/usage/budget` and rendered in dashboard suggestions panel. |

**Score:** 4/4 success criteria verified

---

### Required Artifacts — Plan 03 (Gap Closure)

| Artifact | Status | Details |
| -------- | ------ | ------- |
| `packages/llm/src/registry.ts` | ✓ VERIFIED | `onCompletion?: OnCompletionCallback` property at line 136. Hook invocation at lines 358-377 inside `complete()` — fires before `return`, after cost calculation, only on success path. Errors caught both sync (try/catch) and async (`.catch()`). |
| `packages/llm/src/types.ts` | ✓ VERIFIED | `CompletionMetadata` interface at line 48 with `agentRole?`, `goalId?`, `taskId?`, `conversationId?`, `[key: string]: unknown`. `metadata?: CompletionMetadata` added to `LlmCompletionRequest` at line 64. |
| `packages/llm/src/index.ts` | ✓ VERIFIED | `CompletionMetadata` exported at line 12 from `./types.js`. `CompletionEvent` and `OnCompletionCallback` exported at lines 21-22 from `./registry.js`. |
| `apps/agent-server/src/server.ts` | ✓ VERIFIED | `CompletionEvent` imported at line 18. `recordLlmUsage` imported at line 47. `llmRegistry.onCompletion` assigned at line 104 — calls `recordLlmUsage(app.db, ...)` with full attribution fields. |
| `apps/agent-server/src/__tests__/llm-usage-hook.test.ts` | ✓ VERIFIED | 150 lines (min 60 required). 6 tests: hook fires with correct data, does NOT fire on failure, swallows sync throw, swallows async rejection, passes metadata, works with no hook set. Uses `LlmRegistry` directly — no mocking needed. |

### Required Artifacts — Plans 01 & 02 (Previously Verified, Regression Check)

| Artifact | Status | Details |
| -------- | ------ | ------- |
| `packages/db/src/repositories.ts` | ✓ VERIFIED | `getCostByDay()`, `getCostByGoal()`, `getUsageSummary()`, `recordLlmUsage()` all present (confirmed via test mock references). |
| `apps/agent-server/src/services/budget-alert.ts` | ✓ VERIFIED | No changes in plan 03. Previously verified at 119 lines with 8 tests. |
| `apps/agent-server/src/routes/usage.ts` | ✓ VERIFIED | No changes in plan 03. Previously verified. |
| `apps/dashboard/src/routes/usage.tsx` | ✓ VERIFIED | No changes in plan 03. Previously verified. |

---

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `packages/llm/src/registry.ts` | `apps/agent-server/src/server.ts` | `registry.onCompletion` callback assigned in `buildServer()` | ✓ WIRED | `server.ts` line 104: `llmRegistry.onCompletion = (event: CompletionEvent) => { ... }` — confirmed present |
| `apps/agent-server/src/server.ts` | `@ai-cofounder/db recordLlmUsage` | `onCompletion` callback body calls `recordLlmUsage(app.db, ...)` | ✓ WIRED | `server.ts` line 105: `recordLlmUsage(app.db, { provider, model, taskCategory, agentRole, ... })` — confirmed present |
| `packages/llm/src/registry.ts` complete() | onCompletion hook | Hook fires only on success, before `return` | ✓ WIRED | Lines 358-377: inside try block after `recordSuccess()`, before `return { ...response, ... }`. Error path (`catch`) does NOT fire hook. |
| `apps/agent-server/src/agents/orchestrator.ts` | `registry.complete()` metadata | `metadata: { agentRole: "orchestrator", conversationId: id }` on all 4 calls | ✓ WIRED | Lines 478, 519 (`run()`), 666, 697 (`runStream()`) — all 4 confirmed |
| Manual `recordLlmUsage` removal — routes/agents.ts | — | No manual calls remain | ✓ WIRED | `grep recordLlmUsage apps/agent-server/src/routes/agents.ts` returns no matches |
| Manual `recordLlmUsage` removal — routes/voice.ts | — | No manual calls remain | ✓ WIRED | `grep recordLlmUsage apps/agent-server/src/routes/voice.ts` returns no matches |
| Manual `recordLlmUsage` removal — dispatcher.ts | — | No manual calls remain | ✓ WIRED | `grep recordLlmUsage apps/agent-server/src/agents/dispatcher.ts` returns no matches |
| LLM providers (anthropic, groq, gemini, openrouter) | metadata field | Providers ignore `metadata` — not forwarded to API | ✓ WIRED | `grep metadata packages/llm/src/providers/anthropic.ts` returns no matches. Providers only forward `model/system/messages/tools/max_tokens/temperature`. |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| FIN-01 | 13-01-PLAN.md + 13-03-PLAN.md | LLM API costs tracked per-request with provider, model, token count, and dollar cost attribution | ✓ SATISFIED | `onCompletion` hook in `LlmRegistry.complete()` captures provider, model, inputTokens, outputTokens, costMicrodollars for every call. `recordLlmUsage(app.db, ...)` in server.ts persists all fields. No call site excluded — hook covers orchestrator, specialists, briefing, journal, suggestions, reflection, summarizer, subagent, autonomous-executor, and any future callers. REQUIREMENTS.md line 71 shows `[x]`, traceability table line 134 shows `Complete`. |
| FIN-02 | 13-02-PLAN.md | Costs aggregated per goal, per day, and per agent type for budget visibility | ✓ SATISFIED | `getCostByDay()` (daily), `getCostByGoal()` (per-goal), `getUsageSummary()` with `byAgent`/`byModel`/`byProvider` breakdowns. All exposed via API and dashboard. REQUIREMENTS.md line 72 shows `[x]`. |
| FIN-03 | 13-01-PLAN.md + 13-02-PLAN.md | Budget alerts triggered when daily or weekly spend exceeds configurable thresholds | ✓ SATISFIED | `BudgetAlertService.checkBudgets()` runs every 60s via BullMQ. Fires `sendBriefing()` on threshold breach. De-duplicated per calendar day. REQUIREMENTS.md line 73 shows `[x]`. |
| FIN-04 | 13-01-PLAN.md + 13-02-PLAN.md | Cost optimization suggestions based on usage patterns | ✓ SATISFIED | `generateOptimizationSuggestions()` — rule-based (Opus >10 requests, orchestrator >70% share). Exposed at `GET /api/usage/budget` and rendered in dashboard suggestions panel. REQUIREMENTS.md line 74 shows `[x]`. |

**All 4 FIN requirements verified as `[x]` and `Complete` in REQUIREMENTS.md traceability table.**

---

### Anti-Patterns Found

None detected across all key files modified in plan 03:
- `packages/llm/src/registry.ts` — hook is substantive (full error-guarding, not a placeholder)
- `packages/llm/src/types.ts` — real interface with meaningful fields
- `apps/agent-server/src/server.ts` — real `recordLlmUsage()` call, not a stub
- `apps/agent-server/src/__tests__/llm-usage-hook.test.ts` — 6 real behavior tests, not empty assertions
- `apps/agent-server/src/agents/orchestrator.ts` — metadata added to all 4 call sites (no TODO remaining)

---

### Human Verification Required

#### 1. Dashboard Cost Visualization

**Test:** Navigate to the dashboard Usage page at `http://localhost:5173` with some LLM usage data in the database.
**Expected:** Daily Cost Trend section shows a 30-day LineChart with date labels (MM/DD), Y-axis in USD. Budget Gauge section shows two side-by-side cards for daily and weekly budgets with color-coded progress bars (blue below 90%, yellow 90-100%, red above 100%). When `DAILY_BUDGET_USD` and `WEEKLY_BUDGET_USD` are not set, both cards show "No limit configured."
**Why human:** React rendering, chart display, and color-coded progress bar logic cannot be verified programmatically.

#### 2. Budget Alert End-to-End

**Test:** Set `DAILY_BUDGET_USD` to a value below current daily spend in `.env`, then wait up to 60 seconds for the next BullMQ `budget-check` job to fire.
**Expected:** A Slack/Discord message arrives via `sendBriefing()` containing the spend amount and limit. Running the check a second time within the same calendar day does not send a second message (de-duplication).
**Why human:** Requires running Redis + BullMQ stack with live credentials and real threshold configuration.

---

### Re-verification Summary

**Gap closed:** FIN-01 — "Every LLM call has an accurate dollar cost persisted within the request lifecycle"

The previous verification found 9 call sites that invoked `registry.complete()` without recording LLM usage. Plan 13-03 resolved this by adding an `onCompletion` hook to `LlmRegistry.complete()` — a single-point fix that covers every current and future call site automatically. The hook:

- Is set once in `server.ts` `buildServer()` (not in `onReady`, so it fires from the moment the server processes requests)
- Calls `recordLlmUsage(app.db, ...)` fire-and-forget (errors do not propagate to LLM callers)
- Captures full attribution: provider, model, taskCategory, agentRole, goalId, taskId, conversationId via the new `metadata` pass-through field on `LlmCompletionRequest`
- Is ignored by all LLM providers (Anthropic, Groq, Gemini, OpenRouter) — `metadata` is stripped before the API call

The 5 previously-manual `recordLlmUsage()` calls in routes/agents.ts (2), routes/voice.ts (1), and dispatcher.ts (2) were all removed to prevent double-counting.

The 6-test test file (`llm-usage-hook.test.ts`) covers: fires with correct event data, does not fire on error, swallows sync/async hook throws, passes metadata, works with no hook set.

All 4 FIN requirements are now `[x]` Complete in REQUIREMENTS.md.

The remaining 2 human-verification items (dashboard chart rendering, budget alert end-to-end with live Redis) are unchanged from the initial verification — they require a running stack.

---

_Verified: 2026-03-15T16:30:00Z_
_Verifier: Claude (gsd-verifier)_
