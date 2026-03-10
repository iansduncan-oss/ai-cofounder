# Phase 10: Autonomous Execution Engine - Research

**Researched:** 2026-03-10
**Domain:** Autonomous goal-driven task execution with git workflow, work log, and SSE streaming
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-01 | Agent picks up tasks from the goal backlog and executes them without requiring a human trigger | `runAutonomousSession()` already exists; gap is the "goal backlog" DB query and the wiring to `dispatcher.runGoal()` from that session |
| TERM-02 | Agent chains workspace, git, and sandbox tools to complete coding tasks end-to-end (read code → edit → test → commit) | All tools exist in `tool-executor.ts`; `WorkspaceService` implements all git ops; gap is orchestrator system prompt guidance for the sequence and CoderAgent writing files to disk |
| TERM-03 | Agent commits changes with conventional commit messages that link back to the originating goal/task | `git_commit` tool exists; gap is enriching the commit tool schema with `goalId`/`taskId` fields and enforcing conventional format via a utility function |
| TERM-04 | Agent creates PRs for completed work with auto-generated descriptions summarizing changes | `create_pr` tool + `executeCreatePr()` exist; gap is LLM-generated PR body that summarizes task outputs and links goal |
| TERM-05 | Each execution produces a structured work log entry (task, actions taken, outcome, duration, token cost) | `workSessions` table + `createWorkSession`/`completeWorkSession` repos exist; gap is enriching `actionsTaken` JSONB with per-task detail and pulling cost from `recordLlmUsage` |
</phase_requirements>

---

## Summary

Phase 10 adds the autonomous execution layer on top of the solid foundation built in Phases 8 and 9. The core goal-execution machinery already exists: `TaskDispatcher.runGoal()` walks goal tasks sequentially, each task invokes a specialist agent, and the BullMQ worker publishes progress events via Redis pub/sub to an SSE endpoint the dashboard listens to. `WorkspaceService` implements all git operations (clone, branch, add, commit, push). The `create_pr` tool calls the GitHub API. `workSessions` records autonomous execution context. All tools are tier-aware via `AutonomyTierService`.

What Phase 10 adds is the missing connective tissue: (1) a DB query that retrieves "ready to execute" goals from the backlog so `runAutonomousSession()` can pick one up deterministically rather than having the LLM guess, (2) conventional commit message enforcement with goal/task ID linkage, (3) enriched work log entries that record per-action detail and token cost, and (4) an `AutonomousExecutorService` that orchestrates the full read-edit-test-commit-PR sequence as a deterministic flow rather than relying on the orchestrator's freeform tool loop.

The key design decision is to build a deterministic `AutonomousExecutorService` (not a freeform LLM tool loop) that takes a goal, runs its tasks via the dispatcher, and then chains workspace ops (commit, PR) based on task outputs. This is more reliable than asking the LLM orchestrator to remember to commit after every coding task. The existing SSE streaming infrastructure (`GET /api/goals/:id/execute/stream`) handles real-time dashboard visibility without any new work.

**Primary recommendation:** Build `AutonomousExecutorService` as a thin wrapper around `TaskDispatcher.runGoal()` that adds conventional commit enforcement, PR description generation, and enriched work log writing. Wire it to `runAutonomousSession()` via a new `listGoalBacklog()` DB query.

---

## Standard Stack

### Core (all already in the project — verified by source inspection)

| Library/Module | Where | Purpose | Status |
|----------------|-------|---------|--------|
| `TaskDispatcher` | `agents/dispatcher.ts` | Runs goal tasks via specialist agents | EXISTS — wrap it |
| `WorkspaceService` | `services/workspace.ts` | All 10 git operations + file I/O | EXISTS — call directly |
| `executeCreatePr()` | `agents/tools/github-tools.ts` | GitHub PR REST API call | EXISTS — call directly |
| `workSessions` table | `packages/db/src/schema.ts` | Records autonomous session with JSONB actionsTaken | EXISTS — enrich |
| `createWorkSession` / `completeWorkSession` | `packages/db/src/repositories.ts` | Work session lifecycle | EXISTS |
| `recordLlmUsage` | `packages/db/src/repositories.ts` | Per-request token/cost tracking (goalId-linked) | EXISTS |
| `RedisPubSub.publish()` | `packages/queue/src/pubsub.ts` | Publishes progress events for SSE | EXISTS |
| `enqueueAgentTask()` | `packages/queue/src/helpers.ts` | BullMQ job enqueue | EXISTS |
| `runAutonomousSession()` | `autonomous-session.ts` | Session lifecycle + budget tracking | EXISTS — extend |

