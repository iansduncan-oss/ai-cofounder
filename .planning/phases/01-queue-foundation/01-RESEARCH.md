# Phase 1: Queue Foundation - Research

**Researched:** 2026-03-07
**Domain:** BullMQ + Redis worker architecture within an existing Turborepo monorepo (Fastify/TypeScript)
**Confidence:** HIGH

## Summary

The queue infrastructure already exists in `packages/queue` — BullMQ 5.70.4 is installed, the Redis container is running in docker-compose.yml with AOF persistence, and the queue plugin is wired into the agent-server. However, Phase 1 is **not done**: the critical missing pieces are (1) a dedicated worker entry point that runs as a separate process/Docker container, (2) the HTTP goal-execution routes are still blocking (not queue-backed), (3) `lockDuration` is not configured for long-running agent tasks (default 30s will cause false stall detections on 5-10 min tasks), (4) there is no `GET /api/goals/:id/queue-status` endpoint, and (5) the health route does not report Redis connection state.

The work is roughly 20% scaffolding and 80% wiring: the queue primitives are solid, but making goal execution actually go through the queue requires changes to the goals/execution routes, a new worker entry point with its own Docker CMD, and storing the BullMQ job ID on the goal so status can be looked up later.

**Primary recommendation:** Build the worker entry point (`apps/agent-server/src/worker.ts`) as a standalone Node process that imports `TaskDispatcher` directly from the agent-server package — same image, different CMD. Store `queueJobId` in `goals.metadata` (JSONB) to enable `GET /api/goals/:id/queue-status` without a schema migration. Configure `lockDuration: 600_000` (10 min) on the agent-tasks worker.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUEUE-01 | Redis container in Docker Compose (dev + prod) | Already present in docker-compose.yml; needs adding to docker-compose.prod.yml |
| QUEUE-02 | BullMQ queue module can enqueue goal/task jobs from HTTP route handlers | `packages/queue` exists; goals route needs to call `enqueueAgentTask()` instead of `dispatcher.runGoal()` |
| QUEUE-03 | Worker process picks up jobs and executes via orchestrator/dispatcher | Worker entry point (`src/worker.ts`) does not yet exist |
| QUEUE-04 | Worker runs as separate Docker container (same image, different CMD) | Dockerfile only has one CMD; needs `ENTRYPOINT`/`CMD` override pattern |
| QUEUE-05 | Failed jobs retry with exponential backoff | Already configured in queue defaults (`attempts: 3, backoff: exponential 2000ms`); need to verify agent-tasks worker inherits or sets its own |
| QUEUE-06 | Jobs queryable by status via `GET /api/goals/:id/queue-status` | Endpoint does not exist; requires `Job.fromId()` + `job.getState()` from BullMQ |
| QUEUE-07 | Worker handles SIGTERM — finishes active job before shutdown (120s grace period) | `stopWorkers()` exists but not wired in worker entry point |
| QUEUE-08 | Redis connection health at `GET /health` | Health route currently only checks DB; needs Redis ping |
| QUEUE-09 | Job priorities for urgent vs. routine tasks | Priority map already implemented in `enqueueAgentTask()`; need to expose priority param on `POST /api/goals/:id/execute` |
| QUEUE-12 | Stalled job detection + re-queue (`lockDuration` configured for 5-10 min) | Worker does NOT set `lockDuration`; default is 30s which will cause false stalls |
| QUEUE-13 | Auto-cleanup of completed/failed jobs (removeOnComplete, removeOnFail TTLs) | Queue defaults set `removeOnComplete: { count: 100 }` and `removeOnFail: { count: 50 }` — QUEUE-13 wants TTL-based not count-based; should use `{ age: 86400 }` (24h) instead |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| bullmq | 5.70.4 (installed) | Job queue with Redis backend | Retries, priorities, stalled detection built-in; already chosen |
| ioredis (via bullmq) | transitive | Redis client | BullMQ manages this internally |
| redis:7-alpine | docker image | Redis server | Already in docker-compose.yml with AOF persistence |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @ai-cofounder/queue | workspace:* | Queue abstractions (already built) | Import everywhere instead of raw bullmq |
| @ai-cofounder/shared | workspace:* | Logger + env helpers | Worker entry point needs createLogger, optionalEnv, requireEnv |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| BullMQ | pg-boss (Postgres-based) | Already decided; BullMQ chosen for JARVIS monitoring; ignore |
| Separate worker package | Same app, different entry | Same-image different CMD is simpler; avoids new package overhead |

