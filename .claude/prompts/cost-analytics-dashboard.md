# Cost Analytics Dashboard

## Context

The agent server already tracks LLM usage data — `providerHealth` stores per-provider stats (requests, tokens, latency), `toolExecutions` records per-tool timing, and Prometheus histograms expose `llm_request_tokens_total` and `llm_request_cost_dollars`. But none of this is surfaced to the user in a digestible way. There's no visibility into "how much did my agents cost this week?" or "which provider is eating my budget?"

This feature adds a Cost Analytics page to the dashboard with spending breakdowns, trends, and budget alerts.

---

## 1. Cost Tracking DB Table

**File:** `packages/db/src/schema.ts`

Add a `costRecords` table:

```typescript
export const costRecords = pgTable("cost_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),          // "anthropic", "groq", "gemini", "openrouter"
  model: text("model").notNull(),                // "claude-sonnet-4-20250514", etc.
  taskCategory: text("task_category"),            // "planning", "conversation", "code", etc.
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costCents: integer("cost_cents").notNull(),     // cost in cents (integer to avoid float issues)
  goalId: uuid("goal_id").references(() => goals.id),
  requestId: text("request_id"),                  // correlates with x-request-id
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Add repository functions:
- `recordCost(db, data)` — insert a cost record
- `getCostSummary(db, { from, to, groupBy })` — aggregate costs by provider/model/day/taskCategory
- `getDailyCosts(db, days)` — daily cost totals for the last N days
- `getCostByGoal(db, goalId)` — total cost for a specific goal

---

## 2. Wire Cost Recording into LLM Registry

**File:** `packages/llm/src/registry.ts`

After each successful LLM call, emit a cost event or call a callback with token counts and the computed cost. The registry already tracks tokens — add a `costCents` calculation using a pricing table:

```typescript
const PRICING_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 300, output: 1500 },
  "claude-opus-4-20250514": { input: 1500, output: 7500 },
  "claude-haiku-4-5-20251001": { input: 80, output: 400 },
  "llama-3.3-70b-versatile": { input: 59, output: 79 },
  "gemini-2.0-flash": { input: 10, output: 40 },
  // Add others as needed
};
```

The agent server's queue plugin or a Fastify hook should listen for these events and call `recordCost()`.

---

## 3. Cost Analytics API Routes

**File:** `apps/agent-server/src/routes/cost-analytics.ts` (new)

| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/costs/summary` | Aggregated costs with `?from=&to=&groupBy=provider\|model\|day\|taskCategory` |
| `GET /api/analytics/costs/daily` | Daily cost totals for the last 30 days (chart data) |
| `GET /api/analytics/costs/by-goal/:id` | Cost breakdown for a specific goal |
| `GET /api/analytics/costs/budget` | Current spend vs budget (`DAILY_TOKEN_LIMIT` env var, converted to dollars) |

Register the routes in `server.ts`.

---

## 4. ApiClient Methods

**File:** `packages/api-client/src/client.ts`

Add:
- `getCostSummary(params)` → `GET /api/analytics/costs/summary`
- `getDailyCosts()` → `GET /api/analytics/costs/daily`
- `getCostByGoal(goalId)` → `GET /api/analytics/costs/by-goal/:id`
- `getCostBudget()` → `GET /api/analytics/costs/budget`

Add corresponding types in `packages/api-client/src/types.ts`.

---

## 5. Dashboard: Cost Analytics Page

**File:** `apps/dashboard/src/routes/cost-analytics.tsx` (new)

Layout:
- **Top row**: 4 stat cards — Today's Cost, This Week, This Month, Budget Remaining
- **Chart**: Line chart of daily costs over last 30 days (use recharts or a simple SVG — check what the dashboard already uses for charts)
- **Breakdown table**: Costs grouped by provider, sortable columns (provider, requests, tokens, cost)
- **Goal costs**: Optional section showing top 5 most expensive goals

Add the route to React Router in `app.tsx` and a nav link in the sidebar.

---

## 6. WebSocket Integration

**File:** `apps/agent-server/src/plugins/ws-emitter.ts`

Add a `costs` channel. When a new cost record is written, broadcast an invalidation so the dashboard auto-refreshes cost data without polling.

---

## 7. Tests

Write tests for:
- `cost-analytics.test.ts` — route tests (summary, daily, by-goal, budget endpoints)
- `cost-records.test.ts` — repository function tests
- Dashboard: component test for the cost analytics page (renders stat cards, handles loading/error)

Follow existing test patterns — mock `@ai-cofounder/db` with `mockDbModule()`, use `buildServer()` + `app.inject()` for route tests.

---

## Verification

1. **Build**: `npm run build` — all packages compile
2. **Tests**: `npm run test` — all tests pass including new ones
3. **Schema**: `npm run db:push` — new table created
4. **Manual — API**: `curl http://localhost:3100/api/analytics/costs/daily` returns JSON array
5. **Manual — Dashboard**: Navigate to cost analytics page, see chart + stat cards
6. **Manual — Live data**: Run a goal, verify cost record appears and dashboard updates via WebSocket

## Files to Create/Modify

| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `costRecords` table |
| `packages/db/src/repositories/cost-records.ts` | New — 4 repository functions |
| `packages/db/src/index.ts` | Export new repository functions |
| `packages/llm/src/registry.ts` | Add cost calculation + event emission |
| `apps/agent-server/src/routes/cost-analytics.ts` | New — 4 endpoints |
| `apps/agent-server/src/server.ts` | Register cost analytics routes |
| `packages/api-client/src/client.ts` | Add 4 cost methods |
| `packages/api-client/src/types.ts` | Add cost-related types |
| `apps/dashboard/src/routes/cost-analytics.tsx` | New — cost analytics page |
| `apps/dashboard/src/app.tsx` | Add route |
| `apps/dashboard/src/components/layout/sidebar.tsx` | Add nav link |
| `apps/agent-server/src/plugins/ws-emitter.ts` | Add `costs` channel |
| `apps/agent-server/src/__tests__/cost-analytics.test.ts` | New — route tests |
| `apps/dashboard/src/__tests__/pages/cost-analytics.test.tsx` | New — component tests |