### New Components Required

| Component | Type | Purpose |
|-----------|------|---------|
| `AutonomousExecutorService` | New service | Deterministic execute-commit-PR flow |
| `listGoalBacklog()` | New DB repository function | Fetch "ready" goals sorted by priority, filtered by pending tasks |
| `buildConventionalCommit()` | New utility function | Format `type(scope): msg [goal:ID]` with length enforcement |
| PR description generator | Method on `AutonomousExecutorService` | LLM call summarizing task outputs → PR body |
| Enriched `actionsTaken` schema | TypeScript interface | Typed JSONB payload for work log entries |
| `POST /api/autonomous/:goalId/run` | New Fastify route | Trigger single goal autonomous execution |
| `GET /api/autonomous/sessions` | New Fastify route | List recent work sessions |
| `GET /api/autonomous/backlog` | New Fastify route | List goals ready for execution |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `AutonomousExecutorService` | Extend `runAutonomousSession()` with git/PR code | `runAutonomousSession()` is already 270 lines; separate class keeps concerns clean |
| Separate `workLogs` table | Extend `workSessions.actionsTaken` JSONB | `actionsTaken` already exists as JSONB array — avoids migration, Phase 12 reads from it |
| Prompt-only conventional commit enforcement | `buildConventionalCommit()` utility | LLM may drift from format; utility guarantees format every time |
| New SSE endpoint | Reuse `GET /api/goals/:id/execute/stream` | Stream endpoint already handles pub/sub, history replay, cleanup — no new work needed |

**Installation:** No new npm packages required. All dependencies already in the project.

---

## Architecture Patterns

### Recommended Project Structure

```
apps/agent-server/src/
├── services/
│   └── autonomous-executor.ts    # NEW: AutonomousExecutorService + buildConventionalCommit
├── routes/
│   └── autonomous.ts             # NEW: backlog, sessions, run endpoints
packages/db/src/
├── repositories.ts               # EXTEND: add listGoalBacklog()
packages/test-utils/src/mocks/
├── db.ts                         # EXTEND: add listGoalBacklog mock to mockDbModule()
```

### Pattern 1: Goal Backlog Query

**What:** DB query returning active goals with pending tasks and no running tasks, ordered by priority then staleness.

**When to use:** Called at the start of `runAutonomousSession()` to deterministically pick the highest-priority ready goal.

**Example:**
```typescript
// New function in packages/db/src/repositories.ts
// Source: derived from existing listActiveGoals() pattern
export async function listGoalBacklog(db: Db, limit = 5) {
  return db
    .select({
      id: goals.id,
      title: goals.title,
      description: goals.description,
      status: goals.status,
      priority: goals.priority,
      createdAt: goals.createdAt,
      updatedAt: goals.updatedAt,
      taskCount: sql<number>`count(${tasks.id})::int`.as("task_count"),
      pendingTaskCount: sql<number>`count(case when ${tasks.status} = 'pending' then 1 end)::int`.as("pending_task_count"),
    })
    .from(goals)
    .leftJoin(tasks, eq(tasks.goalId, goals.id))
    .where(eq(goals.status, "active"))
    .groupBy(goals.id)
    .having(
      and(
        gt(sql<number>`count(case when ${tasks.status} = 'pending' then 1 end)::int`, 0),
        eq(sql<number>`count(case when ${tasks.status} = 'running' then 1 end)::int`, 0),
      ),
    )
    .orderBy(
      sql`case ${goals.priority}
        when 'critical' then 1
        when 'high' then 2
        when 'medium' then 3
        else 4
      end`,
      asc(goals.updatedAt),
    )
    .limit(limit);
}
```

### Pattern 2: AutonomousExecutorService

**What:** Service wrapping `TaskDispatcher.runGoal()` that adds git workflow and enriched work log.