**Installation:** Nothing new to install — BullMQ and Redis are already configured.

## Architecture Patterns

### Worker Entry Point Pattern
The Dockerfile uses `CMD ["node", "apps/agent-server/dist/index.js"]`. For the worker, use a separate entry point that shares all the same TypeScript code but does NOT start the HTTP server.

```typescript
// apps/agent-server/src/worker.ts
// Source: established pattern for same-image-different-cmd Docker workers

import { requireEnv, optionalEnv, createLogger } from "@ai-cofounder/shared";
import { runMigrations } from "@ai-cofounder/db";
import {
  getRedisConnection,
  startWorkers,
  stopWorkers,
  closeAllQueues,
} from "@ai-cofounder/queue";
import { createDb } from "@ai-cofounder/db";
import { createLlmRegistry } from "./server.js";
import { TaskDispatcher } from "./agents/dispatcher.js";
// ... other services

const logger = createLogger("worker");

async function main() {
  const redisUrl = requireEnv("REDIS_URL");
  getRedisConnection(redisUrl);

  // Bootstrap all services (same as server.ts but no Fastify)
  const db = createDb(requireEnv("DATABASE_URL"));
  const llmRegistry = createLlmRegistry();
  const dispatcher = new TaskDispatcher(llmRegistry, db, ...);

  startWorkers({
    agentTask: async (job) => {
      const { goalId, prompt, userId } = job.data;
      await dispatcher.runGoal(goalId, userId);
    },
  });

  logger.info("Worker started — waiting for jobs");

  const shutdown = async () => {
    logger.info("SIGTERM received — draining active jobs...");
    await stopWorkers();       // waits for active job to finish
    await closeAllQueues();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.error({ err }, "Worker startup failed");
  process.exit(1);
});
```

### Docker Compose Worker Service Pattern
```yaml
# In docker-compose.prod.yml — same image, different CMD
worker:
  image: ai-cofounder-agent-server:latest
  container_name: ai-cofounder-worker
  restart: unless-stopped
  command: ["node", "apps/agent-server/dist/worker.js"]
  stop_grace_period: 120s          # QUEUE-07: 120s to finish active job
  environment:
    - DATABASE_URL=${DATABASE_URL}
    - REDIS_URL=${REDIS_URL}
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    # ... same env vars as agent-server, minus PORT/HOST
  networks:
    - avion_avion_net
  depends_on:
    - redis   # redis service must be in prod compose too
```

### lockDuration Configuration (QUEUE-12 Critical Fix)
```typescript
// In workers.ts — agent-tasks worker MUST override lockDuration
const worker = new Worker<AgentTaskJob>(
  QUEUE_NAMES.AGENT_TASKS,
  processors.agentTask,
  {
    connection,
    concurrency: 1,              // one agent task at a time (CPU/LLM intensive)
    lockDuration: 600_000,       // 10 minutes — prevents false stall detection
    stalledInterval: 30_000,     // check for stalls every 30s (unchanged)
    maxStalledCount: 1,          // re-queue once if stalled, then fail
  },
);
```

**Why this matters:** Default `lockDuration` is 30,000ms (30s). Agent tasks via `TaskDispatcher.runGoal()` can take 5-10 minutes. BullMQ renews the lock every `lockDuration / 2` ms. If the lock renewal fails (e.g., network hiccup), the job gets re-queued as "stalled". Setting `lockDuration: 600_000` means the lock renewal fires every 5 minutes, which is appropriate for 10-minute tasks.

