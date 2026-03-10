# Phase 11: Autonomous Scheduling - Research

**Researched:** 2026-03-10
**Domain:** Distributed lock, recurring BullMQ schedule, per-session token budget hard abort, CI self-healing with 2-cycle confirmation
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SCHED-01 | Agent picks up planned tasks from backlog and executes them on a recurring BullMQ schedule | `runAutonomousSession()` + `listGoalBacklog()` + `AutonomousExecutorService` all exist; gap is wiring a recurring BullMQ job scheduler entry that calls `runAutonomousSession()` on its tick |
| SCHED-02 | Only one autonomous session runs at a time (distributed lock via Redis) | `RedisPubSub` uses ioredis already in the project; Redis `SET NX PX` (SETNX with expiry) is the standard distributed lock pattern; needs a `DistributedLockService` or inline lock acquisition before `runAutonomousSession()` |
| SCHED-03 | Per-session token budget enforced as hard limit — abort mid-execution if exceeded, not just warn | `tokenBudget` already flows through `runAutonomousSession()` → `SessionOptions`; gap is (1) tracking tokens cumulatively across tool rounds in `AutonomousExecutorService`, and (2) throwing a `TokenBudgetExceededError` that causes a clean abort rather than the current warn-only path |
| SCHED-04 | Self-healing on persistent CI failures — detect pattern, fix code, create PR (yellow-tier approval, 2-cycle confirmation before acting) | `MonitoringService.checkGitHubCI()` polls CI status; gap is a `CiSelfHealService` that persists failure state across monitoring cycles, counts consecutive failures >= 2, triggers a CoderAgent fix pass, and gates the PR behind yellow-tier approval |
</phase_requirements>

---

## Summary

Phase 11 builds the "works while you sleep" outer loop on top of the complete Phase 10 autonomous execution engine. The four requirements decompose into four tightly-scoped additions:

**SCHED-01** is wiring: add an `autonomous-session` recurring job to `setupRecurringJobs()` in `packages/queue/src/scheduler.ts`. The tick handler calls `runAutonomousSession()` with `trigger: "schedule"`. The interval (default 30 minutes) becomes a new env var `AUTONOMOUS_SESSION_INTERVAL_MINUTES`. All the execution machinery already exists — this is a 10-line addition to scheduler.ts plus a queue plugin handler.

**SCHED-02** is a Redis distributed lock. The project already has ioredis available through `RedisPubSub` in `packages/queue/src/pubsub.ts`. The standard pattern is `SET lock-key session-id NX PX <ttl>` — acquire returns the set key or null. A lightweight `DistributedLockService` using the existing ioredis connection handles this without adding a new package. The lock key is `autonomous-session:lock`, TTL matches the session time budget plus a buffer.

**SCHED-03** is a token budget hard abort. The current code in `autonomous-session.ts` checks `totalTokens > tokenBudget` after the orchestrator returns and only warns. The fix has two parts: (1) in `AutonomousExecutorService`, accumulate tokens from each task's `tokensUsed` and check against budget after each task — throw `TokenBudgetExceededError` if exceeded mid-execution; (2) catch this specific error in `runAutonomousSession()` and set `status = "aborted"` with a clear summary. This prevents partial commits — the abort happens between tasks, not mid-task.

**SCHED-04** is a CI self-heal loop. `MonitoringService.checkGitHubCI()` already fetches workflow run status. The gap is persistence — consecutive failure counts must survive across monitoring cycles. The pattern: store `{repo, branch, failureCount, firstFailedAt, lastFailedAt}` in Redis. On detecting a CI failure, increment the count; if `count >= 2` and not yet attempted, trigger a CoderAgent session to analyze the failure and produce a fix PR gated behind yellow-tier approval.

**Primary recommendation:** Build each requirement as a standalone unit — (1) scheduler entry, (2) lock service helper, (3) token budget abort in executor, (4) CI self-heal service. Each has a clear test boundary and zero coupling to the others.

---

## Standard Stack

### Core (all already in the project — verified by source inspection)

| Library/Module | Where | Purpose | Status |
|----------------|-------|---------|--------|
| `ioredis` (via `RedisPubSub`) | `packages/queue/src/pubsub.ts` | Raw Redis SET NX PX for distributed lock | EXISTS — reuse the connection options |
| `BullMQ.Queue.upsertJobScheduler()` | `packages/queue/src/scheduler.ts` | Recurring job scheduling with cron or interval | EXISTS — same pattern as monitoring/briefings |
| `runAutonomousSession()` | `apps/agent-server/src/autonomous-session.ts` | Session lifecycle, work session create/complete | EXISTS — call from BullMQ handler |
| `AutonomousExecutorService` | `apps/agent-server/src/services/autonomous-executor.ts` | Goal execution with git/PR | EXISTS — extend to track per-task tokens |
| `MonitoringService.checkGitHubCI()` | `apps/agent-server/src/services/monitoring.ts` | Fetches GitHub workflow run status | EXISTS — extend to persist failure counts |
| `createWorkSession` / `completeWorkSession` | `packages/db/src/repositories.ts` | Work session lifecycle | EXISTS |
| `request_approval` (yellow-tier) | Orchestrator tool via `AutonomyTierService` | Gates PR creation on human approval | EXISTS — Phase 9 built this |
| `workSessions` table | `packages/db/src/schema.ts` | Logs each autonomous session | EXISTS |
| `MonitoringJob` / `getMonitoringQueue()` | `packages/queue/src/queues.ts` | Monitoring job type + queue | EXISTS |
| `setupRecurringJobs()` | `packages/queue/src/scheduler.ts` | Registers recurring BullMQ jobs at startup | EXISTS — extend it |
| `getTodayTokenTotal()` | `packages/db/src/repositories.ts` | Daily token limit pre-check | EXISTS |