**When to use:** Called from `runAutonomousSession()` and from the new `/api/autonomous/:goalId/run` route.

**Example:**
```typescript
// apps/agent-server/src/services/autonomous-executor.ts
export class AutonomousExecutorService {
  constructor(
    private dispatcher: TaskDispatcher,
    private workspaceService: WorkspaceService | undefined,
    private db: Db,
    private registry: LlmRegistry,
  ) {}

  async executeGoal(opts: {
    goalId: string;
    userId?: string;
    workSessionId: string;
    repoDir?: string;
    createPr?: boolean;
    onProgress?: TaskProgressCallback;
  }): Promise<{ progress: DispatcherProgress; actions: WorkLogAction[] }> {
    const startTime = Date.now();
    const actions: WorkLogAction[] = [];

    // 1. Create feature branch if repo provided
    if (this.workspaceService && opts.repoDir) {
      const branchName = `autonomous/${opts.goalId.slice(0, 8)}`;
      await this.workspaceService.gitCheckout(opts.repoDir, branchName, true);
      actions.push({ type: "git_branch", timestamp: Date.now(), message: `Created branch ${branchName}` });
    }

    // 2. Run goal tasks via dispatcher
    const progress = await this.dispatcher.runGoal(opts.goalId, opts.userId, async (event) => {
      actions.push({
        type: "task_progress",
        timestamp: Date.now(),
        taskId: event.taskId,
        taskTitle: event.taskTitle,
        agent: event.agent,
        status: event.status,
        output: event.output?.slice(0, 500),
      });
      await opts.onProgress?.(event);
    });

    // 3. Commit + PR if workspace provided and tasks completed
    if (this.workspaceService && opts.repoDir && progress.status === "completed") {
      await this.commitAndOptionalPr(opts, progress, actions);
    }

    return { progress, actions };
  }

  private async commitAndOptionalPr(
    opts: Parameters<AutonomousExecutorService["executeGoal"]>[0],
    progress: DispatcherProgress,
    actions: WorkLogAction[],
  ): Promise<void> {
    const goal = await getGoal(this.db, opts.goalId);
    const branchName = `autonomous/${opts.goalId.slice(0, 8)}`;
    const commitMsg = buildConventionalCommit({
      type: "feat",
      description: goal?.title ?? "autonomous task",
      goalId: opts.goalId,
    });

    const statusResult = await this.workspaceService!.gitStatus(opts.repoDir!);
    if (statusResult.stdout.trim() === "") {
      actions.push({ type: "git_commit", timestamp: Date.now(), message: "Nothing to commit — skipped" });
      return;
    }

    await this.workspaceService!.gitAdd(opts.repoDir!, ["."]);
    actions.push({ type: "git_add", timestamp: Date.now() });

    const commitResult = await this.workspaceService!.gitCommit(opts.repoDir!, commitMsg);
    actions.push({ type: "git_commit", timestamp: Date.now(), message: commitMsg, result: commitResult });

    if (opts.createPr) {
      const pushResult = await this.workspaceService!.gitPush(opts.repoDir!, "origin", branchName);
      actions.push({ type: "git_push", timestamp: Date.now(), result: pushResult });

      const prBody = await this.generatePrDescription(goal?.title ?? "", progress);
      const prResult = await executeCreatePr({
        owner: process.env.GITHUB_REPO_OWNER!,
        repo: process.env.GITHUB_REPO_NAME!,
        title: goal?.title ?? "Autonomous task",
        head: branchName,
        base: "main",
        body: prBody,
      });
      actions.push({ type: "create_pr", timestamp: Date.now(), result: prResult as Record<string, unknown> });
    }
  }

  async generatePrDescription(goalTitle: string, progress: DispatcherProgress): Promise<string> {
    const taskSummaries = progress.tasks
      .filter((t) => t.status === "completed")
      .map((t) => `- **${t.title}** (${t.agent}): ${(t.output ?? "").slice(0, 300)}`)
      .join("\n");

    const response = await this.registry.complete("conversation", {
      system: "You write concise GitHub PR descriptions. Keep under 300 words.",
      messages: [{
        role: "user",
        content: `Write a PR description for: "${goalTitle}"\n\nCompleted tasks:\n${taskSummaries}`,
      }],
      max_tokens: 1024,
    });

    const body = response.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    return `${body}\n\n---\n*Autonomously generated by AI Cofounder*`;
  }
}
```

