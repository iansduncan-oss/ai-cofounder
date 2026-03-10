# Phase 9: Autonomy & Approval System - Research

**Researched:** 2026-03-10
**Domain:** Agent tool-tier enforcement, approval gating, real-time notification, dashboard configuration
**Confidence:** HIGH

## Summary

Phase 9 adds a three-tier autonomy layer on top of the existing agent tool infrastructure. The codebase already has solid approval scaffolding — `approvals` table, `createApproval`/`resolveApproval` repo functions, `notifyApprovalCreated` notification service, and a full approval UI in the dashboard — but none of these form a system that intercepts tool execution at the enforcement layer. Today the agent always calls any tool it wants; approval is purely voluntary (the LLM decides when to call `request_approval`).

The new system has three pieces: (1) a `toolTierConfig` DB table that stores per-tool tier assignments (green/yellow/red) and loads at runtime; (2) an enforcement wrapper inside the `tool-executor.ts` shared execution path that checks tier before allowing execution, pauses yellow-tier tools until approval resolves, and hard-blocks red-tier tools; (3) a dashboard settings section for editing the tier map. Approval timeout (auto-deny) is enforced via a configurable TTL on pending approvals combined with a BullMQ scheduled job or a Redis key expiry.

The critical implementation detail is WHERE in the call stack to intercept. The right insertion point is `executeSharedTool` in `tool-executor.ts` plus the `executeToolInner` switch in `orchestrator.ts` — both paths must check tier. The `buildSharedToolList` function already accepts an `exclude` set; the red-tier suppression can build on that by stripping red-tier tools from the list before they are ever offered to the LLM.

**Primary recommendation:** Add a `AutonomyTierService` (singleton loaded once at startup, live-reloadable via a Redis key or DB re-read) that wraps `executeSharedTool` and `executeToolInner` — green passes through, yellow creates an approval record and polls until resolved or timed out, red returns an error string immediately with no DB write.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AUTO-01 | Green tier tools execute immediately with no approval gate | Tool list filtering already exists (`buildSharedToolList`); green = current default behavior |
| AUTO-02 | Yellow tier tools block agent until Slack/Discord approve/deny delivered within 2s | `notifyApprovalCreated` sends Slack block with Approve/Reject buttons; need polling loop in executor |
| AUTO-03 | Red tier tools refused with explanation; no execution path | Strip from tool list before LLM sees them (`buildSharedToolList` exclude set) + hard block in executor switch |
| AUTO-04 | Approval requests delivered via Slack/Discord with full context and one-tap buttons | `NotificationService.notifyApprovalCreated` already sends interactive Slack blocks; needs context enrichment |
| AUTO-05 | Tier assignments configurable per-tool from dashboard settings page | New `toolTierConfig` DB table + REST endpoints + dashboard settings UI section |
</phase_requirements>

---

## Standard Stack

### Core (all already in the codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | existing | `toolTierConfig` table schema + queries | Already used for all DB tables |
| Fastify | existing | New REST endpoints for tier CRUD | All routes are Fastify plugins |
| BullMQ | existing | Scheduled job to auto-expire timed-out approvals | Already used for queue/scheduler |
| `@ai-cofounder/shared` | existing | `createLogger`, `optionalEnv` | Project-standard logging/config |
| React + TanStack Query | existing (dashboard) | Tier configuration UI + live updates | Dashboard stack throughout |
| TypeBox | existing | Fastify schema validation for new routes | All existing routes use TypeBox |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Redis (via BullMQ connection) | existing | Pub/sub for approval resolution wake-up | Optional optimization to avoid DB polling |
| `packages/test-utils` `mockDbModule()` | existing | Add new mock fns for tier config | Required by all agent-server tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB-backed tier config table | In-memory JSON config file | DB is correct — auto-reloads on update, survives restart, dashboard-editable |
| Polling DB for approval resolution | Redis pub/sub wake-up | Polling is simpler, 1-2s latency is acceptable per requirements; pub/sub adds complexity |
| BullMQ delayed job for timeout | `setTimeout` in-process | BullMQ survives restarts; in-process timers do not. Use BullMQ. |

**Installation:** No new packages needed — all dependencies already exist.

---

## Architecture Patterns