### TTL-Based Job Cleanup (QUEUE-13)
```typescript
// Current: count-based — only keeps last N jobs
defaultJobOptions: {
  removeOnComplete: { count: 100 },   // WRONG for QUEUE-13
  removeOnFail: { count: 50 },
}

// Correct for QUEUE-13: time-based TTL
defaultJobOptions: {
  removeOnComplete: { age: 24 * 3600, count: 1000 },  // 24h TTL, max 1000
  removeOnFail:    { age: 7 * 24 * 3600, count: 500 }, // 7d TTL for debugging
}
```

### Queue-Backed Goal Execution Pattern
The `POST /api/goals/:id/execute` route currently calls `dispatcher.runGoal()` directly (blocking). Phase 1 replaces this with a queue enqueue.

```typescript
// Current (blocking — to be replaced):
const progress = await dispatcher.runGoal(id, userId, onProgress);
return progress;

// New (non-blocking):
const jobId = await enqueueAgentTask({
  goalId: id,
  prompt: goal.description ?? goal.title,
  userId,
  priority: goal.priority as "critical" | "high" | "normal" | "low",
});
// Store jobId in goal.metadata for status lookup
await updateGoalMetadata(app.db, id, { queueJobId: jobId });
return reply.status(202).send({ jobId, status: "queued" });
```

### Job Status Lookup Pattern
```typescript
// GET /api/goals/:id/queue-status
// Source: BullMQ Job.fromId() + job.getState()

import { Job } from "bullmq";
import { getAgentTaskQueue } from "@ai-cofounder/queue";

app.get("/:id/queue-status", async (request, reply) => {
  const goal = await getGoal(app.db, request.params.id);
  if (!goal) return reply.status(404).send({ error: "Goal not found" });

  const metadata = goal.metadata as Record<string, unknown> | null;
  const jobId = metadata?.queueJobId as string | undefined;

  if (!jobId) {
    return { status: "not_queued", goal: goal.status };
  }

  const queue = getAgentTaskQueue();
  const job = await Job.fromId(queue, jobId);
  if (!job) {
    return { status: "not_found", jobId };
  }

  const state = await job.getState();
  // state: "waiting" | "active" | "completed" | "failed" | "delayed" | "unknown"
  return { status: state, jobId, attemptsMade: job.attemptsMade };
});
```

### Redis Health Check Pattern
```typescript
// GET /health — add Redis ping
// Source: ioredis ping via BullMQ connection config

import { getRedisConnection } from "@ai-cofounder/queue";
import Redis from "ioredis";

// In health route:
let redisStatus = "disabled";
const redisUrl = optionalEnv("REDIS_URL", "");
if (redisUrl) {
  try {
    const conn = getRedisConnection();
    const redis = new Redis(conn);
    await redis.ping();
    await redis.quit();
    redisStatus = "ok";
  } catch {
    redisStatus = "unreachable";
  }
}
return { status: dbOk && redisOk ? "ok" : "degraded", redis: redisStatus, ... };
```

**Note:** BullMQ's `getRedisConnection()` returns `ConnectionOptions` (not an ioredis instance). For the health ping, create a separate short-lived Redis client. Alternatively, use `ioredis` directly (it's a transitive dep of bullmq and available in node_modules).

### Recommended Project Structure Changes

```
apps/agent-server/src/
├── index.ts            # HTTP server entry point (unchanged)
├── worker.ts           # NEW: standalone worker entry point
├── server.ts           # buildServer() — HTTP only (unchanged)
├── plugins/
│   └── queue.ts        # queue plugin wired into server (unchanged)
├── routes/
│   ├── goals.ts        # queue-status endpoint added here
│   ├── execution.ts    # POST /:id/execute now enqueues instead of running
│   └── health.ts       # Redis ping added
└── agents/
    └── dispatcher.ts   # unchanged — shared by server and worker
```

