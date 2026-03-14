# Phase 13: Financial Tracking - Research

**Researched:** 2026-03-14
**Domain:** LLM cost attribution, budget alerting, cost aggregation queries, optimization suggestions
**Confidence:** HIGH

## Summary

The foundational infrastructure for this phase already exists and is production-ready. The `llmUsage` table, `recordLlmUsage()` function, and `getUsageSummary()` function are all wired and actively used by agents and routes. The `/api/usage` endpoint and the dashboard Usage page both exist with charts for by-provider, by-model, and by-agent breakdowns.

What is missing is the **per-day aggregation** needed to draw a daily spend trend chart (FIN-02's "by day" dimension), the **budget alert system** (FIN-03 — daily/weekly spend threshold monitoring with sub-1-minute fire), and the **cost optimization suggestion engine** (FIN-04). FIN-01 is already substantially complete: cost is persisted on every LLM call with provider, model, token counts, and microdollar cost, all linked to goalId/taskId/conversationId.

The implementation strategy is: (1) add a `getCostByDay()` DB function using a SQL `date_trunc` aggregate, (2) add a `BudgetAlertService` that checks daily/weekly spend against configurable thresholds and fires Slack/Discord notifications, (3) register a 1-minute recurring BullMQ monitoring check for budget sweeps, (4) add a `generateCostOptimizationSuggestions()` function that reads `llmUsage` patterns and compares usage categories against cheaper available models, (5) expose two new API endpoints (`/api/usage/daily` and `/api/usage/budget`), and (6) add a daily-trend `LineChart` to the existing Usage dashboard page plus a budget gauge card.

**Primary recommendation:** Wire a `BudgetAlertService` into the monitoring queue (same `check` dispatch pattern as `approval_timeout_sweep`), add `getCostByDay()` to the DB package, and extend the existing `/api/usage` route rather than creating a new file.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FIN-01 | LLM API costs tracked per-request with provider, model, token count, and dollar cost attribution | Already done: `recordLlmUsage()` is called in dispatcher, agents route, voice route. Schema has goalId/taskId/conversationId FKs. Cost in microdollars via `estimateCostMicros()`. Only gap: `conversationId` not always populated in dispatcher calls. |
| FIN-02 | Costs aggregated per goal, per day, and per agent type for budget visibility | `getCostByGoal()` exists. `getUsageSummary()` covers by-agent and by-model. Missing: `getCostByDay()` (daily time-series). Dashboard page exists but lacks trend chart. |
| FIN-03 | Budget alerts triggered when daily or weekly spend exceeds configurable thresholds | No budget threshold config or alert firing exists. Need: `budgetThresholds` env vars OR a DB settings table, `BudgetAlertService`, and a 1-minute recurring monitoring check. |
| FIN-04 | Cost optimization suggestions based on usage patterns (e.g., shift routine tasks to cheaper models) | No suggestion engine exists. Need: analysis function that reads recent `llmUsage`, computes average cost per `taskCategory`, and suggests model downgrades when cheaper models can handle the category. |
</phase_requirements>

---

## Standard Stack

### Core (all pre-installed, no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | existing | SQL aggregate queries for daily cost | Already used for all DB access |
| BullMQ | existing | 1-minute recurring budget check | Same pattern as `approval_timeout_sweep` |
| NotificationService | existing | Slack/Discord budget alert delivery | Already used for approval and goal notifications |
| recharts | existing | Daily spend LineChart on dashboard | Already used for usage bar/pie charts |
| @tanstack/react-query | existing | Dashboard data fetching | Already used in all dashboard queries |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| postgres.js | existing | Raw SQL for `date_trunc` aggregation | `getCostByDay()` uses `sql` tagged template |
| vitest | existing | Unit tests for service and DB fns | All tests follow `...mockDbModule()` pattern |

**Installation:** No new packages required.

---

## Architecture Patterns

### What Already Exists (Do Not Rebuild)

```
packages/db/src/repositories.ts
  ├── recordLlmUsage()          — writes per-call cost to llmUsage table
  ├── getCostByGoal()           — aggregated cost for a goal (goalId)
  ├── getTodayTokenTotal()      — today's total token count
  └── getUsageSummary()         — by-provider/model/agent breakdown for any period

apps/agent-server/src/routes/usage.ts
  └── GET /api/usage?period=today|week|month|all

apps/dashboard/src/routes/usage.tsx
  └── UsagePage with bar/pie/horizontal bar charts (recharts)
```

### What Needs Building

```
packages/db/src/repositories.ts
  └── getCostByDay(db, since, until) → [{date, costUsd, inputTokens, outputTokens, requests}]

apps/agent-server/src/services/budget-alert.ts  (new)
  └── BudgetAlertService
        ├── checkDailyBudget()   — reads today's spend vs DAILY_BUDGET_USD threshold
        ├── checkWeeklyBudget()  — reads 7-day spend vs WEEKLY_BUDGET_USD threshold
        └── generateOptimizationSuggestions()  — pattern analysis + model recommendations

apps/agent-server/src/routes/usage.ts  (extend)
  └── GET /api/usage/daily?days=N  — time-series for trend chart
  └── GET /api/usage/budget        — current spend vs thresholds

packages/queue/src/scheduler.ts  (extend)
  └── recurring budget-check every 60s (same as approval_timeout_sweep)

apps/agent-server/src/plugins/queue.ts  (extend)
  └── case "budget_check": BudgetAlertService.checkBudgets()

apps/dashboard/src/routes/usage.tsx  (extend)
  └── Add budget gauge card + daily LineChart (data from /api/usage/daily)

packages/api-client/src/client.ts + types.ts  (extend)
  └── getDailyCost(days), getBudgetStatus()
```

### Pattern 1: getCostByDay using date_trunc SQL aggregate

**What:** Group `llmUsage` rows by calendar day using PostgreSQL's `date_trunc('day', created_at)`.
**When to use:** Whenever a time-series of daily costs is needed.

```typescript
// Source: drizzle-orm sql`` template, PostgreSQL date_trunc
import { sql, and } from "drizzle-orm";
import { llmUsage } from "./schema.js";

export async function getCostByDay(
  db: Db,
  since: Date,
  until?: Date,
): Promise<Array<{ date: string; costUsd: number; inputTokens: number; outputTokens: number; requests: number }>> {
  const conditions = [sql`${llmUsage.createdAt} >= ${since.toISOString()}`];
  if (until) {
    conditions.push(sql`${llmUsage.createdAt} < ${until.toISOString()}`);
  }

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${llmUsage.createdAt})::date::text`.as("date"),
      costUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as("cost_usd"),
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as("input_tokens"),
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as("output_tokens"),
      requests: sql<number>`count(*)::int`.as("requests"),
    })
    .from(llmUsage)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${llmUsage.createdAt})`)
    .orderBy(sql`date_trunc('day', ${llmUsage.createdAt})`);

  return rows.map((r) => ({
    date: r.date,
    costUsd: Number(r.costUsd) / 1_000_000,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    requests: r.requests,
  }));
}
```