### Recommended Project Structure (new files)
```
packages/db/src/
  schema.ts                    # Add toolTierConfig table
  repositories.ts              # Add 5 tier config repo functions

apps/agent-server/src/
  services/
    autonomy-tier.ts           # AutonomyTierService: load, check, cache
  agents/
    tool-executor.ts           # Modify: tier check wrapper before executeSharedTool
    orchestrator.ts            # Modify: tier check before executeToolInner, red-tier strip from list
  routes/
    autonomy.ts                # New: GET/PUT /api/autonomy/tiers
  __tests__/
    autonomy-tier.test.ts      # Service unit tests
    autonomy-routes.test.ts    # Route integration tests

apps/dashboard/src/
  routes/
    settings.tsx               # Extend: add Autonomy Tiers section
  api/
    queries.ts                 # Add useToolTierConfig query
    mutations.ts               # Add useUpdateToolTier mutation
```

### Pattern 1: AutonomyTierService (Singleton, Live-Reloadable)
**What:** Service that loads tier assignments from DB at startup, caches in-memory, and refreshes on demand (called when REST PUT resolves).
**When to use:** Called at every tool execution; must be fast (in-memory read after initial load).

```typescript
// Source: project pattern — same as NotificationService singleton style

export type AutonomyTier = "green" | "yellow" | "red";

export interface ToolTierConfig {
  toolName: string;
  tier: AutonomyTier;
  timeoutMs: number;  // for yellow tier; default 300000 (5 min)
  updatedAt: Date;
}

export class AutonomyTierService {
  private tiers: Map<string, ToolTierConfig> = new Map();
  private loaded = false;

  constructor(private db: Db) {}

  async load(): Promise<void> {
    const rows = await listToolTierConfigs(this.db);
    this.tiers.clear();
    for (const row of rows) {
      this.tiers.set(row.toolName, row);
    }
    this.loaded = true;
  }

  getTier(toolName: string): AutonomyTier {
    // Default green if not configured
    return this.tiers.get(toolName)?.tier ?? "green";
  }

  getTimeoutMs(toolName: string): number {
    return this.tiers.get(toolName)?.timeoutMs ?? 300_000;
  }

  async reload(): Promise<void> {
    await this.load();
  }
}
```

### Pattern 2: Tier Enforcement in Tool Executor
**What:** Wrap `executeSharedTool` and `executeToolInner` with a tier check before any execution occurs.
**When to use:** Every tool execution — green passes through, yellow blocks, red refuses.

```typescript
// Source: project pattern — tool-executor.ts executeSharedTool

export async function executeWithTierCheck(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
  tierService: AutonomyTierService,
): Promise<unknown> {
  const tier = tierService.getTier(block.name);

  if (tier === "red") {
    return {
      error: `Tool "${block.name}" is in the red tier and cannot be executed without explicit human authorization. ` +
             `This operation has been blocked for safety.`
    };
  }

  if (tier === "yellow") {
    return await executeYellowTierTool(block, services, context, tierService);
  }

  // green — execute immediately
  return executeSharedTool(block, services, context);
}
```

### Pattern 3: Yellow Tier Approval Flow
**What:** Create approval record, notify Slack/Discord, poll DB until resolved or timeout.
**When to use:** Any yellow-tier tool call from the agent.

```typescript
// Source: project pattern — combines existing createApproval + notifyApprovalCreated

async function executeYellowTierTool(
  block: LlmToolUseContent,
  services: ToolExecutorServices,
  context: ToolExecutorContext,
  tierService: AutonomyTierService,
): Promise<unknown> {
  if (!services.db) {
    return { error: "Database not available for approval tracking" };
  }

  const approval = await createApproval(services.db, {
    taskId: context.goalId ?? context.conversationId,  // best available ID
    requestedBy: (context.agentRole ?? "orchestrator") as AgentRole,
    reason: `Tool "${block.name}" requested by agent with input: ${JSON.stringify(block.input).slice(0, 200)}`,
  });

  // Deliver notification — must arrive within 2s (AUTO-04)
  await notifyApprovalCreated({
    approvalId: approval.id,
    taskId: approval.taskId,
    reason: approval.reason,
    requestedBy: approval.requestedBy,
  });

  // Poll until approved/rejected/timeout
  const timeoutMs = tierService.getTimeoutMs(block.name);
  const deadline = Date.now() + timeoutMs;
  const POLL_INTERVAL_MS = 2000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const current = await getApproval(services.db, approval.id);
    if (current?.status === "approved") {
      return executeSharedTool(block, services, context);
    }
    if (current?.status === "rejected") {
      return { error: `Execution denied: ${current.decision ?? "Rejected by user"}` };
    }
  }

  // Auto-deny on timeout
  await resolveApproval(services.db, approval.id, "rejected", "Auto-denied: approval timeout exceeded", undefined);
  return { error: `Execution timed out after ${timeoutMs / 1000}s — approval was not received in time.` };
}
```