### New Components Required

| Component | Type | Purpose |
|-----------|------|---------|
| `DistributedLockService` | New service | Redis `SET NX PX` acquire + Lua compare-and-delete release for session exclusion |
| `TokenBudgetExceededError` | New error class | Typed error thrown when per-session token budget is hit mid-execution |
| `CiSelfHealService` | New service | Tracks consecutive CI failure counts, triggers fix session after 2 cycles |
| Redis key `ci-heal:{repo}:{branch}` | Redis key with JSON + TTL | Persists `{count, firstFailedAt, healAttempted}` across monitoring cycles |
| `autonomous-session` recurring job | Extension to `setupRecurringJobs()` | Adds BullMQ scheduler entry for recurring autonomous sessions |
| `QUEUE_NAMES.AUTONOMOUS_SESSIONS` | Extension to `queues.ts` | New queue name constant |
| `AutonomousSessionJob` | New job type in `queues.ts` | Job payload type for the autonomous session BullMQ job |
| Token accumulation in `AutonomousExecutorService` | Modification | After each task, sum tokens and compare against budget |
| `autonomousSession` worker processor | Extension to `WorkerProcessors` | Handler wired in `worker.ts` that calls `runAutonomousSession()` |
| `"skipped"` / `"aborted"` status values | Extension to `SessionResult` | Clean non-failure outcomes for lock contention and budget abort |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Redis `SET NX PX` inline lock | `redlock` npm package (Redlock algorithm) | `redlock` handles multi-node Redis; overkill for single-node; `SET NX PX` is correct for this deployment |
| Redis key for CI heal state | New `ciHealingState` DB table | Redis key is simpler, avoids migration; downside: lost on Redis flush. For short-lived failure tracking, Redis is appropriate |
| `TokenBudgetExceededError` thrown between tasks | Mid-task interrupt via `AbortController` | Mid-task abort is complex and can leave DB in inconsistent state. Between-task abort is clean — task is either complete or not started |
| Dedicated `autonomous-sessions` BullMQ queue | Reuse existing `agent-tasks` queue | Dedicated queue allows independent concurrency (1) and lockDuration without affecting agent task processing |

**Installation:** No new npm packages required. `ioredis` is already a dependency via `packages/queue`. All BullMQ patterns are established.

---

## Architecture Patterns

### Recommended Project Structure

```
apps/agent-server/src/
├── services/
│   ├── autonomous-executor.ts      # EXTEND: per-task token tracking + TokenBudgetExceededError
│   ├── ci-self-heal.ts             # NEW: CiSelfHealService
│   └── distributed-lock.ts        # NEW: DistributedLockService
├── autonomous-session.ts           # EXTEND: acquire/release lock, catch TokenBudgetExceededError
packages/queue/src/
├── queues.ts                       # EXTEND: AUTONOMOUS_SESSIONS queue name + AutonomousSessionJob type
├── workers.ts                      # EXTEND: autonomousSession processor type + worker registration
├── scheduler.ts                    # EXTEND: add autonomous-session recurring job
```

### Pattern 1: Distributed Lock via Redis `SET NX PX`

**What:** Acquire a named lock with TTL before starting a session; release on completion/error. If acquire fails, log and skip — do NOT queue another session.

**When to use:** Called at the top of `runAutonomousSession()` (before `createWorkSession`). Lock TTL = session `timeBudgetMs` + 120s buffer.

**Example:**
```typescript
// apps/agent-server/src/services/distributed-lock.ts
import Redis from "ioredis";

export class DistributedLockService {
  constructor(private redis: Redis) {}

  /**
   * Attempt to acquire a named lock with TTL.
   * Returns the lock token (caller identity) if acquired, null if already held.
   * Uses Redis SET NX PX — only sets if key does not exist.
   */
  async acquire(lockKey: string, ttlMs: number): Promise<string | null> {
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await this.redis.set(lockKey, token, "NX", "PX", ttlMs);
    return result === "OK" ? token : null;
  }

  /**
   * Release lock only if caller still holds it (compare-and-delete via Lua).
   * Prevents a late-releasing caller from deleting a lock held by a newer session.
   */
  async release(lockKey: string, token: string): Promise<boolean> {
    // Lua script ensures atomicity: check value, delete only if it matches
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await (this.redis as any).eval(luaScript, 1, lockKey, token) as number;
    return result === 1;
  }

  async isLocked(lockKey: string): Promise<boolean> {
    return (await this.redis.exists(lockKey)) === 1;
  }
}

export const AUTONOMOUS_SESSION_LOCK = "autonomous-session:lock";
```