### Pattern 3: Conventional Commit Utility

**What:** Pure function enforcing conventional commit format with goal/task ID linkage and 72-char subject line limit.

**When to use:** Every autonomous commit goes through this function. Never let the LLM freely format commit messages in autonomous mode.

**Example:**
```typescript
// apps/agent-server/src/services/autonomous-executor.ts
export function buildConventionalCommit(opts: {
  type: "feat" | "fix" | "chore" | "refactor" | "test" | "docs";
  scope?: string;
  description: string;
  goalId: string;
  taskId?: string;
}): string {
  const ref = opts.taskId
    ? `[goal:${opts.goalId.slice(0, 8)} task:${opts.taskId.slice(0, 8)}]`
    : `[goal:${opts.goalId.slice(0, 8)}]`;
  const prefix = opts.scope ? `${opts.type}(${opts.scope}): ` : `${opts.type}: `;
  const maxDescLen = 72 - prefix.length - ref.length - 1; // 1 for space
  const desc = opts.description.length > maxDescLen
    ? `${opts.description.slice(0, maxDescLen - 3)}...`
    : opts.description;
  return `${prefix}${desc} ${ref}`;
}
// Output example: "feat: add user authentication endpoint [goal:abc12345]"
```

### Pattern 4: Work Log Entry Structure

**What:** TypeScript interface for the structured `actionsTaken` JSONB payload in `workSessions`.

**When to use:** Every time `completeWorkSession()` is called from `AutonomousExecutorService`.

**Example:**
```typescript
interface WorkLogAction {
  type: "task_progress" | "git_branch" | "git_add" | "git_commit" | "git_push" | "create_pr" | "error";
  timestamp: number;
  taskId?: string;
  taskTitle?: string;
  agent?: string;
  status?: "started" | "completed" | "failed";
  message?: string;
  result?: Record<string, unknown>;
  output?: string;
}

// Stored in workSessions.actionsTaken as:
// {
//   actions: WorkLogAction[],
//   costSummary: { totalTokens: number, inputTokens: number, outputTokens: number }
// }
```

### Pattern 5: Backlog-Driven runAutonomousSession

**What:** Extension of `runAutonomousSession()` to use `listGoalBacklog()` for deterministic goal pickup.

**When to use:** Replace the freeform LLM context prompt with a deterministic goal pickup when the session trigger is "schedule" or "autonomous".

**Example:**
```typescript
// Extension to apps/agent-server/src/autonomous-session.ts
// Instead of LLM deciding what to work on, pick the top backlog goal:
const backlog = await listGoalBacklog(db, 1);
if (backlog.length === 0) {
  // No ready goals — fall through to LLM contextual session
  return runContextualSession(db, registry, options);
}
const topGoal = backlog[0];

// Create work session
const session = await createWorkSession(db, {
  trigger,
  context: { goalId: topGoal.id, goalTitle: topGoal.title },
});

// Run executor
const executor = new AutonomousExecutorService(dispatcher, workspaceService, db, registry);
const { progress, actions } = await executor.executeGoal({
  goalId: topGoal.id,
  userId: "system-autonomous",
  workSessionId: session.id,
  onProgress: async (event) => {
    await redisPubSub.publish(topGoal.id, { ...event, timestamp: Date.now() });
  },
});
```

### Anti-Patterns to Avoid

