# Priority 2: Phase 6 — Smart Task Permissions

Give the agent a "proposed" workflow so it can suggest actions that require human approval before executing. This is the core of making v3.1 a "Real Assistant" — the agent proposes, the human approves.

## Context

Read these files first:
- `.claude/primer.md` — current state
- `packages/db/src/schema.ts` — current goal/task status enums
- `apps/agent-server/src/agents/dispatcher.ts` — task execution flow
- `apps/agent-server/src/services/notifications.ts` — existing notification patterns
- `apps/agent-server/src/routes/approvals.ts` — existing approval system

## Phase 6 Scope

### 6.1 "Proposed" Goal Status (DB Migration)

1. Add `"proposed"` to the `goal_status` enum in schema
2. Generate migration (next number after existing ones)
3. Add `scope` column to goals: `"read_only" | "local" | "external" | "destructive"` — classifies what the goal will do
4. Add `requires_approval` boolean to goals (default false)
5. Push migration, verify it applies cleanly

### 6.2 Scope Classification

1. Create `classifyGoalScope()` utility in orchestrator or a new `services/scope.ts`
2. Analyze the plan's tools against tool tiers (green/yellow/red from tool-executor)
   - All green tools → `read_only` or `local`
   - Any yellow tools → `external`
   - Any red tools → `destructive`
3. Goals with `external` or `destructive` scope auto-set `requires_approval = true`
4. Wire into `create_plan` tool — after plan creation, classify and potentially mark as proposed

### 6.3 Approval Notification Flow

1. When a goal is created with `requires_approval = true`:
   - Set status to `proposed` instead of `pending`
   - Send notification via existing NotificationService (Slack/Discord)
   - Include: goal description, scope classification, tool list, estimated cost
2. Add `POST /api/goals/:id/approve` and `POST /api/goals/:id/reject` endpoints
3. On approve: transition `proposed` → `pending`, start execution
4. On reject: transition `proposed` → `cancelled`, notify agent
5. Dashboard: show proposed goals with approve/reject buttons (yellow badge)

### 6.4 Tests

- Scope classification: verify tool tier → scope mapping
- Proposed flow: create goal → verify proposed status → approve → verify pending
- Rejection flow: create goal → reject → verify cancelled
- Notification: verify approval request sent on proposed goals
- Dashboard: verify proposed goals render with action buttons

## Done When

- `proposed` status works end-to-end (create → notify → approve/reject → execute/cancel)
- Scope classification correctly categorizes goals by tool risk
- Notifications fire for proposed goals
- Dashboard shows proposed goals with approve/reject UI
- All new + existing tests pass