### Pattern 2: BudgetAlertService

**What:** Service that reads current spend and fires Slack/Discord notifications when thresholds exceeded.
**When to use:** Registered as a 1-minute recurring BullMQ monitoring check.

```typescript
// apps/agent-server/src/services/budget-alert.ts
import { optionalEnv, createLogger } from "@ai-cofounder/shared";
import type { Db } from "@ai-cofounder/db";
import { getUsageSummary } from "@ai-cofounder/db";
import type { NotificationService } from "./notifications.js";

export class BudgetAlertService {
  private logger = createLogger("budget-alert");
  private firedAlerts = new Set<string>(); // de-duplicate within a day

  constructor(
    private db: Db,
    private notificationService: NotificationService,
  ) {}

  async checkBudgets(): Promise<void> {
    const dailyLimitUsd = parseFloat(optionalEnv("DAILY_BUDGET_USD", "0"));
    const weeklyLimitUsd = parseFloat(optionalEnv("WEEKLY_BUDGET_USD", "0"));

    if (dailyLimitUsd > 0) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dailySummary = await getUsageSummary(this.db, { since: today });
      if (dailySummary.totalCostUsd >= dailyLimitUsd) {
        const key = `daily-${new Date().toISOString().slice(0, 10)}`;
        if (!this.firedAlerts.has(key)) {
          this.firedAlerts.add(key);
          await this.notificationService.sendBriefing(
            `**Budget Alert:** Daily LLM spend $${dailySummary.totalCostUsd.toFixed(4)} exceeded threshold $${dailyLimitUsd}`,
          );
        }
      }
    }

    if (weeklyLimitUsd > 0) {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weeklySummary = await getUsageSummary(this.db, { since: weekAgo });
      if (weeklySummary.totalCostUsd >= weeklyLimitUsd) {
        const key = `weekly-${new Date().toISOString().slice(0, 10)}`;
        if (!this.firedAlerts.has(key)) {
          this.firedAlerts.add(key);
          await this.notificationService.sendBriefing(
            `**Budget Alert:** Weekly LLM spend $${weeklySummary.totalCostUsd.toFixed(4)} exceeded threshold $${weeklyLimitUsd}`,
          );
        }
      }
    }
  }

  async generateOptimizationSuggestions(): Promise<string[]> {
    // Read last 7 days of usage grouped by taskCategory
    const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const summary = await getUsageSummary(this.db, { since: week });
    const suggestions: string[] = [];

    // Model cost reference: cheapest per category
    const CHEAPER_ALTERNATIVES: Record<string, { model: string; rationale: string }> = {
      simple:   { model: "llama-3.1-8b-instant (Groq)", rationale: "free-tier, sub-100ms latency" },
      research: { model: "gemini-2.5-flash", rationale: "$0.15/$0.60 vs $1.25/$10 per MTok" },
      code:     { model: "llama-3.3-70b-versatile (Groq)", rationale: "strong code quality at near-zero cost" },
    };

    // Identify where expensive models are used for cheap-capable tasks
    for (const [agentRole, stats] of Object.entries(summary.byAgent)) {
      if (stats.costUsd > 0.10 && agentRole === "orchestrator") {
        suggestions.push(
          "Orchestrator accounts for high cost. Consider routing simple classification tasks to groq/llama-3.1-8b-instant.",
        );
      }
    }

    for (const [model, stats] of Object.entries(summary.byModel)) {
      if (model.includes("opus") && stats.requests > 10) {
        suggestions.push(
          `claude-opus used for ${stats.requests} requests this week ($${stats.costUsd.toFixed(4)}). ` +
          `Routing 'planning' tasks to claude-sonnet saves ~80% cost with minimal quality loss.`,
        );
      }
    }

    return suggestions.length > 0 ? suggestions : ["No optimization opportunities detected based on current usage patterns."];
  }
}
```