- **Freeform LLM commit messages in autonomous mode:** Always use `buildConventionalCommit()`. LLM output varies.
- **Embedding PR creation in TaskDispatcher:** The dispatcher only knows about tasks, not workspace state. Keep git/PR ops in `AutonomousExecutorService`.
- **Yellow-tier blocking in autonomous executor:** `AutonomousExecutorService` calls `workspaceService.gitPush()` and `executeCreatePr()` directly, bypassing the LLM tool-use tier check. This is correct — the tier system governs LLM tool calls, not direct service method calls.
- **Committing without checking git status:** Always run `gitStatus()` first and skip commit if working tree is clean. Avoid "nothing to commit" exit-code-1 errors.
- **Spawning autonomous session without backlog check:** Calling `dispatcher.runGoal()` on a goal that has no pending tasks wastes tokens and marks the goal incorrectly. `listGoalBacklog()` filters these out.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Goal task execution | Custom task runner | `TaskDispatcher.runGoal()` | Already handles retries, parallel groups, approval checks, progress callbacks |
| Git operations | Direct `execFile` calls | `WorkspaceService` methods | Path traversal protection, timeout caps, safe CWD resolution already implemented |
| PR creation | Direct `fetch` to GitHub API | `executeCreatePr()` | Error handling, logging, token injection already implemented |
| Token tracking | Custom counter | `recordLlmUsage()` aggregated by goalId | Already persists per-request with cost attribution |
| SSE streaming | New WebSocket/EventSource | Existing `GET /api/goals/:id/execute/stream` | Redis pub/sub, history replay, cleanup already built |
| BullMQ job dispatch | Blocking HTTP handler | `enqueueAgentTask()` + 202 response | Non-blocking pattern already established in `execution.ts` |
| Test mocking | New mock setup | `mockDbModule()` from `@ai-cofounder/test-utils` | CRITICAL — using Proxy causes ESM hang (see CLAUDE.md) |

**Key insight:** Every individual building block exists. Phase 10 provides the composition layer: `listGoalBacklog()` + `AutonomousExecutorService` + `buildConventionalCommit()` + enriched work log structure.

---

## Common Pitfalls

### Pitfall 1: Goal status collision during concurrent autonomous pickup

**What goes wrong:** Two concurrent sessions pick up the same goal and run it twice.
**Why it happens:** `listGoalBacklog()` reads by status but does not lock the row. Two concurrent reads return the same top goal before either transitions it.
**How to avoid:** For Phase 10, document that only one autonomous session runs at a time (Phase 11 adds distributed Redis lock). In code, the `running = true` guard in `scheduler.ts` already prevents concurrent schedule-driven runs. For manual triggers, the `AutonomousExecutorService` should immediately set a goal-level metadata flag before executing.
**Warning signs:** `startTask()` called twice for the same task; BullMQ job processed multiple times.

### Pitfall 2: CoderAgent produces text output, not files on disk

**What goes wrong:** Executor calls `gitAdd` + `gitCommit` but the working tree is clean because CoderAgent output is text (code blocks in a response string), not actual file writes.
**Why it happens:** `CoderAgent.getTools()` only includes `review_code` and `execute_code`. It does not include `write_file`. When it "produces code," the output is a text string returned to the dispatcher — no files are written.
**How to avoid:** For TERM-02 to work end-to-end, `CoderAgent` must use `write_file` to actually place files in the workspace. Option A: pass `workspaceService` to `CoderAgent` constructor and add `write_file` / `read_file` to its tool list. Option B: `AutonomousExecutorService` parses code blocks from task output and writes them post-execution. Option A is cleaner. This is the single largest implementation gap.
**Warning signs:** `gitStatus()` returns empty output; `gitCommit` fails with "nothing to commit".

### Pitfall 3: PR created targeting wrong base branch

**What goes wrong:** PR is created with `base: "main"` but the repo uses `master` or a protected base like `develop`.
**Why it happens:** `executeCreatePr()` hardcodes `base = "main"` as default.
**How to avoid:** Add `GITHUB_DEFAULT_BRANCH` env var (default: `"main"`). Pass it to `executeCreatePr()`.

### Pitfall 4: Conventional commit subject line too long

**What goes wrong:** Git clients warn about subject lines > 72 chars; some tools truncate them.
**Why it happens:** Goal titles can be verbose (e.g., "Implement user authentication with OAuth2 and session management").
**How to avoid:** `buildConventionalCommit()` enforces max 72-char subject line, truncating description with `...` if needed. This is built into the utility function pattern above.

### Pitfall 5: Work session cost missing from TERM-05

**What goes wrong:** `workSessions.tokensUsed` is set but cost (USD) is absent; TERM-05 says "token cost."
**Why it happens:** `completeWorkSession()` only accepts `tokensUsed: number`, not cost. Cost lives in `llmUsage` table keyed by goalId + taskId.
**How to avoid:** After `dispatcher.runGoal()` completes, call `getUsageSummary(db, { goalId })` to get actual cost breakdown. Embed in `actionsTaken` JSONB as a `costSummary` field. The `workSessions.actionsTaken` column holds arbitrary JSONB — no migration needed.