### Pattern 4: Red Tier — Strip from Tool List
**What:** Red-tier tools are excluded from the tool list before the LLM ever sees them, preventing the LLM from even attempting to call them.
**When to use:** `buildSharedToolList` call in orchestrator and subagent runner.

```typescript
// Source: project pattern — buildSharedToolList already supports exclude set

// In orchestrator.ts / subagent runner:
const redTierTools = new Set(
  tierService.getAllRed()  // returns string[]
);

const tools = buildSharedToolList(services, redTierTools);
```

This provides defense-in-depth: even if the enforcement wrapper somehow fails, the LLM cannot produce a tool call for a red-tier tool because it is not in the schema.

### Pattern 5: DB Schema for Tier Config
**What:** New table `tool_tier_config` — per-tool tier assignment with defaults.

```typescript
// Source: project pattern — follows schema.ts conventions

export const autonomyTierEnum = pgEnum("autonomy_tier", ["green", "yellow", "red"]);

export const toolTierConfig = pgTable("tool_tier_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolName: text("tool_name").notNull().unique(),
  tier: autonomyTierEnum("tier").notNull().default("green"),
  timeoutMs: integer("timeout_ms").notNull().default(300_000), // 5 min default
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Pattern 6: Dashboard Tier Configuration UI
**What:** Extend `settings.tsx` with a new section: a table of tools with a tier selector (green/yellow/red) per row. Saves via `PATCH /api/autonomy/tiers/:toolName`.

```typescript
// Source: project pattern — follows settings.tsx Card pattern + existing approvals.tsx mutation pattern

// api/queries.ts — add:
export function useToolTierConfig() {
  return useQuery({
    queryKey: ["toolTierConfig"],
    queryFn: () => apiClient.listToolTierConfig(),
  });
}