### Pattern 3: Registering the budget check in queue.ts

**What:** Add `budget_check` as a case in the monitoring job dispatcher — same pattern as `approval_timeout_sweep`.
**When to use:** Plugin initialization.

```typescript
// In apps/agent-server/src/plugins/queue.ts — extend monitoring processor switch:
case "budget_check": {
  if (app.budgetAlertService) {
    await app.budgetAlertService.checkBudgets();
  }
  break;
}
```

```typescript
// In packages/queue/src/scheduler.ts — add 1-minute recurring check:
await monitoringQueue.upsertJobScheduler(
  "budget-check",
  { every: 60_000 },
  {
    name: "budget-check",
    data: { check: "budget_check" } satisfies MonitoringJob,
  },
);
```

### Pattern 4: Daily trend LineChart in dashboard

**What:** Add recharts `LineChart` with `date` on X-axis and `costUsd` on Y-axis.
**When to use:** In existing `UsagePage` component.

```typescript
// Source: recharts LineChart, same pattern as existing BarChart/PieChart in usage.tsx
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// In UsagePage — add hook:
const { data: dailyData } = useDailyCost(30); // last 30 days

// Render:
<ResponsiveContainer width="100%" height={250}>
  <LineChart data={dailyData?.days ?? []}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
    <Tooltip formatter={(value) => `$${Number(value).toFixed(4)}`} />
    <Line type="monotone" dataKey="costUsd" stroke="#3b82f6" dot={false} />
  </LineChart>
</ResponsiveContainer>
```

### Anti-Patterns to Avoid