### Pitfall 6: Yellow-tier git_push blocks autonomous execution

**What goes wrong:** When the autonomous executor uses the orchestrator's freeform tool loop path, `git_push` is yellow-tier (configured in Phase 9 seeding at green, but configurable to yellow). The executor polls for 5 minutes waiting for an approval that never arrives.
**Why it happens:** `executeWithTierCheck()` in `tool-executor.ts` routes yellow-tier tool calls through `executeYellowTierTool()` which polls until approved/timeout.
**How to avoid:** `AutonomousExecutorService` never calls tools through the orchestrator. It calls `workspaceService.gitPush()` directly. Direct service method calls have no tier wrapper.
**Warning signs:** Autonomous session takes exactly `timeoutMs` (default 5 min) with no progress; approval record created in DB.

---

## Code Examples

Verified patterns from existing codebase (HIGH confidence):

### Starting and completing a work session
```typescript
// Source: apps/agent-server/src/autonomous-session.ts lines 151-236
const session = await createWorkSession(db, {
  trigger,
  scheduleId: options?.scheduleId,
  context: { timeBudgetMs, tokenBudget },
});
// ... do work ...
await completeWorkSession(db, session.id, {
  tokensUsed: totalTokens,
  durationMs: Date.now() - startTime,
  actionsTaken: actions,   // JSONB — any structure
  status: "completed",
  summary: "...",
});
```

### Running a goal with progress callback
```typescript
// Source: apps/agent-server/src/worker.ts lines 97-100
const progress = await dispatcher.runGoal(goalId, userId, async (event) => {
  // event: { goalId, goalTitle, taskId, taskTitle, agent, status, completedTasks, totalTasks, output? }
  await redisPubSub.publish(goalId, { ...event, timestamp: Date.now() });
});
```

### Publishing SSE events (existing worker pattern)
```typescript
// Source: apps/agent-server/src/worker.ts lines 94, 105
await redisPubSub.publish(goalId, { goalId, type: "job_started", timestamp: Date.now() });
await redisPubSub.publish(goalId, { goalId, type: "job_completed", timestamp: Date.now() });
```

### Full git sequence on WorkspaceService
```typescript
// Source: apps/agent-server/src/services/workspace.ts
await workspaceService.gitCheckout(repoDir, "autonomous/abc12345", true); // -b new branch
await workspaceService.gitStatus(repoDir);                                  // check if dirty
await workspaceService.gitAdd(repoDir, ["."]);                              // stage all
await workspaceService.gitCommit(repoDir, "feat: task [goal:abc12345]");    // commit
await workspaceService.gitPush(repoDir, "origin", "autonomous/abc12345");   // push
```

### Creating a PR via existing function
```typescript
// Source: apps/agent-server/src/agents/tools/github-tools.ts lines 53-92
const pr = await executeCreatePr({
  owner: "my-org",
  repo: "my-repo",
  title: "feat: autonomous task",
  head: "autonomous/abc12345",
  base: "main",
  body: "## Summary\n...",
});
// Returns: { number, html_url, title, state } | { error: string }
```

### Test mock pattern (from CLAUDE.md + test files)
```typescript
// Source: CLAUDE.md test patterns + apps/agent-server/src/__tests__/dispatcher.test.ts
vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),  // NEVER use Proxy — see CLAUDE.md
  createWorkSession: (...args: unknown[]) => mockCreateWorkSession(...args),
  completeWorkSession: (...args: unknown[]) => mockCompleteWorkSession(...args),
  listGoalBacklog: (...args: unknown[]) => mockListGoalBacklog(...args),
}));
```

### Enqueueing BullMQ job (non-blocking 202 pattern)
```typescript
// Source: apps/agent-server/src/routes/execution.ts lines 47-67
const jobId = await enqueueAgentTask({
  goalId: id,
  prompt: goal.description ?? goal.title,
  userId,
  priority,
});
await updateGoalMetadata(app.db, id, { queueJobId: jobId });
return reply.status(202).send({ jobId, status: "queued", goalId: id });
// Dashboard connects to GET /api/goals/:id/execute/stream for live progress
```