// api/mutations.ts — add:
export function useUpdateToolTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { toolName: string; tier: "green" | "yellow" | "red" }) =>
      apiClient.updateToolTier(data.toolName, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["toolTierConfig"] }),
  });
}
```

### Anti-Patterns to Avoid
- **Checking tier only in the LLM prompt:** Relying on the system prompt to say "don't use red tools" is not enforcement — it is a suggestion. The tier check must be in `executeSharedTool`/`executeToolInner`.
- **Polling too frequently:** A 500ms poll in yellow tier will hammer the DB. Use 2000ms intervals — still fast enough for responsive UX.
- **Using `approvals.taskId` strictly:** The existing schema requires `task_id` to reference a `tasks.id`. Yellow-tier enforcement can fire outside of goal execution context where no `task_id` exists. Solutions: (a) make `taskId` nullable in the `approvals` table, or (b) use a synthetic/placeholder task record for ad-hoc approvals. Option (a) is cleaner — a schema migration is needed.
- **Auto-reload race condition:** If two requests reload tier config simultaneously, use a mutex or a `loading` promise chain to avoid double-reads.
- **Missing default tiers for new tools:** Seed the `toolTierConfig` table with a default record for all known tools at migration time so the dashboard shows them without requiring manual entry.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Approval delivery | Custom webhook/email delivery | `NotificationService.notifyApprovalCreated` | Already sends Slack blocks with Approve/Reject buttons; just needs to be called in yellow enforcement path |
| Approval CRUD | Custom approval storage | Existing `approvals` table + `createApproval`/`resolveApproval`/`getApproval` | 5 repo functions already implemented |
| Timeout job scheduling | `setTimeout` in process | BullMQ delayed job (existing `packages/queue`) | Process restart kills in-memory timers; BullMQ persists across restarts |
| Tier config persistence | JSON file / env var config | `toolTierConfig` DB table | Dashboard-editable, survives restart, per-tool granularity |
| Dashboard form validation | Manual validation | TypeBox + TanStack Form (or simple controlled inputs with disabled state) | Consistent with existing forms in dashboard |

**Key insight:** 80% of the implementation surface already exists — this phase is wiring, not building. The core new work is `AutonomyTierService` + the enforcement interceptor + the DB table + the settings UI section.

---

## Common Pitfalls

### Pitfall 1: `approvals.taskId` NOT NULL Constraint Blocks Yellow Tier
**What goes wrong:** `tool_tier_config` yellow enforcement fires during a direct agent `run()` call (not inside goal execution), so there is no valid `task_id` to pass to `createApproval`.
**Why it happens:** The existing `approvals.taskId` column has `notNull()` referencing `tasks.id`. A bare orchestrator run that triggers a yellow-tier tool has no task.
**How to avoid:** Add a DB migration making `approvals.taskId` nullable. Also update repo types. This is a required schema change for this phase.
**Warning signs:** TypeScript errors on `createApproval` call in enforcement path with no task context.

### Pitfall 2: Yellow-Tier Polling Blocks the Fastify Event Loop
**What goes wrong:** The approval poll loop (`while (Date.now() < deadline)`) runs inside an async Fastify request handler. If the timeout is 5 minutes, the HTTP request hangs for up to 5 minutes.
**Why it happens:** Fastify routes are async but the HTTP connection stays open while the approval waits.
**How to avoid:** For the interactive orchestrator (`/api/agents/run`), return immediately with an `approval_pending` response and let the user re-trigger after approving. For autonomous sessions (dispatcher), the polling loop is fine because it runs in a BullMQ worker context with no HTTP connection.
**Warning signs:** Client timeout errors or Fastify `requestTimeout` fires on long-running agent calls.

### Pitfall 3: Red-Tier Tools Appear in LLM Suggestions If Not Stripped
**What goes wrong:** If only the enforcement layer blocks red tools (not the tool list), the LLM still suggests them in plans/responses since it knows they exist from context. The enforcement layer returns an error, the LLM apologizes, the UX is awkward.
**Why it happens:** The LLM generates tool calls based on the tool list passed to `registry.complete()`.
**How to avoid:** Strip red-tier tools from `buildSharedToolList` result BEFORE passing to `registry.complete()`. Use the existing `exclude` parameter. This gives defense-in-depth and clean UX.
**Warning signs:** Agent says "I tried to use git_push but it was blocked" instead of never attempting it.

### Pitfall 4: Tier Config Not Seeded — Settings Page Shows Empty Table
**What goes wrong:** The `toolTierConfig` table starts empty. The dashboard settings page shows nothing. Users don't know what tools exist.
**Why it happens:** No seed migration for the well-known tool list.
**How to avoid:** Include a seed migration that inserts all known tool names with tier `green` as default. Tools: `search_web`, `browse_web`, `save_memory`, `recall_memories`, `execute_code`, `read_file`, `write_file`, `delete_file`, `delete_directory`, `list_directory`, `git_clone`, `git_status`, `git_diff`, `git_add`, `git_commit`, `git_log`, `git_pull`, `git_branch`, `git_checkout`, `git_push`, `run_tests`, `create_pr`, `trigger_workflow`, `create_schedule`, `delete_schedule`.
**Warning signs:** Settings page loads but tier table is empty.

### Pitfall 5: `AutonomyTierService` Not Injected Into `buildServer`
**What goes wrong:** The tier service is created but never wired into the tool executor or orchestrator constructor.
**Why it happens:** Adding a new service requires threading it through `buildServer` → orchestrator constructor → `executeSharedTool` call → `buildSharedToolList` call.
**How to avoid:** Follow the same injection pattern as `NotificationService` and `WorkspaceService` — optional field on `ToolExecutorServices`, passed through all call sites.
**Warning signs:** Tier checks silently default to "green" for all tools even when red/yellow are configured.

### Pitfall 6: Approval Timeout Not Enforced When Server Restarts
**What goes wrong:** A yellow-tier approval was created at T=0 with a 5-minute timeout. The server restarts at T=3min. The timeout job is lost; the approval stays pending forever.
**Why it happens:** In-process `setTimeout` does not survive restarts.
**How to avoid:** Use a BullMQ delayed job (enqueue at approval creation time with a delay equal to `timeoutMs`). The job auto-denies the approval if it is still pending when it fires. Alternatively, a periodic sweep job (every 60s) that auto-denies all approvals past their `createdAt + timeoutMs` deadline is equally effective and simpler. Use the sweep approach — it requires no per-approval job creation.
**Warning signs:** Old pending approvals visible in dashboard with no expiry.

---

## Code Examples

Verified patterns from project source:

### Existing `createApproval` Signature
```typescript
// Source: packages/db/src/repositories.ts line 314
export async function createApproval(
  db: Db,
  data: {
    taskId: string;          // NOTE: needs to become optional (see Pitfall 1)
    requestedBy: AgentRole;
    reason: string;
  },
)
```

### Existing `notifyApprovalCreated` — Already Has Slack Buttons
```typescript
// Source: apps/agent-server/src/services/notifications.ts line 71
async notifyApprovalCreated(approval: ApprovalNotification): Promise<void>
// Sends:
// - Slack: header + section with reason + actions block with "Approve"/"Reject" buttons
// - Discord: embed with yellow color
// action_id: "approval_approve" / "approval_reject"
// value: approval.approvalId
// Already includes: /approve <id> fallback text
```

### Existing `buildSharedToolList` With Exclusion
```typescript
// Source: apps/agent-server/src/agents/tool-executor.ts line 94
export function buildSharedToolList(
  services: ToolExecutorServices,
  exclude?: Set<string>,
): LlmTool[]
// Usage: pass Set of red-tier tool names as the exclude parameter
```

### BullMQ Delayed Job Pattern (for timeout sweep)
```typescript
// Source: packages/queue/src/workers.ts and scheduler.ts patterns
// Add to scheduler: a recurring job every 60s to auto-expire timed-out approvals
// Job: query approvals WHERE status='pending' AND (createdAt + timeout_ms) < NOW()
// Action: resolveApproval(db, id, "rejected", "Auto-denied: timeout exceeded")
```

### Dashboard Tier Badge Pattern
```typescript
// Source: apps/dashboard/src/routes/approvals.tsx — uses ApprovalStatusBadge
// For tiers, use a colored Badge variant:
// green → variant="success"
// yellow → variant="warning"
// red → variant="destructive"
// Use <Select> or <DropdownMenu> for editing (consistent with existing settings.tsx patterns)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual `request_approval` tool call by LLM | Automatic tier enforcement in executor | Phase 9 | Approval is now mandatory for yellow/red, not LLM-discretionary |
| No red-tier concept | Hard block in executor + strip from tool list | Phase 9 | Red-tier tools literally cannot execute — no code path |
| Static tool availability | Per-tool configurable tiers via DB + dashboard | Phase 9 | Operator can tune autonomy without code changes |