- **Storing thresholds in a new DB table:** Use env vars (`DAILY_BUDGET_USD`, `WEEKLY_BUDGET_USD`). Phase 16 will add settings UI — keep it simple here.
- **Fetching all llmUsage rows for getCostByDay:** Always use SQL `date_trunc` + `GROUP BY` aggregation — the table will grow to tens of thousands of rows quickly.
- **Blocking agent execution on budget alerts:** Budget checks run in BullMQ monitoring worker, not in the request path. Never check budget in `agents.ts` router beyond the existing `DAILY_TOKEN_LIMIT` guard.
- **Re-implementing cost calculation:** `estimateCostMicros()` already exists in `repositories.ts`. The `PRICING` table there and the `MODEL_COSTS` table in `registry.ts` have diverged slightly — keep using `repositories.ts` as the single source of truth for DB writes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recurring 1-minute check | Custom interval via setInterval | BullMQ `upsertJobScheduler` with `every: 60_000` | Already used for approval sweep; persists across restarts |
| Alert de-duplication | Custom in-memory set | In-memory `Set<string>` keyed by date string | BudgetAlertService is a singleton per process; sufficient for this |
| Daily cost SQL | Drizzle query builder without aggregate | `sql` tagged template with `date_trunc` | Drizzle doesn't have a `dateTrunc()` helper; `sql``...`` works perfectly |
| Model cost lookup | New pricing file | `PRICING` table in `repositories.ts` | Already defined, already kept up-to-date |
| Notification delivery | New HTTP client | `NotificationService.sendBriefing()` | Already handles Slack + Discord; used for monitoring alerts |

**Key insight:** The hardest part of this feature is already done — every LLM call is instrumented. Phase 13 is primarily query + alerting plumbing on top of an existing data stream.

---

## Common Pitfalls

### Pitfall 1: getCostByDay returning empty rows for days with no spend
**What goes wrong:** Chart has gaps where no data exists — frontend crashes or renders awkwardly.
**Why it happens:** SQL `GROUP BY date_trunc(...)` only returns days that have rows. Days with zero spend are absent.
**How to avoid:** In the API route, generate the date range in TypeScript and left-join/fill zeros: iterate each calendar day and merge with DB results, defaulting to zero.
**Warning signs:** Chart shows fewer data points than `days` parameter requested.

### Pitfall 2: estimatedCostUsd is stored in microdollars — off-by-1-million error
**What goes wrong:** Budget alert fires at $0.000001 instead of $1.00, or dashboard shows $0.0000 for real spend.
**Why it happens:** Column is named `estimated_cost_usd_micros` but JavaScript may read it as if it's already in dollars.
**How to avoid:** Always divide by `1_000_000` before exposing to API consumers. `getCostByGoal()` and `getUsageSummary()` already do this. `getCostByDay()` must do the same.
**Warning signs:** Budget alerts fire immediately on server start, or cost appears as zero despite real usage.

### Pitfall 3: Alert de-duplication doesn't survive server restart
**What goes wrong:** BudgetAlertService fires duplicate Slack/Discord messages every time the server restarts.
**Why it happens:** `firedAlerts` is an in-memory `Set<string>` — cleared on restart.
**How to avoid:** Key alerts by date string (`daily-2026-03-14`). Even if the server restarts, the same day's key will match, preventing duplicate fires within the same calendar day. A Slack message every server restart (once per day) is acceptable — no DB persistence needed.
**Warning signs:** Multiple "Budget Alert" messages in Slack during a deploy cycle.

### Pitfall 4: MonitoringJob type doesn't include `budget_check`
**What goes wrong:** TypeScript error when adding `budget_check` to the `MonitoringJob` union.
**Why it happens:** `queues.ts` defines the type with a specific union of string literals.
**How to avoid:** Extend the `MonitoringJob.check` union in `packages/queue/src/queues.ts` to include `"budget_check"` before adding the scheduler entry.
**Warning signs:** TS error: "Type 'budget_check' is not assignable to type 'github_ci' | ...".

### Pitfall 5: Optimization suggestions are too generic or too frequent
**What goes wrong:** Agent sends "consider switching to Groq" every time the API is called.
**Why it happens:** Suggestion function runs on every `/api/usage/budget` request.
**How to avoid:** Cache suggestions in-memory with a 1-hour TTL, or compute them in the daily briefing job instead of on every API request.
**Warning signs:** Dashboard shows identical suggestions on every page load.

---

## Code Examples

### getCostByDay test pattern (follows mockDbModule pattern)

```typescript
// apps/agent-server/src/__tests__/budget-alert.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockGetUsageSummary = vi.fn();
vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
}));

// Source: existing pattern in dispatcher.test.ts, e2e-execution.test.ts
```

### Extending MonitoringJob type