---

## State of the Art

| Old Approach | Current Approach | Changed In | Impact on Phase 10 |
|--------------|------------------|------------|---------------------|
| Manual `runGoal()` call in HTTP handler | BullMQ-backed async job + SSE stream | Phase 9 | Executor uses enqueueAgentTask; stream endpoint is free |
| Direct dispatcher call in HTTP handler | Worker process + Redis pub/sub | Phase 9 | Worker already processes agent-task jobs |
| All tools green tier | Tier-aware execution (green/yellow/red) | Phase 9 | git_push and create_pr default to green; executor bypasses tier via direct service call |
| No autonomous session infrastructure | `runAutonomousSession()` + `workSessions` table | Before Phase 10 | Foundation exists; gap is deterministic goal pickup |
| CoderAgent text-only output | CoderAgent needs write_file support (gap) | Phase 10 adds | Core blocker for TERM-02 end-to-end |

**What Phase 10 must not re-implement:**
- SSE streaming (already live at `GET /api/goals/:id/execute/stream`)
- BullMQ worker infrastructure (already processes `agent-tasks` queue)
- Git operations implementation (all in `WorkspaceService`)
- GitHub PR creation (in `executeCreatePr()`)
- Token usage recording (in `recordLlmUsage()`)
- Tier enforcement for LLM tool calls (in `tool-executor.ts`)

---

## Open Questions

1. **CoderAgent file writing strategy**
   - What we know: `CoderAgent.getTools()` does not include `write_file`; task output is text, not files on disk
   - What's unclear: Should Phase 10 extend `CoderAgent` with workspace tools, or have `AutonomousExecutorService` parse code blocks from output?
   - Recommendation: Extend `CoderAgent` — add `workspaceService` optional param to constructor, add `READ_FILE_TOOL` + `WRITE_FILE_TOOL` + `LIST_DIRECTORY_TOOL` to `getTools()` when `workspaceService` is available. Mirror how `DocWriterAgent` receives `workspaceService`. This is the cleaner approach; output parsing is fragile.

2. **GITHUB_REPO_OWNER / GITHUB_REPO_NAME env vars**
   - What we know: `executeCreatePr()` requires `owner` + `repo`; currently LLM provides these as tool input
   - What's unclear: For autonomous PR creation, these must come from config
   - Recommendation: Add `GITHUB_REPO_OWNER` and `GITHUB_REPO_NAME` to `.env.example` and `optionalEnv()` reads. Fall back to goal metadata if set.

3. **GITHUB_DEFAULT_BRANCH env var**
   - What we know: `executeCreatePr()` defaults `base = "main"`
   - What's unclear: Not all repos use `main`
   - Recommendation: Add `GITHUB_DEFAULT_BRANCH` env var (default: `"main"`).

4. **Cost attribution in work sessions**
   - What we know: `llmUsage` table has `goalId` column; `getUsageSummary()` can filter by goalId
   - What's unclear: `getUsageSummary()` has a known pre-existing TS error (CLAUDE.md: "pre-existing failures in e2e-full-workflow and summarizer due to getUsageSummary mock")
   - Recommendation: Query `llmUsage` table directly with a simple aggregate rather than using `getUsageSummary()`. Add a new `getCostByGoal(db, goalId)` repository function.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (root `vitest.config.ts`) |