### Anti-Patterns to Avoid
- **Running TaskDispatcher in the HTTP server process:** The whole point of Phase 1 is non-blocking HTTP. If the execution route still awaits `dispatcher.runGoal()`, the requirement is not met.
- **Importing bullmq directly in routes:** Always go through `@ai-cofounder/queue` abstractions. `Job.fromId()` is the exception — it requires a direct import.
- **Configuring a second `startWorkers()` call in the HTTP server:** The HTTP server's queue plugin should NOT process `agentTask` jobs — only monitoring/notifications/briefings. Agent task processing belongs exclusively in the worker process.
- **Starting the worker in a `vi.mock`-heavy test:** Use integration-style tests that mock at the service boundary, not unit tests that mock everything.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Job retries | Custom retry loop in `runGoal()` | BullMQ `attempts` + `backoff` options | Handles atomicity, Redis state, interprocess crash recovery |
| Stalled job detection | Timeout + DB polling | BullMQ `lockDuration` + `stalledInterval` | BullMQ uses Redis atomic lock renewal — impossible to replicate correctly by hand |
| Job state query | Custom DB status table | `Job.fromId(queue, jobId).getState()` | BullMQ tracks all state transitions natively in Redis |
| Process shutdown drain | `setTimeout` + counter | `worker.close()` (calls `stopWorkers()`) | BullMQ's close() properly waits for active job processor to return |
| Priority queuing | Array sorting + weight logic | BullMQ `priority` option (already implemented) | Built into BullMQ via Redis sorted sets |

## Common Pitfalls

### Pitfall 1: lockDuration Too Short (CRITICAL for QUEUE-12)
**What goes wrong:** Agent tasks take 5-10 minutes. Default `lockDuration` is 30s. BullMQ renews the lock every 15s. Any transient Redis hiccup during those renewals causes the job to be marked "stalled" and re-queued, potentially running the agent task twice.
**Why it happens:** The default is designed for sub-second jobs (web scrapers, email senders). Long-running AI tasks are an unusual use case.
**How to avoid:** Set `lockDuration: 600_000` on the agent-tasks worker specifically.
**Warning signs:** Log line "Job stalled" within 30 seconds of job start; jobs being re-queued unexpectedly.

### Pitfall 2: Worker Process Missing Services
**What goes wrong:** Worker entry point (`worker.ts`) creates `TaskDispatcher` but forgets to pass `sandboxService`, `workspaceService`, or `embeddingService`. Agent tasks that need these services silently fail or skip tools.
**Why it happens:** `server.ts` decorates the Fastify instance with these services — the worker doesn't use Fastify at all, so they must be constructed explicitly.
**How to avoid:** Mirror the service construction from `server.ts` in `worker.ts`. Check the `TaskDispatcher` constructor signature — it accepts 7 optional parameters.
**Warning signs:** Agent tasks complete successfully but tool executions (read_file, git operations) are skipped.

### Pitfall 3: REDIS_URL Not in Production Docker Compose
**What goes wrong:** `docker-compose.prod.yml` does not define a `redis` service or `REDIS_URL` env var. Worker container fails to start.
**Why it happens:** `docker-compose.prod.yml` is separate from `docker-compose.yml` (which has Redis). The production compose only defines `agent-server`, `discord-bot`, `slack-bot` — no Redis.
**How to avoid:** Add `redis` service definition to `docker-compose.prod.yml` and add `REDIS_URL` env var to both `agent-server` and new `worker` service.
**Warning signs:** `optionalEnv("REDIS_URL", "")` returns empty string; queue plugin logs "REDIS_URL not set — queue system disabled".

### Pitfall 4: queuePlugin Processing Agent Tasks in the HTTP Server
**What goes wrong:** If the queue plugin in `server.ts` registers an `agentTask` processor, agent tasks will be processed by BOTH the HTTP server process and the dedicated worker process simultaneously.
**Why it happens:** `startWorkers()` in the queue plugin currently accepts all processor types. It's easy to add `agentTask` here.
**How to avoid:** The queue plugin in `server.ts` should only register `monitoring`, `notification`, and `briefing` processors. `agentTask` processor belongs only in `worker.ts`.