**Usage in `runAutonomousSession()`:**
```typescript
// apps/agent-server/src/autonomous-session.ts
const lockTtlMs = timeBudgetMs + 120_000;
const lockToken = await lockService.acquire(AUTONOMOUS_SESSION_LOCK, lockTtlMs);
if (!lockToken) {
  logger.warn({ trigger }, "autonomous session skipped — another session is already running");
  return {
    sessionId: "",
    status: "skipped",
    summary: "Another autonomous session is already running",
    tokensUsed: 0,
    durationMs: 0,
  };
}

try {
  // ... run session ...
} finally {
  await lockService.release(AUTONOMOUS_SESSION_LOCK, lockToken);
}
```

### Pattern 2: Recurring Autonomous Session BullMQ Job

**What:** Register an autonomous session recurring job in `setupRecurringJobs()` using `upsertJobScheduler()`. Wire a handler in `worker.ts` (not `queue.ts`) that calls `runAutonomousSession()`.

**When to use:** Added to `setupRecurringJobs()` so it runs at server startup. Interval controlled by `AUTONOMOUS_SESSION_INTERVAL_MINUTES` env var (default: 30).

**Example:**
```typescript
// Extension to packages/queue/src/scheduler.ts
// Add inside setupRecurringJobs():

const autonomousSessionIntervalMinutes =
  Number(options?.autonomousSessionIntervalMinutes ?? process.env.AUTONOMOUS_SESSION_INTERVAL_MINUTES ?? 30);
const autonomousSessionIntervalMs = autonomousSessionIntervalMinutes * 60 * 1000;

const autonomousQueue = getAutonomousSessionQueue();
await autonomousQueue.upsertJobScheduler(
  "recurring-autonomous-session",
  { every: autonomousSessionIntervalMs },
  {
    name: "autonomous-session",
    data: { trigger: "schedule" } satisfies AutonomousSessionJob,
  },
);
logger.info({ intervalMin: autonomousSessionIntervalMinutes }, "Scheduled recurring autonomous session");
```

**Queue type additions in `packages/queue/src/queues.ts`:**
```typescript
export interface AutonomousSessionJob {
  trigger: "schedule" | "manual" | "ci-heal";
  tokenBudget?: number;
  timeBudgetMs?: number;
  prompt?: string;
}

export const QUEUE_NAMES = {
  // ... existing entries ...
  AUTONOMOUS_SESSIONS: "autonomous-sessions",
} as const;

export function getAutonomousSessionQueue(): Queue<AutonomousSessionJob> {
  return getOrCreateQueue<AutonomousSessionJob>(QUEUE_NAMES.AUTONOMOUS_SESSIONS);
}
```

**Worker registration in `packages/queue/src/workers.ts`:**
```typescript
export type AutonomousSessionProcessor = (job: Job<AutonomousSessionJob>) => Promise<void>;

export interface WorkerProcessors {
  // ... existing ...
  autonomousSession?: AutonomousSessionProcessor;
}

// In startWorkers():
if (processors.autonomousSession) {
  const worker = new Worker<AutonomousSessionJob>(
    QUEUE_NAMES.AUTONOMOUS_SESSIONS,
    processors.autonomousSession,
    {
      connection,
      concurrency: 1,              // exactly one autonomous session at a time
      lockDuration: 1_800_000,     // 30 min — matches default session budget
      stalledInterval: 60_000,
      maxStalledCount: 1,
    },
  );
  attachWorkerEvents(worker, QUEUE_NAMES.AUTONOMOUS_SESSIONS);
  activeWorkers.push(worker);
}
```

**Critical: Register in `worker.ts`, NOT in `queue.ts` plugin (HTTP server process):**
```typescript
// apps/agent-server/src/worker.ts — extend the existing processors
autonomousSession: async (job) => {
  const { trigger, tokenBudget, timeBudgetMs, prompt } = job.data;
  logger.info({ jobId: job.id, trigger }, "Starting autonomous session from queue");
  const { runAutonomousSession } = await import("./autonomous-session.js");
  await runAutonomousSession(
    db, registry, embeddingService, sandboxService, workspaceService, messagingService,
    { trigger, tokenBudget, timeBudgetMs, prompt },
  );
},
```

### Pattern 3: Per-Session Token Budget Hard Abort

**What:** After each task completes in `AutonomousExecutorService.executeGoal()`, accumulate tokens and throw `TokenBudgetExceededError` if the running total exceeds the session budget. Caller catches this error and records status as `"aborted"`.

**Example:**
```typescript
// apps/agent-server/src/services/autonomous-executor.ts

export class TokenBudgetExceededError extends Error {
  constructor(
    public readonly tokensUsed: number,
    public readonly budget: number,
    public readonly lastTaskTitle?: string,
  ) {
    super(
      `Token budget exceeded: used ${tokensUsed} of ${budget} tokens` +
      (lastTaskTitle ? ` after task "${lastTaskTitle}"` : ""),
    );
    this.name = "TokenBudgetExceededError";
  }
}

// Extend executeGoal() opts:
async executeGoal(opts: {
  goalId: string;
  userId?: string;
  workSessionId: string;
  repoDir?: string;
  createPr?: boolean;
  tokenBudget?: number;   // NEW — per-session hard limit
  onProgress?: TaskProgressCallback;
}): Promise<{ progress: DispatcherProgress; actions: WorkLogAction[]; tokensUsed: number }> {

  let cumulativeTokens = 0;

  const progress = await this.dispatcher.runGoal(opts.goalId, opts.userId, async (event) => {
    // Accumulate tokens from each completed task
    if (event.status === "completed" && (event as any).tokensUsed) {
      cumulativeTokens += (event as any).tokensUsed as number;
      if (opts.tokenBudget && cumulativeTokens > opts.tokenBudget) {
        throw new TokenBudgetExceededError(cumulativeTokens, opts.tokenBudget, event.taskTitle);
      }
    }
    actions.push({ /* ... existing logic ... */ });
    await opts.onProgress?.(event);
  });

  return { progress, actions, tokensUsed: cumulativeTokens };
}
```