```typescript
// packages/queue/src/queues.ts
export interface MonitoringJob {
  check:
    | "github_ci"
    | "github_prs"
    | "vps_health"
    | "vps_containers"
    | "approval_timeout_sweep"
    | "budget_check"   // ADD THIS
    | "custom";
  target?: string;
  metadata?: Record<string, unknown>;
}
```

### API route extensions

```typescript
// apps/agent-server/src/routes/usage.ts — add to usageRoutes plugin:

/** GET /api/usage/daily?days=30 */
app.get<{ Querystring: { days?: string } }>("/daily", async (request) => {
  const days = Math.min(parseInt(request.query.days ?? "30", 10), 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rawDays = await getCostByDay(app.db, since);

  // Fill zero-spend days
  const dayMap = new Map(rawDays.map((d) => [d.date, d]));
  const result = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    result.push(dayMap.get(key) ?? { date: key, costUsd: 0, inputTokens: 0, outputTokens: 0, requests: 0 });
  }
  return { days: result };
});

/** GET /api/usage/budget */
app.get("/budget", async () => {
  const dailyLimitUsd = parseFloat(optionalEnv("DAILY_BUDGET_USD", "0"));
  const weeklyLimitUsd = parseFloat(optionalEnv("WEEKLY_BUDGET_USD", "0"));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [daily, weekly] = await Promise.all([
    getUsageSummary(app.db, { since: today }),
    getUsageSummary(app.db, { since: weekAgo }),
  ]);

  const suggestions = app.budgetAlertService
    ? await app.budgetAlertService.generateOptimizationSuggestions()
    : [];

  return {
    daily: {
      spentUsd: daily.totalCostUsd,
      limitUsd: dailyLimitUsd,
      percentUsed: dailyLimitUsd > 0 ? (daily.totalCostUsd / dailyLimitUsd) * 100 : null,
    },
    weekly: {
      spentUsd: weekly.totalCostUsd,
      limitUsd: weeklyLimitUsd,
      percentUsed: weeklyLimitUsd > 0 ? (weekly.totalCostUsd / weeklyLimitUsd) * 100 : null,
    },
    optimizationSuggestions: suggestions,
  };
});
```

### ApiClient additions

```typescript
// packages/api-client/src/client.ts
getDailyCost(days = 30) {
  return this.request<DailyCostResponse>("GET", `/api/usage/daily?days=${days}`);
}

getBudgetStatus() {
  return this.request<BudgetStatusResponse>("GET", `/api/usage/budget`);
}
```