### Pitfall 5: removeOnComplete Count vs Age Semantics
**What goes wrong:** `removeOnComplete: { count: 100 }` keeps exactly 100 jobs forever — not a TTL. QUEUE-13 requires time-based cleanup.
**Why it happens:** The existing queue defaults use count-based cleanup (implemented before QUEUE-13 was written as a TTL requirement).
**How to avoid:** Use `{ age: 86400, count: 1000 }` where `age` is in seconds. BullMQ removes whichever limit is hit first.

### Pitfall 6: `Job.fromId()` Import Location
**What goes wrong:** `Job` class is not exported from `@ai-cofounder/queue`. It must be imported directly from `bullmq`.
**Why it happens:** The queue package abstracts queue operations but doesn't re-export the `Job` class.
**How to avoid:** `import { Job } from "bullmq"` in the route that needs to look up job state. Or add a `getJobStatus(jobId)` helper to `@ai-cofounder/queue/helpers.ts`.

### Pitfall 7: SSE Streaming Incompatible with Queue-Based Execution
**What goes wrong:** `GET /api/goals/:id/execute/stream` currently streams progress events directly from `TaskDispatcher` running in the HTTP server. Once execution moves to the worker process, this SSE stream has no way to receive progress events from the other process without Redis pub/sub bridging.
**Why it happens:** The stream is direct function call — works in-process, breaks cross-process.
**How to avoid:** Phase 1 should make `POST /api/goals/:id/execute` non-blocking (enqueue only). The SSE stream endpoint (`GET /:id/execute/stream`) should be left as-is OR removed temporarily. STATE.md flags this explicitly: "SSE streaming is the highest-risk integration — plan Phase 2 carefully before executing Phase 1 job migration." Phase 1 does NOT require SSE to work through the queue.

## Code Examples

### BullMQ Worker with lockDuration (Verified against installed source)
```typescript
// Source: BullMQ 5.70.4 Worker class defaults
// Default: lockDuration=30000, stalledInterval=30000, maxStalledCount=1

import { Worker } from "bullmq";

const worker = new Worker<AgentTaskJob>(
  "agent-tasks",
  async (job) => {
    // processor function — job.data is the AgentTaskJob payload
    await runGoalViaDispatcher(job.data);
  },
  {
    connection: getRedisConnection(),
    concurrency: 1,
    lockDuration: 600_000,     // 10 minutes (in ms)
    stalledInterval: 30_000,   // check stalls every 30s
    maxStalledCount: 1,        // re-queue once, then fail
  },
);

// Graceful shutdown
async function shutdown() {
  await worker.close();  // waits for active job to complete
  process.exit(0);
}
process.on("SIGTERM", shutdown);
```

### Job.fromId for Status Query (Verified from BullMQ source line 255)
```typescript
// Source: bullmq/dist/cjs/classes/job.js line 255
// static async fromId(queue, jobId): Promise<Job | undefined>

import { Job } from "bullmq";
import { getAgentTaskQueue } from "@ai-cofounder/queue";

async function getJobStatus(jobId: string) {
  const queue = getAgentTaskQueue();
  const job = await Job.fromId(queue, jobId);
  if (!job) return null;

  const state = await job.getState();
  // Returns: "waiting" | "active" | "completed" | "failed" | "delayed" | "unknown"
  return {
    state,
    attemptsMade: job.attemptsMade,
    finishedOn: job.finishedOn,
    failedReason: job.failedReason,
  };
}
```

