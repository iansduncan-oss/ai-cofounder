# Phase 10: Autonomous Execution Engine - Research

**Researched:** 2026-03-10
**Domain:** Autonomous AI agent task execution, git workflow orchestration, structured work logging
**Confidence:** HIGH

## Summary

Phase 10 transforms the existing orchestrator + dispatcher infrastructure into an autonomous execution engine that picks up tasks from the goal backlog and completes coding workflows end-to-end (read code, edit, test, commit, PR) without human intervention. The critical insight is that nearly all building blocks already exist -- the orchestrator has 20+ tools including full git/filesystem/sandbox, the TaskDispatcher already executes goals with parallel groups and retry logic, and the autonomous session infrastructure already handles session lifecycle with token budgets. What's missing is: (1) a task pickup mechanism that selects the next pending task intelligently, (2) a coding workflow orchestration layer that chains workspace+git+sandbox tools in the correct sequence, (3) conventional commit message generation with goal/task ID linkage, (4) auto-generated PR descriptions from diff context, and (5) a `workLogEntries` DB table for structured execution tracking.

The existing `runAutonomousSession()` in `autonomous-session.ts` already creates an Orchestrator, feeds it context about active goals, and runs it with time/token budgets. The gap is that it asks the orchestrator to "decide what to work on" via free-text LLM prompting, rather than programmatically selecting tasks and driving a deterministic execution workflow. Phase 10 should add an `AutonomousExecutor` service that sits between the autonomous session and the orchestrator/dispatcher, providing structured task selection, workflow orchestration, and work log persistence.

**Primary recommendation:** Build an `AutonomousExecutor` service that programmatically picks tasks from the backlog, constructs a coding workflow prompt with task context, executes via the existing Orchestrator (which already has all the tools), and records structured work log entries. Do NOT rebuild the tool execution layer -- use the existing orchestrator's agentic tool loop.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TERM-01 | Agent picks up tasks from goal backlog without human trigger | New `pickNextTask()` repository function + `AutonomousExecutor.pickTask()` method that queries pending tasks by goal priority and task order |
| TERM-02 | Agent chains workspace, git, and sandbox tools for end-to-end coding | Orchestrator already has all tools; new coding workflow prompt template instructs the LLM to follow read->edit->test->commit sequence |
| TERM-03 | Conventional commit messages linking to goal/task IDs | Commit message formatter utility: `formatConventionalCommit(type, scope, description, goalId, taskId)` |
| TERM-04 | Auto-generated PR descriptions from task context + diff | PR description builder that combines task metadata + git diff summary into structured markdown |
| TERM-05 | Structured work log entries (task, actions, outcome, duration, token cost) | New `workLogEntries` DB table + `createWorkLogEntry()`/`listWorkLogEntries()` repository functions |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Drizzle ORM | existing | `workLogEntries` table schema + repository | Already used for all DB ops in the project |
| BullMQ | existing | Queue integration for autonomous task execution | Already wired with 5 queues; execution fits `agent-tasks` queue |
| pino | existing | Structured logging for execution tracking | Project-wide logging standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@ai-cofounder/llm` | existing | LLM calls for PR description generation | When auto-generating PR body text from diff |
| `@ai-cofounder/queue` | existing | Enqueue autonomous execution tasks | When triggering execution from schedule or API |
| `@ai-cofounder/sandbox` | existing | Test execution in isolated environment | TERM-02 testing step |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LLM-generated PR descriptions | Template-only PR descriptions | LLM produces better narrative but costs tokens; template is free but less descriptive. Use LLM for body, template for title. |
| Orchestrator for coding workflow | New specialized CodingAgent | Orchestrator already has ALL the tools wired; creating a new agent would duplicate tool registration. Use orchestrator with a specialized system prompt. |

**Installation:**
```bash
# No new dependencies needed -- all existing packages suffice
```

## Architecture Patterns

### Recommended Project Structure
```
apps/agent-server/src/
  services/
    autonomous-executor.ts     # NEW: Task pickup, workflow orchestration, work log
  agents/
    prompts/
      coding-workflow.ts        # NEW: System prompt for autonomous coding workflow
  routes/
    work-log.ts                 # NEW: REST endpoints for work log entries