| Config file | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --run --reporter=verbose` |
| Full suite command | `npm run test` |
| Estimated runtime | ~45 seconds (agent-server workspace only) |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TERM-01 | `listGoalBacklog()` returns active goals with pending tasks, priority-ordered | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "listGoalBacklog"` | Wave 0 gap |
| TERM-01 | `runAutonomousSession()` calls `listGoalBacklog()` and passes top goal to executor | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*backlog"` | Wave 0 gap |
| TERM-02 | `AutonomousExecutorService.executeGoal()` chains runGoal → gitCheckout → gitAdd → gitCommit | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "AutonomousExecutor"` | Wave 0 gap |
| TERM-03 | `buildConventionalCommit()` formats message correctly with goalId ref and 72-char limit | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "buildConventionalCommit"` | Wave 0 gap |
| TERM-04 | `generatePrDescription()` calls LLM registry and returns markdown with goal title | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "generatePrDescription"` | Wave 0 gap |
| TERM-05 | `executeGoal()` writes structured `actionsTaken` array with per-task entries | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "actionsTaken\|work.*log"` | Wave 0 gap |
| TERM-05 | `GET /api/autonomous/sessions` returns recent work sessions | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*routes\|sessions"` | Wave 0 gap |
| TERM-01+SSE | SSE stream receives job_started, task progress events, job_completed | integration | `npm run test -w @ai-cofounder/agent-server -- --run execution-queue` | ✅ YES (extend `execution-queue.test.ts`) |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server -- --run --reporter=verbose`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~45 seconds

### Wave 0 Gaps (must be created before implementation)

- [ ] `apps/agent-server/src/__tests__/autonomous-executor.test.ts` — covers TERM-01 (backlog pickup), TERM-02 (execute chain), TERM-03 (conventional commits), TERM-04 (PR description), TERM-05 (work log entries)
- [ ] `apps/agent-server/src/__tests__/autonomous-routes.test.ts` — covers REST API for `GET /api/autonomous/backlog`, `GET /api/autonomous/sessions`, `POST /api/autonomous/:goalId/run`
- [ ] Add `listGoalBacklog: vi.fn().mockResolvedValue([])` to `packages/test-utils/src/mocks/db.ts` `mockDbModule()` — CRITICAL: new DB exports MUST be added here before tests run (see CLAUDE.md)
- [ ] Framework install: none needed — vitest already configured

*(Note: `buildConventionalCommit` is a pure function — tested directly in `autonomous-executor.test.ts` without DB mocking)*

---

## Sources

### Primary (HIGH confidence)

- Direct source code inspection: `apps/agent-server/src/autonomous-session.ts` — session lifecycle, work session create/complete pattern
- Direct source code inspection: `apps/agent-server/src/agents/dispatcher.ts` — task execution engine, progress callback shape
- Direct source code inspection: `apps/agent-server/src/services/workspace.ts` — all git method signatures
- Direct source code inspection: `apps/agent-server/src/agents/tools/github-tools.ts` — `executeCreatePr()` signature and return type
- Direct source code inspection: `apps/agent-server/src/routes/execution.ts` — SSE stream pattern, 202 enqueue pattern
- Direct source code inspection: `apps/agent-server/src/worker.ts` — BullMQ worker and pub/sub publish pattern
- Direct source code inspection: `packages/db/src/schema.ts` — `workSessions` table columns, `goalStatusEnum`, `taskStatusEnum`
- Direct source code inspection: `packages/db/src/repositories.ts` — `listActiveGoals()` pattern, `createWorkSession`/`completeWorkSession` signatures
- Direct source code inspection: `packages/queue/src/queues.ts` — `AgentTaskJob` type
- Direct source code inspection: `apps/agent-server/src/agents/tool-executor.ts` — tier-aware execution, yellow-tier polling
- Direct source code inspection: `apps/agent-server/src/agents/specialists/coder.ts` — CoderAgent tool list (confirmed no write_file)
- Direct source code inspection: `apps/agent-server/src/agents/specialists/base.ts` — `SpecialistContext`, `SpecialistResult` shapes
- Direct source code inspection: CLAUDE.md — test mocking rules, build order, optionalEnv 2-arg requirement

### Secondary (MEDIUM confidence)

- `.planning/phases/09-autonomy-approval-system/09-RESEARCH.md` — confirms tool tier defaults, seeded tool names
- `.planning/STATE.md` — confirms Phase 9 complete, accumulated decisions
- `.planning/REQUIREMENTS.md` — TERM requirements verbatim

### Tertiary (LOW confidence)

- None — all findings are from direct source inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified by reading source files directly
- Architecture: HIGH — patterns derived from existing code (dispatcher, worker, execution route)
- Pitfalls: HIGH — identified from direct reading of WorkspaceService, CoderAgent, and tool-executor
- Test gaps: HIGH — inspected all 70+ existing test files in `__tests__/`

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable codebase, 30-day validity)