### Storing queueJobId in goals.metadata (No migration needed)
```typescript
// Source: @ai-cofounder/db schema — goals.metadata is jsonb
// Pattern used for verification results (see goals.ts route /:id/verification)

async function updateGoalQueueJobId(db: Db, goalId: string, jobId: string) {
  const current = await getGoal(db, goalId);
  const existingMeta = (current?.metadata as Record<string, unknown>) ?? {};
  await db.update(goals)
    .set({ metadata: { ...existingMeta, queueJobId: jobId } })
    .where(eq(goals.id, goalId));
}
```

### ioredis Ping for Health Check
```typescript
// Source: ioredis API (transitive dep of bullmq, available in node_modules)
import Redis from "ioredis";

async function pingRedis(url: string): Promise<"ok" | "unreachable"> {
  const redis = new Redis(url, { lazyConnect: true, connectTimeout: 3000 });
  try {
    await redis.connect();
    await redis.ping();
    return "ok";
  } catch {
    return "unreachable";
  } finally {
    await redis.quit().catch(() => {});
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `removeOnComplete: { count: N }` | `removeOnComplete: { age: N, count: N }` | BullMQ v3+ | Time-based TTL now available alongside count |
| `queue.getJob(id)` | `Job.fromId(queue, id)` | BullMQ v4+ | Static method preferred over queue instance method |
| Polling for stall detection | Built-in `stalledInterval` + `lockDuration` | BullMQ v1 | Handled natively — don't poll |
| `addBulk` for batch | Still recommended | BullMQ 5.x | No change |
| `upsertJobScheduler` | New in BullMQ 5.x | BullMQ v5 | Already used in `scheduler.ts` — compatible |

## Open Questions

1. **ioredis availability for health ping**
   - What we know: `ioredis` is a transitive dependency of `bullmq`, present in `node_modules`
   - What's unclear: Whether importing `ioredis` directly in the health route is safe in the production Docker image (it's not in `package.json` directly)
   - Recommendation: Add `"ioredis": "*"` to the `queue` package devDependencies, or expose a `pingRedis()` helper in `packages/queue/src/connection.ts`

2. **Concurrency for agent-tasks worker**
   - What we know: Currently `concurrency: 2` in workers.ts; agent tasks are LLM-intensive
   - What's unclear: Whether 2 concurrent agent tasks on a single VPS will OOM or hit API rate limits
   - Recommendation: Set `concurrency: 1` for Phase 1 (safe default), make it configurable via env var (`AGENT_WORKER_CONCURRENCY`)

3. **Goal status sync between queue state and DB status**
   - What we know: `goals.status` enum has: `draft | active | completed | cancelled | needs_review`; BullMQ job states are `waiting | active | completed | failed | delayed`
   - What's unclear: Whether the worker should update `goals.status` to `active` when the job is picked up and `completed` when done (or if `dispatcher.runGoal()` already does this)
   - Recommendation: Check `dispatcher.ts` — if it already calls `updateGoalStatus()`, the worker doesn't need extra logic. The queue-status endpoint reads from BullMQ, not the DB.

## Validation Architecture

> Nyquist validation is enabled in .planning/config.json

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (root vitest.config.ts) |
| Config file | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| Quick run command | `npm test -w @ai-cofounder/agent-server -- --reporter=dot 2>&1 \| tail -5` |
| Full suite command | `npm test` (from monorepo root) |
| Estimated runtime | ~30-60 seconds (existing 958 tests; new tests add ~5s) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-01 | Redis in docker-compose | manual | `docker compose config \| grep redis` | ✅ (config check only) |
| QUEUE-02 | `POST /api/goals/:id/execute` returns 202 immediately | unit | `npm test -w @ai-cofounder/agent-server -- --reporter=dot execution-routes` | ❌ Wave 0 gap |
| QUEUE-03 | Worker picks up job and calls dispatcher | unit | `npm test -w @ai-cofounder/agent-server -- --reporter=dot worker` | ❌ Wave 0 gap |
| QUEUE-04 | Docker worker container starts | manual | `docker compose up worker` (smoke test) | N/A |
| QUEUE-05 | Failed job retries 3x with backoff | unit | `npm test -w @ai-cofounder/queue -- --reporter=dot` | ❌ Wave 0 gap |
| QUEUE-06 | `GET /api/goals/:id/queue-status` returns job state | unit | `npm test -w @ai-cofounder/agent-server -- --reporter=dot goals` | ❌ Wave 0 gap |
| QUEUE-07 | SIGTERM causes graceful drain | unit | `npm test -w @ai-cofounder/agent-server -- --reporter=dot worker` | ❌ Wave 0 gap |
| QUEUE-08 | `GET /health` includes redis status | unit | `npm test -w @ai-cofounder/agent-server -- --reporter=dot health` or `routes` | ❌ Wave 0 gap |
| QUEUE-09 | Priority param respected in enqueue | unit | `npm test -w @ai-cofounder/queue -- --reporter=dot` | ❌ Wave 0 gap |
| QUEUE-12 | lockDuration=600000 on agent-tasks worker | unit | `npm test -w @ai-cofounder/queue -- --reporter=dot` | ❌ Wave 0 gap |
| QUEUE-13 | TTL-based cleanup (age not count) | unit | `npm test -w @ai-cofounder/queue -- --reporter=dot` | ❌ Wave 0 gap |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npm test -w @ai-cofounder/agent-server -- --reporter=dot 2>&1 | tail -10`
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** Full suite green before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~15-30 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `packages/queue/src/__tests__/queue.test.ts` — covers QUEUE-05, QUEUE-09, QUEUE-12, QUEUE-13 (retry config, priority mapping, lockDuration value, removeOnComplete TTL)
- [ ] `apps/agent-server/src/__tests__/worker.test.ts` — covers QUEUE-03, QUEUE-07 (worker bootstrap, SIGTERM handling with mocked dispatcher)
- [ ] `apps/agent-server/src/__tests__/queue-status.test.ts` — covers QUEUE-06 (goal queue-status endpoint with mocked BullMQ `Job.fromId`)
- [ ] `apps/agent-server/src/__tests__/health-redis.test.ts` — covers QUEUE-08 (health endpoint with Redis ping mocked)