**Deprecated/outdated after this phase:**
- Manual LLM-initiated `request_approval` tool: Still useful as an explicit override, but the enforcement layer makes it redundant for the yellow-tier tools that auto-gate.

---

## Open Questions

1. **Should `approvals.taskId` become nullable or should we create a synthetic task record?**
   - What we know: Column is `notNull()` with FK to `tasks.id`. Yellow-tier tools can fire outside goal context.
   - What's unclear: Whether downstream queries depend on `taskId` always being valid.
   - Recommendation: Make `taskId` nullable in a schema migration. It's a simpler change than synthetic task records, and `getApproval` / `resolveApproval` don't join on `tasks`.

2. **How long should the default yellow-tier timeout be?**
   - What we know: Requirements say "configurable period." No default specified.
   - Recommendation: Default 300,000ms (5 minutes) per tool. Override per-tool in `toolTierConfig.timeoutMs`. Expose in dashboard settings.

3. **Should tier changes from the dashboard take effect immediately (in-memory reload) or require agent restart?**
   - Requirements say: "Tier config changes from dashboard take effect immediately" (AUTO-05 success criterion).
   - Recommendation: After `PUT /api/autonomy/tiers/:toolName`, the route handler calls `autonomyTierService.reload()` directly. Because the service is a singleton injected into the server, the in-memory cache is updated for all subsequent tool calls.