packages/db/src/
  schema.ts                     # MODIFY: Add workLogEntries table
  repositories.ts               # MODIFY: Add work log + task pickup repository functions
```

### Pattern 1: AutonomousExecutor Service
**What:** A service class that orchestrates the full autonomous execution lifecycle: pick task -> prepare context -> execute via orchestrator -> record work log -> update task status.
**When to use:** Every autonomous task execution, whether triggered by schedule (Phase 11), API, or event.
**Example:**
```typescript
// Source: Project architecture pattern (matches WorkspaceService, AgentMessagingService patterns)
export class AutonomousExecutor {
  constructor(
    private db: Db,
    private registry: LlmRegistry,
    private workspaceService: WorkspaceService,
    private embeddingService?: EmbeddingService,
    private sandboxService?: SandboxService,
    private autonomyTierService?: AutonomyTierService,
  ) {}

  async executeNext(): Promise<ExecutionResult> {
    const task = await this.pickNextTask();
    if (!task) return { status: "idle", message: "No pending tasks" };

    const startTime = Date.now();
    const startTokens = { input: 0, output: 0 };

    try {
      // Build coding workflow prompt with task context
      const prompt = buildCodingWorkflowPrompt(task, task.goal);

      // Execute via orchestrator (has all tools already)
      const orchestrator = new Orchestrator(
        this.registry, this.db, "code",
        this.embeddingService, undefined,
        this.sandboxService, this.workspaceService,
        undefined, this.autonomyTierService,
      );

      const result = await orchestrator.run(prompt, task.goal.conversationId);

      // Record work log entry
      await createWorkLogEntry(this.db, {
        taskId: task.id,
        goalId: task.goalId,
        actions: this.extractActions(result),
        outcome: "success",
        durationMs: Date.now() - startTime,
        tokenCost: {
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
        },
      });

      return { status: "completed", taskId: task.id };
    } catch (err) {
      // Record failure in work log
      await createWorkLogEntry(this.db, { /* ... failure data ... */ });
      throw err;
    }
  }
}
```

### Pattern 2: Coding Workflow Prompt
**What:** A structured system prompt that instructs the orchestrator to follow a deterministic coding workflow sequence.
**When to use:** Every TERM-02 execution -- agent must follow read->edit->test->commit->PR sequence.
**Example:**
```typescript
// Source: Project pattern (matches buildSystemPrompt in agents/prompts/system.ts)
export function buildCodingWorkflowPrompt(
  task: { id: string; title: string; description: string },
  goal: { id: string; title: string; repoDir: string },
): string {
  return `You are executing an autonomous coding task. Follow this workflow strictly:

## Task
**Goal:** ${goal.title}
**Task:** ${task.title}
**Description:** ${task.description}

## Workflow (execute in order)
1. **Understand** — Read relevant files using read_file and list_directory
2. **Branch** — Create a feature branch: git_checkout with create=true
   Branch name: task/${task.id.slice(0, 8)}/${slugify(task.title)}
3. **Implement** — Write/edit files using write_file
4. **Test** — Run tests using run_tests to verify changes
5. **Commit** — Stage with git_add, commit with git_commit using this format:
   feat(${goal.id.slice(0, 8)}): ${task.title}

   Task: ${task.id}
   Goal: ${goal.id}
6. **Push** — Push branch with git_push
7. **PR** — Create PR with create_pr including auto-generated description

## Commit Message Format
Use conventional commits: <type>(<scope>): <description>
- type: feat|fix|refactor|test|docs|chore
- scope: goal ID prefix (first 8 chars)
- Footer: Task: <task-id> and Goal: <goal-id>

## PR Description Format
Include:
- Summary of changes (2-3 sentences)
- List of files modified
- Task and goal references
- Test results summary`;
}
```

### Pattern 3: Task Pickup with Priority
**What:** DB query that selects the next eligible task considering goal priority, task order, and execution status.
**When to use:** TERM-01 -- agent needs to autonomously select work.
**Example:**
```typescript
// Source: Drizzle ORM pattern (matches existing repository functions in packages/db)
export async function pickNextTask(db: Db): Promise<TaskWithGoal | null> {
  // Find the highest-priority active goal with pending tasks
  const rows = await db
    .select({
      taskId: tasks.id,
      taskTitle: tasks.title,
      taskDescription: tasks.description,
      goalId: goals.id,
      goalTitle: goals.title,
      goalPriority: goals.priority,
      orderIndex: tasks.orderIndex,
    })
    .from(tasks)
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(
      and(
        eq(tasks.status, "pending"),
        eq(goals.status, "active"),
      ),
    )
    .orderBy(
      // Priority ordering: critical > high > medium > low
      sql`CASE ${goals.priority}
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 3
      END`,
      asc(tasks.orderIndex),
    )
    .limit(1);

  return rows[0] ?? null;
}
```

### Pattern 4: Work Log Entry Schema
**What:** New DB table for structured execution tracking per TERM-05.
**When to use:** After every autonomous execution, successful or failed.
**Example:**
```typescript
// Source: Drizzle ORM schema pattern (matches existing tables in packages/db/src/schema.ts)
export const workLogEntries = pgTable("work_log_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id),
  goalId: uuid("goal_id").references(() => goals.id),
  sessionId: uuid("session_id").references(() => workSessions.id),
  actions: jsonb("actions").notNull(),      // Array of { tool, input_summary, output_summary, durationMs }
  outcome: text("outcome").notNull(),        // "success" | "failure" | "partial"
  outcomeDetail: text("outcome_detail"),     // Human-readable summary
  durationMs: integer("duration_ms").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  commitSha: text("commit_sha"),             // If a commit was made
  prUrl: text("pr_url"),                     // If a PR was created
  prNumber: integer("pr_number"),            // PR number
  branchName: text("branch_name"),           // Feature branch name
  metadata: jsonb("metadata"),               // Extensible
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

### Anti-Patterns to Avoid
- **Building a new tool execution layer:** The Orchestrator already has all 20+ tools wired with tier enforcement. Do NOT create a parallel tool executor. Feed a coding workflow prompt to the existing Orchestrator.
- **Polling for task completion inside the LLM loop:** The orchestrator's agentic tool loop already handles multi-round tool execution. Don't add another polling layer on top.
- **Skipping branch creation:** Always create a feature branch per task. Never commit directly to main. This is both a safety measure and a requirement for PR creation.
- **Hard-coding repo paths:** Use the task/goal context to determine the repo directory. The WorkspaceService already handles path resolution and traversal prevention.
- **Ignoring test failures:** If `run_tests` returns a non-zero exit code, the agent should NOT proceed to commit. The coding workflow prompt must explicitly instruct this.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git operations | Custom git library | Existing `WorkspaceService` git methods | Already has path traversal protection, timeout handling, error normalization |
| Tool execution with tier checks | New tool executor | `executeWithTierCheck()` from `tool-executor.ts` | Already handles green/yellow/red tiers, approval flow, polling |
| PR creation via GitHub API | Raw fetch calls | `executeCreatePr()` from `github-tools.ts` | Already handles auth, error responses, logging |
| LLM completion with retries | Custom retry logic | `completeWithRetry()` from specialist base | Already handles 429, timeout, ECONNRESET with exponential backoff |
| Task status management | Custom state machine | Existing `assignTask/startTask/completeTask/failTask` | Already in repositories.ts with proper update timestamps |
| Session lifecycle | Custom session tracking | `createWorkSession/completeWorkSession` | Already tracks trigger, tokens, duration, status, summary |
| Conventional commit parsing | Regex parser | Simple string template function | Format is `type(scope): description\n\nTask: id\nGoal: id` -- no parsing needed, just formatting |

**Key insight:** Phase 10 is primarily an orchestration layer that connects existing building blocks. The main value-add is (1) intelligent task selection, (2) a structured coding workflow prompt, (3) work log persistence, and (4) conventional commit/PR formatting. Do NOT rebuild infrastructure that already exists.

## Common Pitfalls

### Pitfall 1: LLM Not Following Workflow Sequence
**What goes wrong:** The LLM skips steps (e.g., commits without testing, or pushes without creating a branch).
**Why it happens:** LLMs are probabilistic and may not strictly follow a numbered sequence, especially if the system prompt is ambiguous.
**How to avoid:** Make the coding workflow prompt extremely prescriptive with numbered steps and explicit tool names. Include negative instructions: "Do NOT commit if tests fail." "You MUST create a branch before making changes." Consider validation after orchestrator completes: check that a commit was actually made, a branch exists, etc.
**Warning signs:** Work log entries with no `commitSha` or `branchName` populated.

### Pitfall 2: Stale Workspace State
**What goes wrong:** Agent starts working on a task but the workspace has uncommitted changes from a previous failed execution, or the branch is in an unexpected state.
**Why it happens:** Previous autonomous execution failed mid-workflow, leaving dirty workspace state.
**How to avoid:** Before each task execution, run `git_status` to check for a clean working tree. If dirty, either stash or reset. The coding workflow prompt should begin with "First, verify the workspace is clean using git_status."
**Warning signs:** `git_commit` failures due to merge conflicts or "nothing to commit."

### Pitfall 3: Token Budget Exhaustion Mid-Task
**What goes wrong:** The autonomous session runs out of tokens or time while the agent is mid-workflow (e.g., after editing files but before committing).
**Why it happens:** Complex tasks require many tool rounds; the orchestrator's 10-round limit may not be enough, or the session time budget expires.
**How to avoid:** The autonomous session already has `Promise.race()` timeout handling. For Phase 10, ensure that if an execution is interrupted, the work log records partial completion with enough context to resume. Consider checking remaining budget before starting the commit/push/PR sequence.
**Warning signs:** Work log entries with `outcome: "partial"` and no `commitSha`.

### Pitfall 4: Duplicate Execution
**What goes wrong:** Two autonomous sessions pick up the same task concurrently, leading to duplicate branches, commits, or PRs.
**Why it happens:** No lock on task pickup -- `pickNextTask()` returns the same task to concurrent callers.
**How to avoid:** Use `assignTask()` (which sets status to "assigned") immediately after picking. The `pickNextTask()` query filters by `status = "pending"`, so an assigned task won't be picked again. For Phase 11 (scheduling), a Redis distributed lock prevents concurrent sessions entirely, but Phase 10 should still use task-level assignment as defense-in-depth.
**Warning signs:** Multiple work log entries for the same `taskId` with overlapping timestamps.

### Pitfall 5: Git Auth Failures on Push/PR
**What goes wrong:** Agent successfully commits but fails on `git_push` or `create_pr` because `GITHUB_TOKEN` is missing or the repo remote is not configured.
**Why it happens:** Workspace was cloned with `--depth 1` or the remote URL uses HTTPS without credentials configured.
**How to avoid:** Validate that `GITHUB_TOKEN` is set before starting execution. Ensure the workspace has a valid remote URL. The coding workflow prompt should include fallback behavior: if push fails, record the commit SHA and branch name in the work log for manual follow-up.
**Warning signs:** Work log entries with `commitSha` populated but `prUrl` empty.

### Pitfall 6: Oversized Diffs in PR Descriptions
**What goes wrong:** Auto-generated PR descriptions include the full diff text, exceeding GitHub's PR body size limit (65536 chars).
**Why it happens:** Large code changes produce large diffs; naively including the full diff in the PR body.
**How to avoid:** Summarize the diff rather than including it verbatim. Use `git_diff --stat` for file-level summary, and let the LLM generate a narrative summary from the diff. Cap PR body at 4000 characters.
**Warning signs:** GitHub API 422 errors on PR creation.

## Code Examples

Verified patterns from the existing codebase:

### Conventional Commit Message Format (TERM-03)
```typescript
// Utility function — simple string formatter, no library needed
// Source: Conventional Commits spec v1.0.0
type CommitType = "feat" | "fix" | "refactor" | "test" | "docs" | "chore";

export function formatConventionalCommit(
  type: CommitType,
  scope: string,
  description: string,
  goalId: string,
  taskId: string,
): string {
  // Scope is the first 8 chars of goal ID for traceability
  const shortScope = scope || goalId.slice(0, 8);
  const lines = [
    `${type}(${shortScope}): ${description}`,
    "",
    `Task: ${taskId}`,
    `Goal: ${goalId}`,
  ];
  return lines.join("\n");
}
```

### PR Description Builder (TERM-04)
```typescript
// Source: Project pattern (extends existing executeCreatePr)
export function buildPrDescription(
  task: { id: string; title: string; description: string },
  goal: { id: string; title: string },
  diffStat: string,
  testResult?: { passed: boolean; output: string },
): string {
  const lines: string[] = [];
  lines.push(`## Summary`);
  lines.push(`Implements task "${task.title}" for goal "${goal.title}".`);
  lines.push("");
  lines.push(`## Changes`);
  lines.push("```");
  lines.push(diffStat.slice(0, 2000));
  lines.push("```");
  lines.push("");
  lines.push(`## Test Results`);
  if (testResult) {
    lines.push(testResult.passed ? "All tests passing." : "Some tests failed (see details below).");
    lines.push("```");
    lines.push(testResult.output.slice(0, 1000));
    lines.push("```");
  } else {
    lines.push("No test results available.");
  }
  lines.push("");
  lines.push(`## References`);
  lines.push(`- Task: \`${task.id}\``);
  lines.push(`- Goal: \`${goal.id}\``);
  lines.push("");
  lines.push("---");
  lines.push("*Generated by AI Cofounder autonomous execution engine*");
  return lines.join("\n");
}
```

### Work Log Entry Creation (TERM-05)
```typescript
// Source: Drizzle ORM pattern (matches existing createWorkSession)
export async function createWorkLogEntry(
  db: Db,
  data: {
    taskId?: string;
    goalId?: string;
    sessionId?: string;
    actions: Array<{ tool: string; inputSummary: string; outputSummary: string; durationMs: number }>;
    outcome: "success" | "failure" | "partial";
    outcomeDetail?: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    commitSha?: string;
    prUrl?: string;
    prNumber?: number;
    branchName?: string;
    metadata?: unknown;
  },
) {
  const [entry] = await db.insert(workLogEntries).values(data).returning();
  return entry;
}
```

### Extracting Actions from Orchestrator Result
```typescript
// Source: Project pattern (matches tool execution recording in orchestrator.ts)
// The orchestrator already records tool executions via recordToolExecution().
// For work log, we need a summary of what tools were called during this execution.
// Approach: Pass a StreamCallback to orchestrator.runStream() that captures tool calls.