*(Existing `execution.ts` tests in `routes.test.ts` will need updating to expect 202 + jobId instead of blocking progress response — this is a test update, not a new file)*

## Sources

### Primary (HIGH confidence)
- BullMQ 5.70.4 installed source (`node_modules/bullmq/dist/cjs/classes/worker.js`) — lockDuration defaults, Worker constructor
- BullMQ 5.70.4 installed source (`node_modules/bullmq/dist/cjs/classes/job.js`) — `Job.fromId()` static method, `getState()`
- Project source files — `packages/queue/src/` (all 5 files read), `apps/agent-server/src/plugins/queue.ts`, `apps/agent-server/src/routes/`, `apps/agent-server/src/server.ts`, `apps/agent-server/Dockerfile`
- `docker-compose.yml` — Redis service definition with AOF persistence
- `docker-compose.prod.yml` — MISSING Redis service (confirmed gap)
- `packages/db/src/schema.ts` — `goals.metadata: jsonb` available for storing queueJobId

### Secondary (MEDIUM confidence)
- BullMQ documentation pattern for `lockDuration` on long-running jobs — corroborated by installed source code defaults
- STATE.md note: "SSE streaming is the highest-risk integration" — confirms Phase 1 should leave SSE alone

### Tertiary (LOW confidence)
- ioredis import from transitive dependency — not verified in production Docker build context

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — BullMQ 5.70.4 is installed and verified from source; Redis is running
- Architecture: HIGH — All patterns derived from reading actual project files, not assumptions
- Pitfalls: HIGH — lockDuration default verified from installed source (30s); prod compose gap confirmed by reading docker-compose.prod.yml; SSE risk confirmed from STATE.md
- Test gaps: HIGH — scanned all existing `__tests__` directories; no queue tests exist

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (BullMQ 5.x is stable; Redis 7 is LTS)