**In `runAutonomousSession()` — clean abort on budget exceeded:**
```typescript
// apps/agent-server/src/autonomous-session.ts
import { TokenBudgetExceededError } from "./services/autonomous-executor.js";

try {
  const { progress, actions, tokensUsed } = await executor.executeGoal({
    goalId: topGoal.id,
    tokenBudget,  // pass budget into executor
    workSessionId: session.id,
    repoDir: ...,
    createPr: true,
    onProgress: ...,
  });
  totalTokens = tokensUsed;
  status = progress.status === "completed" ? "completed" : "failed";
  summary = `Executed goal "${topGoal.title}" — ${progress.completedTasks}/${progress.totalTasks} tasks`;
} catch (err) {
  if (err instanceof TokenBudgetExceededError) {
    status = "aborted";
    totalTokens = err.tokensUsed;
    summary = `Session aborted: token budget (${tokenBudget}) exceeded. ${err.message}. No partial commits made.`;
    logger.warn({ sessionId: session.id, tokensUsed: err.tokensUsed, budget: tokenBudget }, "session aborted: token budget exceeded");
  } else {
    throw err; // re-throw unexpected errors
  }
}
```

**Note:** The `workSessions.status` column is `text` (not an enum) — verified from `schema.ts` line 309. Adding `"aborted"` and `"skipped"` requires no DB migration.

### Pattern 4: CI Self-Heal Service (SCHED-04)

**What:** A service that persists CI failure counts across monitoring cycles in Redis. After 2 consecutive failures for the same repo+branch, it triggers an autonomous session with a CI-fix directive and gates the PR under yellow-tier approval.

**When to use:** Called from the monitoring queue processor in `queue.ts` plugin when `check === "github_ci"`.