function createActionTracker(): {
  callback: StreamCallback;
  getActions: () => Array<{ tool: string; inputSummary: string; outputSummary: string; durationMs: number }>;
} {
  const actions: Array<{ tool: string; inputSummary: string; outputSummary: string; durationMs: number }> = [];
  let lastToolStart = 0;

  return {
    callback: async (event) => {
      if (event.type === "tool_call") {
        lastToolStart = Date.now();
        actions.push({
          tool: event.data.tool,
          inputSummary: JSON.stringify(event.data.input).slice(0, 200),
          outputSummary: "",
          durationMs: 0,
        });
      }
      if (event.type === "tool_result" && actions.length > 0) {
        const last = actions[actions.length - 1];
        last.outputSummary = event.data.summary?.slice(0, 200) ?? "";
        last.durationMs = Date.now() - lastToolStart;
      }
    },
    getActions: () => actions,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| LLM decides what to work on via free text | Programmatic task selection + LLM executes | 2025-2026 | More deterministic, auditable, and controllable |
| Manual PR descriptions | LLM-generated from diff + task context | 2025 | Better quality, consistent format |
| Unstructured execution logs | Structured work log entries in DB | 2025-2026 | Enables Phase 12 (Work Journal) downstream |
| Single long-running LLM session | Task-scoped sessions with budget limits | 2025 | Prevents runaway cost, enables clean interruption |

**Deprecated/outdated:**
- None in this project's stack -- all dependencies are current

## Open Questions

1. **Repo directory determination**
   - What we know: `WorkspaceService` resolves paths relative to `WORKSPACE_DIR`. Tasks don't currently store which repo they target.
   - What's unclear: For Phase 10, should we assume single-workspace (the monorepo) or support multi-repo? Phase 14 adds multi-project awareness later.
   - Recommendation: Default to a configurable `DEFAULT_REPO_DIR` (env var, defaults to "ai-cofounder"). The task description or goal metadata should be able to override this. Keep the interface generic for Phase 14 compatibility.

2. **Branch naming convention**
   - What we know: Branches need to be unique per task execution.
   - What's unclear: Should branches include human-readable slugs or just IDs?
   - Recommendation: Use `task/<task-id-prefix>/<slugified-title>` format (e.g., `task/a1b2c3d4/add-user-endpoint`). This is readable, unique, and traceable.

3. **Action extraction from orchestrator**
   - What we know: The orchestrator emits `tool_call` and `tool_result` events via `StreamCallback` in `runStream()`, but `run()` does not.
   - What's unclear: Should we use `runStream()` for autonomous execution to capture actions, or add action tracking to `run()`?
   - Recommendation: Use `runStream()` with a capturing callback. It's already the richer API, and the StreamCallback pattern makes action extraction clean without modifying the orchestrator internals.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (globals mode, node environment) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run apps/agent-server/src/__tests__/autonomous-executor.test.ts` |
| Full suite command | `npm run test` |
| Estimated runtime | ~5-15 seconds per test file |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TERM-01 | pickNextTask selects highest-priority pending task | unit | `npx vitest run apps/agent-server/src/__tests__/autonomous-executor.test.ts` | No -- Wave 0 gap |
| TERM-01 | pickNextTask skips assigned/running/completed tasks | unit | `npx vitest run apps/agent-server/src/__tests__/autonomous-executor.test.ts` | No -- Wave 0 gap |
| TERM-02 | Coding workflow prompt includes all 7 steps | unit | `npx vitest run apps/agent-server/src/__tests__/coding-workflow.test.ts` | No -- Wave 0 gap |
| TERM-02 | executeNext() calls orchestrator with coding prompt | unit | `npx vitest run apps/agent-server/src/__tests__/autonomous-executor.test.ts` | No -- Wave 0 gap |
| TERM-03 | formatConventionalCommit produces valid format | unit | `npx vitest run apps/agent-server/src/__tests__/commit-format.test.ts` | No -- Wave 0 gap |
| TERM-03 | Commit message includes goal/task ID in footer | unit | `npx vitest run apps/agent-server/src/__tests__/commit-format.test.ts` | No -- Wave 0 gap |
| TERM-04 | buildPrDescription includes summary, changes, references | unit | `npx vitest run apps/agent-server/src/__tests__/pr-description.test.ts` | No -- Wave 0 gap |
| TERM-04 | PR body capped at 4000 chars | unit | `npx vitest run apps/agent-server/src/__tests__/pr-description.test.ts` | No -- Wave 0 gap |
| TERM-05 | createWorkLogEntry persists all required fields | unit | `npx vitest run packages/db/src/__tests__/work-log.test.ts` | No -- Wave 0 gap |
| TERM-05 | listWorkLogEntries filters by goalId, taskId, date range | unit | `npx vitest run packages/db/src/__tests__/work-log.test.ts` | No -- Wave 0 gap |
| TERM-05 | Work log entry records accurate duration and token cost | unit | `npx vitest run apps/agent-server/src/__tests__/autonomous-executor.test.ts` | No -- Wave 0 gap |
| ALL | End-to-end: executeNext picks task, runs orchestrator, records work log | integration | `npx vitest run apps/agent-server/src/__tests__/e2e-autonomous-execution.test.ts` | No -- Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task -> run: `npx vitest run apps/agent-server/src/__tests__/autonomous-executor.test.ts`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~10 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `apps/agent-server/src/__tests__/autonomous-executor.test.ts` -- covers TERM-01, TERM-02, TERM-05 (executor service)
- [ ] `apps/agent-server/src/__tests__/coding-workflow.test.ts` -- covers TERM-02 (prompt builder)
- [ ] `apps/agent-server/src/__tests__/commit-format.test.ts` -- covers TERM-03 (conventional commit formatter)
- [ ] `apps/agent-server/src/__tests__/pr-description.test.ts` -- covers TERM-04 (PR body builder)
- [ ] `packages/db/src/__tests__/work-log.test.ts` -- covers TERM-05 (DB repository functions)
- [ ] `apps/agent-server/src/__tests__/e2e-autonomous-execution.test.ts` -- covers integration across TERM-01 through TERM-05
- [ ] `packages/db/src/schema.ts` -- needs `workLogEntries` table definition
- [ ] `packages/test-utils/src/mocks/db.ts` -- needs mock entries for new work log repository functions

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `apps/agent-server/src/agents/orchestrator.ts` -- verified 20+ tools, agentic tool loop (10 rounds), tier enforcement
- Codebase analysis: `apps/agent-server/src/agents/dispatcher.ts` -- verified goal execution, task grouping, retry logic, progress callbacks
- Codebase analysis: `apps/agent-server/src/autonomous-session.ts` -- verified session lifecycle, token budgets, context building
- Codebase analysis: `apps/agent-server/src/agents/tool-executor.ts` -- verified tier check flow (green/yellow/red), shared tool registration
- Codebase analysis: `apps/agent-server/src/services/workspace.ts` -- verified git operations, path traversal protection
- Codebase analysis: `apps/agent-server/src/agents/tools/github-tools.ts` -- verified PR creation via GitHub API
- Codebase analysis: `packages/db/src/schema.ts` -- verified goals/tasks/workSessions/toolExecutions/llmUsage schemas
- Codebase analysis: `packages/db/src/repositories.ts` -- verified listActiveGoals, listPendingTasks, countTasksByStatus, work session CRUD

### Secondary (MEDIUM confidence)
- [Conventional Commits v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) -- commit message format specification
- [Agentic coding best practices 2025-2026](https://addyosmani.com/blog/ai-coding-workflow/) -- define-execute-verify-check workflow pattern

### Tertiary (LOW confidence)
- None -- all findings verified against codebase or official specs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies
- Architecture: HIGH - building on well-understood existing patterns, codebase thoroughly analyzed
- Pitfalls: HIGH - derived from analyzing actual code paths and failure modes in existing infrastructure
- Work log schema: MEDIUM - new table design based on project patterns but not yet validated with downstream Phase 12 (Work Journal) requirements

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable -- no fast-moving external dependencies)