4. **Does the Slack bot need to handle `approval_approve`/`approval_reject` interactive component callbacks?**
   - What we know: The Slack notification already sends interactive blocks with `action_id: "approval_approve"` and `action_id: "approval_reject"`. But the Slack bot needs a Bolt `action()` handler wired to call `client.resolveApproval()` for the button clicks to actually work.
   - What's unclear: Whether the current Slack bot has interactive component handling set up.
   - Recommendation: Check `apps/slack-bot/src/index.ts` for `app.action()` registration. If absent, add action handlers for `approval_approve` and `approval_reject`. This is needed for AUTO-04 one-tap approval to function.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.x (root `vitest.config.ts`) |
| Config file | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="autonomy"` |
| Full suite command | `npm run test` |
| Estimated runtime | ~45 seconds full suite; ~8 seconds for autonomy-only |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTO-01 | Green-tier tool executes immediately with no delay | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-tier"` | Wave 0 gap |
| AUTO-02 | Yellow-tier tool blocks, approval delivered via Slack within 2s, resumes on approve | unit + integration | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-tier"` | Wave 0 gap |
| AUTO-03 | Red-tier tool returns error, no execution occurs | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-tier"` | Wave 0 gap |
| AUTO-04 | Approval notification includes tool name, input context, approve/deny buttons | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-routes"` | Wave 0 gap |
| AUTO-05 | Tier config CRUD endpoints work; dashboard reload takes effect immediately | integration | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-routes"` | Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy"`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~8 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `apps/agent-server/src/__tests__/autonomy-tier.test.ts` — covers AUTO-01, AUTO-02, AUTO-03 (AutonomyTierService unit tests)
- [ ] `apps/agent-server/src/__tests__/autonomy-routes.test.ts` — covers AUTO-04, AUTO-05 (route integration tests)
- [ ] `packages/test-utils/src/mocks/db.ts` — add `listToolTierConfigs`, `upsertToolTierConfig`, `getToolTierConfig` to `mockDbModule()`

---

## Sources

### Primary (HIGH confidence)
- `/packages/db/src/schema.ts` — full schema; confirmed `approvals.taskId` is `notNull()` FK
- `/packages/db/src/repositories.ts` — confirmed `createApproval`, `getApproval`, `resolveApproval`, `listPendingApprovals` signatures
- `/apps/agent-server/src/agents/tool-executor.ts` — confirmed `buildSharedToolList` with exclude set, `executeSharedTool` structure
- `/apps/agent-server/src/agents/orchestrator.ts` — confirmed `executeToolInner` switch pattern, `request_approval` case
- `/apps/agent-server/src/services/notifications.ts` — confirmed `notifyApprovalCreated` sends Slack interactive blocks with `approval_approve`/`approval_reject` action IDs
- `/apps/agent-server/src/agents/dispatcher.ts` — confirmed approval check before task execution (`listPendingApprovalsForTasks`)
- `/apps/dashboard/src/routes/settings.tsx` — confirmed settings page pattern (Card sections)
- `/apps/dashboard/src/routes/approvals.tsx` — confirmed dashboard resolve pattern using `useResolveApproval` mutation
- `/packages/api-client/src/client.ts` — confirmed `resolveApproval` API client method

### Secondary (MEDIUM confidence)
- `/apps/slack-bot/src/commands.ts` — reviewed; no `app.action()` handlers present → Slack interactive button handling is unimplemented (needs to be added)
- `/packages/queue/src/scheduler.ts` — sweep job pattern for auto-expiry confirmed via BullMQ existing job structure

### Tertiary (LOW confidence)
- None — all critical claims verified from source files.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all stack elements verified from existing source
- Architecture: HIGH — enforcement pattern derived from reading actual execution paths in source
- Pitfalls: HIGH — `taskId` nullability issue confirmed from schema; polling concern confirmed from Fastify request handler pattern

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (30 days — stable codebase, no fast-moving external dependencies)