```typescript
// packages/api-client/src/types.ts
export interface DailyCostDay {
  date: string; // "2026-03-14"
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export interface DailyCostResponse {
  days: DailyCostDay[];
}

export interface BudgetStatusResponse {
  daily: { spentUsd: number; limitUsd: number; percentUsed: number | null };
  weekly: { spentUsd: number; limitUsd: number; percentUsed: number | null };
  optimizationSuggestions: string[];
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Token limit only (`DAILY_TOKEN_LIMIT`) | Token limit + dollar budget (`DAILY_BUDGET_USD`) | Phase 13 | More intuitive for cost management |
| Summary only (period totals) | Period totals + daily time-series | Phase 13 | Enables trend visualization |
| No optimization suggestions | LLM-free pattern analysis | Phase 13 | Actionable insight without LLM cost |

**Note on optimization suggestions:** Keep them purely algorithmic (no LLM call) to avoid a paradox of spending LLM tokens to suggest spending fewer LLM tokens. The suggestion logic is a simple comparison of `byModel` usage stats against a hardcoded model cost table.

---

## Open Questions

1. **Budget threshold storage: env vars vs DB**
   - What we know: Env vars (`DAILY_BUDGET_USD`, `WEEKLY_BUDGET_USD`) are simple and consistent with `DAILY_TOKEN_LIMIT` pattern already in the codebase.
   - What's unclear: Phase 16 will add a settings dashboard — will it need to write these at runtime?
   - Recommendation: Use env vars for Phase 13. Phase 16 can add DB-backed settings config. Note the decision in STATE.md.

2. **FIN-01 gap: conversationId not always set in dispatcher `recordLlmUsage` calls**
   - What we know: `recordLlmUsage()` in `dispatcher.ts` passes `goalId` and `taskId` but not `conversationId` (lines 532, 614). The schema supports it.
   - What's unclear: Is this a problem for FIN-01's "per conversation" breakdown requirement?
   - Recommendation: FIN-01 says "per-request" attribution — goalId + taskId is sufficient. The `conversationId` field is a nice-to-have. Pass it through when available but don't block the phase on it.

3. **Alert de-duplication robustness**
   - What we know: In-memory `Set<string>` works for single-process deployments.
   - What's unclear: If the server is horizontally scaled (not current practice), alerts could fire from each instance.
   - Recommendation: In-memory is fine for Phase 13. The project deploys a single server instance on VPS.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (root `vitest.config.ts`) |
| Config file | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern=budget` |
| Full suite command | `npm run test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIN-01 | `recordLlmUsage()` persists cost with all attribution fields | unit | `npm run test -w @ai-cofounder/db -- --testPathPattern=repositories` | Partial (repositories.test.ts exists, but no llmUsage-specific test) |
| FIN-02 | `getCostByDay()` returns correct aggregates grouped by date | unit | `npm run test -w @ai-cofounder/db -- --testPathPattern=repositories` | No — Wave 0 gap |
| FIN-02 | `GET /api/usage/daily` returns filled date series | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=usage` | No — Wave 0 gap |
| FIN-03 | `BudgetAlertService.checkBudgets()` fires notification when threshold exceeded | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=budget-alert` | No — Wave 0 gap |
| FIN-03 | Budget check runs within 1 minute (BullMQ registration) | smoke/manual | Check `setupRecurringJobs` registers `budget_check` with `every: 60_000` | No — Wave 0 gap |
| FIN-04 | `generateOptimizationSuggestions()` returns suggestions for expensive patterns | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=budget-alert` | No — Wave 0 gap |
| FIN-04 | `GET /api/usage/budget` response includes `optimizationSuggestions` array | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=usage` | No — Wave 0 gap |

### Sampling Rate

- **Per task commit:** `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=budget-alert`
- **Per wave merge:** `npm run test -w @ai-cofounder/agent-server && npm run test -w @ai-cofounder/db`
- **Phase gate:** Full suite green (`npm run test`) before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `apps/agent-server/src/__tests__/budget-alert.test.ts` — covers FIN-03, FIN-04 (new file)
- [ ] `apps/agent-server/src/__tests__/usage-routes.test.ts` — covers FIN-02 daily endpoint, FIN-03/04 budget endpoint (new file)
- [ ] `getCostByDay` test added to `packages/db/src/__tests__/repositories.test.ts` — covers FIN-02

---

## Sources

### Primary (HIGH confidence)

- Codebase direct inspection — `packages/db/src/schema.ts` (llmUsage table definition)
- Codebase direct inspection — `packages/db/src/repositories.ts` (recordLlmUsage, getCostByGoal, getUsageSummary, getTodayTokenTotal — all confirmed present)
- Codebase direct inspection — `packages/llm/src/registry.ts` (MODEL_COSTS, estimateCost, costMicrodollars already tracked per-call)
- Codebase direct inspection — `apps/agent-server/src/agents/dispatcher.ts` (recordLlmUsage called on every task completion)
- Codebase direct inspection — `packages/queue/src/scheduler.ts` (upsertJobScheduler pattern with `every: 60_000` for approval sweep)
- Codebase direct inspection — `apps/agent-server/src/plugins/queue.ts` (monitoring processor switch case pattern)
- Codebase direct inspection — `apps/agent-server/src/routes/usage.ts` (existing /api/usage endpoint)
- Codebase direct inspection — `apps/dashboard/src/routes/usage.tsx` (existing UsagePage with recharts)

### Secondary (MEDIUM confidence)

- PostgreSQL docs — `date_trunc()` function behavior with timezone is stable and well-understood
- BullMQ docs — `upsertJobScheduler` with `every` fires at most once per interval, survives restarts

### Tertiary (LOW confidence)

- None — all findings are directly verified from codebase inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — All libraries confirmed present in package.json and actively used
- Architecture: HIGH — Patterns verified directly from working code (approval_timeout_sweep, getUsageSummary, recharts usage)
- Pitfalls: HIGH — Microdollar unit confirmed from schema column name and getCostByGoal() division pattern; empty-day gap is a known SQL aggregation behavior

**Research date:** 2026-03-14
**Valid until:** 2026-06-14 (stable codebase, no fast-moving external dependencies)