**Example:**
```typescript
// apps/agent-server/src/services/ci-self-heal.ts
import type Redis from "ioredis";
import type { Db } from "@ai-cofounder/db";
import type { LlmRegistry } from "@ai-cofounder/llm";
import type { NotificationService } from "./notifications.js";

interface CiHealState {
  count: number;
  firstFailedAt: string;
  lastFailedAt?: string;
  lastWorkflowUrl?: string;
  healAttempted: boolean;
}

export class CiSelfHealService {
  private readonly HEAL_KEY_PREFIX = "ci-heal:";
  private readonly FAILURE_THRESHOLD = 2;
  private readonly KEY_TTL_SECONDS = 7 * 24 * 3600; // 7 days

  constructor(
    private readonly redis: Redis,
    private readonly notificationService: NotificationService,
  ) {}

  private failureKey(repo: string, branch: string): string {
    return `${this.HEAL_KEY_PREFIX}${repo}:${branch}`;
  }

  async recordFailure(repo: string, branch: string, workflowUrl: string): Promise<void> {
    // Skip autonomous PR branches — never trigger self-heal for them
    if (branch.startsWith("autonomous/") || branch.startsWith("dependabot/")) return;

    const key = this.failureKey(repo, branch);
    const existing = await this.redis.get(key);
    const state: CiHealState = existing
      ? (JSON.parse(existing) as CiHealState)
      : { count: 0, firstFailedAt: new Date().toISOString(), healAttempted: false };

    state.count += 1;
    state.lastWorkflowUrl = workflowUrl;
    state.lastFailedAt = new Date().toISOString();
    await this.redis.set(key, JSON.stringify(state), "EX", this.KEY_TTL_SECONDS);

    if (state.count >= this.FAILURE_THRESHOLD && !state.healAttempted) {
      state.healAttempted = true;
      await this.redis.set(key, JSON.stringify(state), "EX", this.KEY_TTL_SECONDS);
      await this.triggerHealSession(repo, branch, state);
    }
  }

  async recordSuccess(repo: string, branch: string): Promise<void> {
    await this.redis.del(this.failureKey(repo, branch));
  }

  async getState(repo: string, branch: string): Promise<CiHealState | null> {
    const raw = await this.redis.get(this.failureKey(repo, branch));
    return raw ? (JSON.parse(raw) as CiHealState) : null;
  }

  private async triggerHealSession(repo: string, branch: string, state: CiHealState): Promise<void> {
    await this.notificationService.sendBriefing(
      `**CI Self-Heal triggered**\n` +
      `Repo \`${repo}\` (branch: \`${branch}\`) has failed ${state.count} consecutive times.\n` +
      `First failure: ${state.firstFailedAt}\n` +
      `Last workflow: ${state.lastWorkflowUrl ?? "unknown"}\n` +
      `Queuing autonomous fix session...`,
    );

    const { getAutonomousSessionQueue } = await import("@ai-cofounder/queue");
    await getAutonomousSessionQueue().add("autonomous-session", {
      trigger: "ci-heal",
      prompt:
        `URGENT: Fix persistent CI failure on ${repo} (branch: ${branch}). ` +
        `CI has failed ${state.count} consecutive times since ${state.firstFailedAt}. ` +
        `Workflow URL: ${state.lastWorkflowUrl}. ` +
        `Fetch the failing workflow jobs via GitHub API, identify the root cause from the step names, ` +
        `fix the code, commit the fix on a new branch, and create a PR. ` +
        `The PR requires yellow-tier approval before merging — use request_approval tool.`,
    } satisfies import("@ai-cofounder/queue").AutonomousSessionJob);
  }
}
```

**Integration into monitoring processor (extend `apps/agent-server/src/plugins/queue.ts`):**
```typescript
case "github_ci": {
  const ciResults = await app.monitoringService.checkGitHubCI();
  // Track failures for self-healing (SCHED-04)
  if (app.ciSelfHealService) {
    for (const ci of ciResults) {
      if (ci.conclusion === "failure") {
        await app.ciSelfHealService.recordFailure(ci.repo, ci.branch, ci.url);
      } else if (ci.conclusion === "success") {
        await app.ciSelfHealService.recordSuccess(ci.repo, ci.branch);
      }
    }
  }
  break;
}
```

### Pattern 5: `SessionResult` status extension

```typescript
// apps/agent-server/src/autonomous-session.ts
export interface SessionResult {
  sessionId: string;
  status: "completed" | "failed" | "timeout" | "skipped" | "aborted";  // extend with 2 new values
  summary: string;
  tokensUsed: number;
  durationMs: number;
}
```

### Anti-Patterns to Avoid

- **Redis `SET NX` without expiry (PX):** If the server crashes mid-session, the lock is held forever. Always use `PX <ttl>` where TTL > session budget.
- **Acquiring lock after `createWorkSession()`:** A failed lock acquisition after session creation leaves a dangling "running" session in the DB. Acquire lock first, create session second.
- **Token tracking only at session level:** The current `totalTokens` in `runAutonomousSession()` accumulates after the orchestrator returns. For mid-execution abort, accumulation must happen inside `AutonomousExecutorService` after each task.
- **CI heal triggering on first failure:** Single-run CI failures are common (flaky tests, rate limits). The 2-cycle confirmation prevents wasting tokens on transient failures.
- **Registering `autonomousSession` processor in `queue.ts` HTTP plugin:** Autonomous sessions are long-running (up to 15+ minutes). They must run in the dedicated `worker.ts` process. The `queue.ts` plugin already omits `agentTask` for exactly this reason (see comment on line 29).
- **Triggering CI heal for `autonomous/*` branches:** The heal loop should only fire for stable branches (`main`, `master`). Autonomous PR branches are short-lived and expected to sometimes have CI issues.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Distributed mutex | Custom in-memory flag | Redis `SET NX PX` via ioredis (already in project) | In-memory flag doesn't work across multiple server instances or restarts |
| Recurring scheduler | `setInterval()` | BullMQ `upsertJobScheduler()` | BullMQ persists job schedule in Redis, survives restarts, supports cron patterns, deduplicates |
| GitHub CI log fetching | New GitHub API client | Extend existing `MonitoringService.checkGitHubCI()` | Error handling, auth token injection, rate limiting already implemented |
| Token counter | New token counting service | Accumulate from task progress events in existing callback | `TaskDispatcher` already emits per-task data in progress callbacks |
| CI failure persistence across restarts | In-memory Map | Redis string with JSON + TTL | In-memory state lost on restart; Redis is already available |
| Yellow-tier PR approval | Custom approval flow | Existing `request_approval` tool + `AutonomyTierService` | Phase 9 built the full approval pipeline with Slack/Discord delivery |

**Key insight:** Every individual component exists. Phase 11's job is composition: wire the scheduler, add the lock wrapper, harden the token abort, and add the CI state machine.

---

## Common Pitfalls

### Pitfall 1: Lock TTL shorter than session budget

**What goes wrong:** Session runs for 16 minutes; lock TTL was set to 15 minutes; lock expires and a second session starts concurrently.
**Why it happens:** `timeBudgetMs` is the soft budget; actual session can run longer on slow LLM responses.
**How to avoid:** Set lock TTL to `timeBudgetMs + 120_000` (2-minute buffer). The `finally` block releases early on clean completion.
**Warning signs:** Two `workSessions` records with `status = "running"` concurrently in the DB.

### Pitfall 2: Token budget checking only at session level (existing code gap)

**What goes wrong:** A single task uses 60,000 tokens; `tokenBudget` is 50,000; session completes all tasks before the post-hoc check triggers the warning. Code is already committed.
**Why it happens:** Current `runAutonomousSession()` checks `totalTokens > tokenBudget` only after `orchestrator.run()` returns (line 290). This is warn-only and post-hoc.
**How to avoid:** Accumulate tokens in `AutonomousExecutorService` after each task's progress event with `status === "completed"`. Throw `TokenBudgetExceededError` after the task that pushes over budget. Clean abort between tasks, no partial state.
**Warning signs:** Sessions use significantly more tokens than `SESSION_TOKEN_BUDGET` with no abort.

### Pitfall 3: Lock not released on unhandled error

**What goes wrong:** An unexpected error escapes the try/catch; the `finally` block with lock release is missing; only the lock TTL saves the situation.
**Why it happens:** `finally` is easy to forget when restructuring try/catch blocks.
**How to avoid:** Use a try/finally pattern around the entire session body (after lock acquisition). `finally` always calls `lockService.release()`.
**Warning signs:** `isLocked()` returns true with no active session in DB.

### Pitfall 4: CI heal triggering on autonomous feature branches

**What goes wrong:** The CI heal loop detects the heal PR's own workflow run failing, creates a new heal session, causing infinite recursion.
**Why it happens:** `GITHUB_MONITORED_REPOS` watches all branches including `autonomous/*` branches that CI heal creates.
**How to avoid:** `CiSelfHealService.recordFailure()` must filter: skip branches starting with `autonomous/` or `dependabot/`. Only heal `main`, `master`, or configured stable branches.
**Warning signs:** CI heal sessions spawning CI heal sessions in the work session log.

### Pitfall 5: `TaskDispatcher` progress event missing `tokensUsed`

**What goes wrong:** Token accumulation in `AutonomousExecutorService` reads `event.tokensUsed` from the progress callback, but the dispatcher doesn't populate that field.
**Why it happens:** `TaskProgressEvent` interface may not currently include `tokensUsed`.
**How to avoid:** During implementation, inspect `TaskDispatcher.runGoal()` and the `TaskProgressEvent` type. If `tokensUsed` is absent from the event, query `getTodayTokenTotal()` before and after each task completion as a proxy, or read from `llmUsage` table by `taskId` post-completion.
**Warning signs:** Token accumulator stays at 0 throughout execution despite model calls.

### Pitfall 6: BullMQ `lockDuration` too short for autonomous sessions

**What goes wrong:** BullMQ marks the autonomous session job as "stalled" (lock expired) at 10 minutes while the session is still running. It re-queues the job, starting a second session.
**Why it happens:** BullMQ has a separate `lockDuration` from the Redis distributed session lock. They are independent.
**How to avoid:** Set `lockDuration: 1_800_000` (30 minutes) for the autonomous sessions worker — matches the default `SESSION_TIME_BUDGET_MS` (900_000 = 15 min) with 2x buffer. The agent-tasks worker already uses `lockDuration: 600_000` as a reference.
**Warning signs:** Work sessions suddenly appear as "failed" at the 10-minute mark; BullMQ stalled job counter increments.

---

## Code Examples

Verified patterns from existing codebase (HIGH confidence):

### Adding a recurring job to `setupRecurringJobs()` (existing pattern)
```typescript
// Source: packages/queue/src/scheduler.ts lines 34-49 (monitoring check pattern)
await autonomousQueue.upsertJobScheduler(
  "recurring-autonomous-session",
  { every: intervalMs },
  { name: "autonomous-session", data: { trigger: "schedule" } satisfies AutonomousSessionJob },
);
```

### ioredis connection creation (existing pattern from pubsub.ts)
```typescript
// Source: packages/queue/src/pubsub.ts lines 92-104
import Redis from "ioredis";
const redis = new Redis({
  host: connectionOptions.host ?? "localhost",
  port: connectionOptions.port ?? 6379,
  password: connectionOptions.password,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});
```

### Checking for currently-running work sessions (existing query pattern)
```typescript
// Source: packages/db/src/repositories.ts lines 1215-1221 (listRecentWorkSessions)
// Supplementary lock check — query for running sessions:
const running = await db
  .select()
  .from(workSessions)
  .where(eq(workSessions.status, "running"))
  .limit(1);
const hasActiveSession = running.length > 0;
```

### Registering a new worker processor (existing pattern from workers.ts)
```typescript
// Source: packages/queue/src/workers.ts lines 57-71 (agentTask worker)
const worker = new Worker<AutonomousSessionJob>(
  QUEUE_NAMES.AUTONOMOUS_SESSIONS,
  processors.autonomousSession,
  {
    connection,
    concurrency: 1,
    lockDuration: 1_800_000,  // 30 min
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
);
attachWorkerEvents(worker, QUEUE_NAMES.AUTONOMOUS_SESSIONS);
activeWorkers.push(worker);
```

### Test mock pattern for ioredis (follows existing service test conventions)
```typescript
// Mock Redis for DistributedLockService tests
const mockRedis = {
  set: vi.fn().mockResolvedValue("OK"),    // acquire succeeds
  exists: vi.fn().mockResolvedValue(0),    // not locked
  del: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
};
// Simulate contention — first acquire succeeds, second fails:
mockRedis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
```

### GitHub workflow jobs API (extends MonitoringService pattern)
```typescript
// Source: apps/agent-server/src/services/monitoring.ts lines 91-139 (checkGitHubCI pattern)
// For CI heal — fetch failing job names via jobs endpoint (returns structured JSON, no ZIP):
const jobsRes = await fetch(
  `https://api.github.com/repos/${repo}/actions/runs/${runId}/jobs`,
  {
    headers: {
      Authorization: `Bearer ${this.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  },
);
// Returns: { jobs: [{ name, status, conclusion, steps: [{ name, conclusion }] }] }
```

---

## State of the Art

| Old Approach | Current Approach | Changed In | Impact on Phase 11 |
|--------------|------------------|------------|---------------------|
| In-process `setInterval` for scheduling | BullMQ `upsertJobScheduler` with Redis persistence | Phase 6 (JARVIS) | Recurring autonomous session must use same BullMQ pattern |
| No autonomous execution | `runAutonomousSession()` + `AutonomousExecutorService` + `listGoalBacklog()` | Phase 10 | Fully functional execution; Phase 11 just schedules and protects it |
| No distributed coordination | Single-server in-memory assumption (implicit) | Phase 10 | Phase 11 replaces implicit assumption with explicit Redis lock |
| Token budget: warn-only post-hoc | Token budget: warn-only post-hoc (unchanged) | Phase 10 | Phase 11 changes to hard abort mid-execution |
| CI monitoring: notification only | CI monitoring: notification + state tracking | Phase 11 adds | CiSelfHealService is net-new — no existing foundation beyond `checkGitHubCI()` |

**What Phase 11 must not re-implement:**
- The execution engine (`AutonomousExecutorService`, `TaskDispatcher`, `runAutonomousSession()`) — Phase 10 deliverables
- BullMQ queue infrastructure — already in `packages/queue`
- Monitoring and alerting pipeline — `MonitoringService` + notification workers exist
- Yellow-tier approval flow — Phase 9 deliverable, fully wired
- GitHub API integration — already in `MonitoringService` and `executeCreatePr()`

---

## Open Questions

1. **`TaskProgressEvent.tokensUsed` field existence**
   - What we know: `AgentProgressEvent` in `pubsub.ts` has `{goalId, goalTitle, taskId, taskTitle, agent, status, completedTasks, totalTasks, output?}` — no `tokensUsed` field
   - What's unclear: Whether `TaskDispatcher.runGoal()` progress callback includes token usage per-task
   - Recommendation: During implementation inspect `dispatcher.ts`. If `tokensUsed` is absent, after each task completes call `getCostByGoal(db, goalId)` and diff with the previous call to get the per-task delta. Slightly less efficient but correct.

2. **`CiSelfHealService` Redis vs DB for failure state**
   - What we know: Redis keys are simpler, no migration needed; DB is more durable and queryable
   - What's unclear: Whether CI heal history needs to be queryable in Phase 16 dashboard
   - Recommendation: Use Redis for Phase 11 (simpler, no migration); the Redis key structure is easily migrated to a DB table in Phase 16. Key: `ci-heal:{repo}:{branch}`, value: JSON `CiHealState`.

3. **GitHub workflow job logs format**
   - What we know: `GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs` returns a ZIP archive; `GET .../runs/{run_id}/jobs` returns structured JSON
   - What's unclear: Whether step names + conclusions from the jobs endpoint are sufficient context for the LLM to diagnose failures
   - Recommendation: Use the jobs endpoint — step names like "Run vitest" with `conclusion: "failure"` plus the overall run URL give the CoderAgent enough to work with. Full log download is not needed for most common failures (test failures, lint errors, type errors).

4. **`enqueueAutonomousSession` helper placement**
   - What we know: `packages/queue/src/helpers.ts` already has `enqueueAgentTask`, `enqueueBriefing`, etc.
   - What's unclear: Whether `CiSelfHealService` should call `getAutonomousSessionQueue().add()` directly or use a helper
   - Recommendation: Add `enqueueAutonomousSession()` to `helpers.ts` for consistency and export from `packages/queue/src/index.ts`. `CiSelfHealService` should use the helper.

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
| SCHED-01 | `setupRecurringJobs()` registers an `autonomous-session` recurring job in BullMQ | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "scheduler.*autonomous"` | Wave 0 gap |
| SCHED-01 | Autonomous session queue processor calls `runAutonomousSession()` when a job fires | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*queue"` | Wave 0 gap |
| SCHED-02 | `DistributedLockService.acquire()` returns token on first call, null on contention | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "DistributedLock"` | Wave 0 gap |
| SCHED-02 | `DistributedLockService.release()` succeeds only when token matches | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "DistributedLock.*release"` | Wave 0 gap |
| SCHED-02 | `runAutonomousSession()` returns `status: "skipped"` when lock is held | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*skipped"` | ✅ `autonomous-session.test.ts` (extend) |
| SCHED-03 | `TokenBudgetExceededError` thrown when cumulative task tokens exceed budget | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "TokenBudget"` | Wave 0 gap |
| SCHED-03 | `runAutonomousSession()` records `status: "aborted"` when `TokenBudgetExceededError` caught | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*aborted"` | ✅ `autonomous-session.test.ts` (extend) |
| SCHED-03 | No git commit when session aborted mid-execution | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "abort.*commit"` | Wave 0 gap |
| SCHED-04 | `CiSelfHealService.recordFailure()` increments count and does NOT trigger heal on first failure | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "CiSelfHeal.*first"` | Wave 0 gap |
| SCHED-04 | `CiSelfHealService.recordFailure()` triggers heal after 2nd consecutive failure | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "CiSelfHeal.*trigger"` | Wave 0 gap |
| SCHED-04 | `CiSelfHealService.recordSuccess()` clears Redis failure state | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "CiSelfHeal.*success"` | Wave 0 gap |
| SCHED-04 | `healAttempted: true` prevents double-triggering of heal session | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "healAttempted\|double.*trigger"` | Wave 0 gap |
| SCHED-04 | `autonomous/*` branches are skipped — no heal triggered for them | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "ci.*heal.*branch.*skip"` | Wave 0 gap |

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server -- --run --reporter=verbose`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~45 seconds

### Wave 0 Gaps (must be created before implementation)

- [ ] `apps/agent-server/src/__tests__/distributed-lock.test.ts` — covers SCHED-02: acquire/release/contention/compare-and-delete/TTL behavior
- [ ] `apps/agent-server/src/__tests__/ci-self-heal.test.ts` — covers SCHED-04: recordFailure (1x, 2x), recordSuccess, healAttempted guard, autonomous/* branch skip, double-trigger prevention
- [ ] Extend `apps/agent-server/src/__tests__/autonomous-session.test.ts` — add SCHED-02 lock-skip test case and SCHED-03 token-abort test case
- [ ] Extend `apps/agent-server/src/__tests__/autonomous-executor.test.ts` — add SCHED-03 per-task token accumulation and `TokenBudgetExceededError` throw behavior
- [ ] No new `mockDbModule()` entries needed — Redis key storage used for CI heal state (no new DB functions required for Phase 11)

*(Note: `DistributedLockService` and `CiSelfHealService` operate entirely via Redis — no DB schema changes required)*

---

## Sources

### Primary (HIGH confidence)

- Direct source code inspection: `apps/agent-server/src/autonomous-session.ts` — existing `runAutonomousSession()`, `SessionOptions`, `SessionResult`, token tracking, warn-only budget check at line 290
- Direct source code inspection: `apps/agent-server/src/services/autonomous-executor.ts` — `executeGoal()` signature, progress callback shape, existing post-task hook location
- Direct source code inspection: `packages/queue/src/scheduler.ts` — `setupRecurringJobs()` pattern, `upsertJobScheduler()` usage with `every` and `pattern` options
- Direct source code inspection: `packages/queue/src/workers.ts` — `WorkerProcessors` interface, worker registration pattern, concurrency/lockDuration settings
- Direct source code inspection: `packages/queue/src/queues.ts` — queue name constants, `getOrCreateQueue()` pattern, all job type interfaces
- Direct source code inspection: `packages/queue/src/pubsub.ts` — ioredis connection pattern (`new Redis({host, port, password, maxRetriesPerRequest: null})`), available raw Redis commands
- Direct source code inspection: `packages/queue/src/connection.ts` — `getRedisConnection()` returns `ConnectionOptions` with host/port/password
- Direct source code inspection: `apps/agent-server/src/plugins/queue.ts` — "agentTask intentionally omitted" comment at line 29, all existing processor registrations, `app.monitoringService` Fastify decorator
- Direct source code inspection: `apps/agent-server/src/services/monitoring.ts` — `checkGitHubCI()` return type, `GitHubCIStatus` interface (repo, branch, status, conclusion, url, updatedAt)
- Direct source code inspection: `packages/db/src/schema.ts` lines 300-313 — `workSessions.status` is `text` not enum, safely extensible
- Direct source code inspection: `packages/db/src/repositories.ts` — `createWorkSession`, `completeWorkSession`, `listRecentWorkSessions`, `getTodayTokenTotal`
- Direct source code inspection: `packages/queue/src/pubsub.ts` lines 19-30 — `AgentProgressEvent` interface (confirmed no `tokensUsed` field)
- Direct source code inspection: `packages/test-utils/src/mocks/db.ts` — full `mockDbModule()` confirms no Phase 11 DB function additions needed
- Direct source code inspection: `apps/agent-server/src/__tests__/autonomous-session.test.ts` — existing test cases and mock patterns
- Direct source code inspection: CLAUDE.md — build order, test mocking rules, `optionalEnv` 2-arg requirement

### Secondary (MEDIUM confidence)

- `.planning/phases/10-autonomous-execution-engine/10-RESEARCH.md` — Phase 10 component inventory, pitfall about lock at note in Pitfall 1
- `.planning/REQUIREMENTS.md` — SCHED requirements verbatim
- Redis `SET NX PX` documentation (industry-standard atomic lock primitive) — verified behavior from Redis documentation

### Tertiary (LOW confidence)

- None — all findings are from direct source inspection or well-established Redis primitives

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components verified by reading source files directly
- Architecture (SCHED-01, 02, 03): HIGH — patterns derived directly from existing scheduler.ts, workers.ts, pubsub.ts, autonomous-session.ts
- SCHED-04 CI self-heal: MEDIUM — Redis key storage is correct; GitHub jobs API endpoint based on monitoring.ts patterns; exact log payload format not confirmed (flagged as Open Question 3)
- Test gaps: HIGH — inspected all 75+ existing test files in `__tests__/`

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable codebase, 30-day validity)
