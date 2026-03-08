# Phase 2: SSE Migration - Research

**Researched:** 2026-03-08
**Domain:** Redis pub/sub + Server-Sent Events in Fastify/TypeScript, cross-process event bridging from BullMQ worker to HTTP server
**Confidence:** HIGH

## Summary

Phase 1 left the SSE streaming endpoint (`GET /api/goals/:id/execute/stream`) wired to run `dispatcher.runGoal()` inline on the HTTP server — deliberately deferred for Phase 2. The goal execution now goes through BullMQ in the worker process, which means the HTTP server can no longer stream execution events directly. Phase 2 bridges this gap with Redis pub/sub: the worker publishes task events to a channel while executing, and the SSE endpoint subscribes to that channel and forwards events to the connected browser client.

The critical architectural constraint is that ioredis is not a direct dependency of the project — it is bundled inside BullMQ's own `node_modules`. The Phase 1 health check worked around this using a raw TCP probe (`net.connect`), but pub/sub requires actual Redis commands. The solution is to add `ioredis` as an explicit dependency to `packages/queue`, pinning to the same version BullMQ bundles (5.9.3), which avoids any interface mismatch. An ioredis connection in subscribe mode cannot issue other commands, so the pattern requires two separate Redis connections per pub/sub role: one publisher (in the worker) and one shared subscriber (in the HTTP server plugin), with per-goal event routing via Node's built-in `EventEmitter`.

The replay-on-connect requirement (QUEUE-11 success criterion 2) means pub/sub alone is insufficient since pub/sub has no history. The solution is to write each event to a Redis LIST (`agent-events:history:{goalId}`) in addition to publishing it, then expire that list with a short TTL after the job completes. When an SSE client connects, it reads the list first (replay), then subscribes for live events.

**Primary recommendation:** Add `ioredis@5.9.3` to `packages/queue`, implement `publishEvent()` and a `RedisPubSub` helper class in that package. In the worker, pass an `onProgress` callback to `dispatcher.runGoal()` that calls `publishEvent()`. Replace the SSE stream handler's inline `dispatcher.runGoal()` call with a Redis subscribe + list replay pattern. The existing `useSSE()` dashboard hook requires no changes.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUEUE-10 | Worker publishes real-time events to Redis pub/sub channel during job execution | `dispatcher.runGoal()` already accepts an `onProgress?: TaskProgressCallback` callback; worker calls this with a Redis PUBLISH + RPUSH implementation. Channel name: `agent-events:goal:{goalId}` |
| QUEUE-11 | SSE endpoint subscribes to Redis pub/sub and forwards events to dashboard clients | SSE endpoint replaces inline execution with: (1) LRANGE history replay, (2) Redis subscribe for live events. Existing `useSSE()` hook and `ExecutionPanel` component need no changes. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ioredis | 5.9.3 (pin to match BullMQ) | Redis client for publish and subscribe commands | BullMQ bundles this exact version; adding it explicitly gives TypeScript proper types and avoids path hacking |
| bullmq | 5.70.4 (already installed) | BullMQ's `Job` type and `getRedisConnection()` | Already in queue package; connection config reused |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:events (EventEmitter) | built-in | Route pub/sub messages to per-goal listeners in HTTP server | One global EventEmitter per server avoids one Redis connection per SSE client |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ioredis for pub/sub | Redis Streams (XADD/XREAD) | Streams have better replay and consumer group semantics but are more complex; overkill when jobs are short-lived and a Redis LIST + TTL gives adequate replay |
| ioredis for pub/sub | `redis` npm package (v4) | Different API from ioredis; no advantage over just adding ioredis which BullMQ already depends on |
| Redis LIST for history | In-memory buffer on HTTP server | In-memory buffer is lost on server restart; Redis LIST survives server restarts and works when there are multiple HTTP server instances in the future |
| Shared EventEmitter in HTTP server | Per-client Redis subscriber | Per-client subscriber opens a new Redis connection per connected browser tab — expensive; shared subscriber with an in-process EventEmitter is the standard pattern |

**Installation:**
```bash
npm install ioredis@5.9.3 -w @ai-cofounder/queue
```

## Architecture Patterns

### Recommended Structure

The two new logical components map to existing package boundaries:

```
packages/queue/src/
├── pubsub.ts          # NEW: RedisPubSub class (publish, subscribe, history)
├── connection.ts      # EXISTING: getRedisConnection() — reused for pub/sub clients
├── index.ts           # EXISTING: re-export new exports from pubsub.ts

apps/agent-server/src/
├── worker.ts          # EXISTING: add onProgress callback to dispatcher.runGoal()
├── routes/
│   └── execution.ts   # EXISTING: replace inline runGoal() with Redis subscribe
├── plugins/
│   └── pubsub.ts      # NEW: Fastify plugin that holds shared Redis subscriber
```

### Pattern 1: Redis Pub/Sub Helper in packages/queue

**What:** A `RedisPubSub` class that encapsulates two ioredis connections — one for publishing (and LIST operations), one for subscribing — with typed event payloads.

**When to use:** Called from worker (publish side) and from SSE route (subscribe side).

```typescript
// packages/queue/src/pubsub.ts
// Source: ioredis documentation + established Redis pub/sub patterns

import Redis from "ioredis";
import type { ConnectionOptions } from "bullmq";
import { createLogger } from "@ai-cofounder/shared";

const logger = createLogger("queue-pubsub");

export interface AgentProgressEvent {
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskTitle: string;
  agent: string;
  status: "started" | "completed" | "failed";
  completedTasks: number;
  totalTasks: number;
  output?: string;
  timestamp: number;
}

export interface AgentLifecycleEvent {
  goalId: string;
  type: "job_started" | "job_completed" | "job_failed";
  timestamp: number;
  error?: string;
}

export type AgentEvent = AgentProgressEvent | AgentLifecycleEvent;

const CHANNEL_PREFIX = "agent-events:goal:";
const HISTORY_PREFIX = "agent-events:history:";
const HISTORY_TTL_SECONDS = 3600; // 1 hour — covers any agent task duration + margin

export function goalChannel(goalId: string): string {
  return `${CHANNEL_PREFIX}${goalId}`;
}

export function historyKey(goalId: string): string {
  return `${HISTORY_PREFIX}${goalId}`;
}

export class RedisPubSub {
  private publisher: Redis;
  private logger = createLogger("queue-pubsub");

  constructor(connectionOptions: ConnectionOptions) {
    // ioredis accepts the same options as BullMQ's ConnectionOptions
    this.publisher = new Redis(connectionOptions as ConstructorParameters<typeof Redis>[0]);
    this.publisher.on("error", (err) => {
      this.logger.error({ err }, "Redis publisher error");
    });
  }

  /** Publish an event AND append to history list */
  async publish(goalId: string, event: AgentEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const channel = goalChannel(goalId);
    const key = historyKey(goalId);

    await Promise.all([
      this.publisher.publish(channel, payload),
      this.publisher.rpush(key, payload),
      this.publisher.expire(key, HISTORY_TTL_SECONDS),
    ]);
  }

  /** Replay historical events (for late-joining SSE clients) */
  async getHistory(goalId: string): Promise<AgentEvent[]> {
    const key = historyKey(goalId);
    const raw = await this.publisher.lrange(key, 0, -1);
    return raw.map((s) => JSON.parse(s) as AgentEvent);
  }

  async close(): Promise<void> {
    await this.publisher.quit();
  }
}

/** Create a dedicated subscriber connection (separate from publisher — required by Redis protocol) */
export function createSubscriber(connectionOptions: ConnectionOptions): Redis {
  const sub = new Redis(connectionOptions as ConstructorParameters<typeof Redis>[0]);
  sub.on("error", (err) => {
    logger.error({ err }, "Redis subscriber error");
  });
  return sub;
}
```

### Pattern 2: Worker Publishes via onProgress Callback

**What:** The worker's `agentTask` processor passes an `onProgress` callback to `dispatcher.runGoal()`. This callback calls `redisPubSub.publish()`. The dispatcher already supports this — `TaskProgressCallback` is defined in `dispatcher.ts`.

**When to use:** Every time a task starts, completes, or fails during worker execution.

```typescript
// apps/agent-server/src/worker.ts — modified agentTask processor
// Source: existing TaskProgressCallback type in dispatcher.ts

import { RedisPubSub } from "@ai-cofounder/queue";

// Initialize pub/sub publisher once at worker startup
const redisPubSub = new RedisPubSub(getRedisConnection(redisUrl));

startWorkers({
  agentTask: async (job) => {
    const { goalId, userId } = job.data;

    // Publish job_started lifecycle event
    await redisPubSub.publish(goalId, {
      goalId,
      type: "job_started",
      timestamp: Date.now(),
    });

    try {
      await dispatcher.runGoal(goalId, userId, async (event) => {
        // onProgress callback — fires for every task start/complete/fail
        await redisPubSub.publish(goalId, {
          ...event,
          timestamp: Date.now(),
        });
      });

      await redisPubSub.publish(goalId, {
        goalId,
        type: "job_completed",
        timestamp: Date.now(),
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await redisPubSub.publish(goalId, {
        goalId,
        type: "job_failed",
        error,
        timestamp: Date.now(),
      });
      throw err; // Re-throw so BullMQ handles retries
    }
  },
});
```

### Pattern 3: Shared Subscriber Fastify Plugin

**What:** A Fastify plugin that creates one Redis subscriber connection for the whole server process, subscribes to channels on-demand, and routes messages to per-goal `EventEmitter` listeners. This avoids one Redis connection per SSE client.

**When to use:** Register in `server.ts` alongside the queue plugin.

```typescript
// apps/agent-server/src/plugins/pubsub.ts
import fp from "fastify-plugin";
import { EventEmitter } from "node:events";
import { optionalEnv, createLogger } from "@ai-cofounder/shared";
import { getRedisConnection, createSubscriber, goalChannel } from "@ai-cofounder/queue";
import type { Redis } from "ioredis";

const logger = createLogger("pubsub-plugin");

declare module "fastify" {
  interface FastifyInstance {
    agentEvents: EventEmitter;
  }
}

export const pubsubPlugin = fp(async (app) => {
  const redisUrl = optionalEnv("REDIS_URL", "");
  if (!redisUrl) {
    logger.warn("REDIS_URL not set — pub/sub disabled");
    // Attach a no-op EventEmitter so routes don't need to null-check
    app.decorate("agentEvents", new EventEmitter());
    return;
  }

  const emitter = new EventEmitter();
  emitter.setMaxListeners(200); // allow many concurrent SSE clients

  const subscriber: Redis = createSubscriber(getRedisConnection());

  subscriber.on("message", (channel: string, message: string) => {
    // Emit on the channel name so SSE handlers can listen per-goal
    emitter.emit(channel, message);
  });

  app.decorate("agentEvents", emitter);

  // Helper to subscribe a goal channel on first SSE connect
  app.decorate("subscribeGoal", async (goalId: string) => {
    const channel = goalChannel(goalId);
    const existingCount = emitter.listenerCount(channel);
    if (existingCount === 0) {
      // First subscriber for this goal — register with Redis
      await subscriber.subscribe(channel);
    }
  });

  app.decorate("unsubscribeGoal", async (goalId: string) => {
    const channel = goalChannel(goalId);
    const remainingCount = emitter.listenerCount(channel);
    if (remainingCount === 0) {
      // No more SSE clients watching this goal — release Redis subscription
      await subscriber.unsubscribe(channel);
    }
  });

  app.addHook("onClose", async () => {
    await subscriber.quit();
    logger.info("Pub/sub subscriber closed");
  });
});
```

### Pattern 4: SSE Endpoint Replacing Inline Execution

**What:** The `GET /:id/execute/stream` endpoint in `execution.ts` replaces its inline `dispatcher.runGoal()` call with a Redis subscribe + history replay pattern. The endpoint no longer executes anything — it only listens and streams.

**When to use:** Every time the dashboard calls the streaming SSE endpoint.

```typescript
// apps/agent-server/src/routes/execution.ts — modified stream handler
// Source: ioredis subscribe pattern + existing SSE writeHead/write pattern

app.get<{ Params: { id: string }; Querystring: { userId?: string } }>(
  "/:id/execute/stream",
  { schema: { tags: ["execution"] } },
  async (request, reply) => {
    const { id: goalId } = request.params;
    const channel = goalChannel(goalId);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event: string, data: unknown) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    // Step 1: Replay missed events from Redis history list
    const history = await redisPubSub.getHistory(goalId);
    for (const event of history) {
      const isLifecycle = "type" in event;
      if (isLifecycle && event.type === "job_completed") {
        send("completed", event);
        reply.raw.end();
        return; // Job already done — send final state and close
      } else if (isLifecycle && event.type === "job_failed") {
        send("error", event);
        reply.raw.end();
        return;
      } else if (!isLifecycle) {
        send("progress", event); // task progress event
      }
    }

    send("started", { goalId });

    // Step 2: Subscribe to live events
    const onMessage = (message: string) => {
      try {
        const event = JSON.parse(message);
        const isLifecycle = "type" in event;
        if (isLifecycle && event.type === "job_completed") {
          send("completed", event);
          cleanup();
        } else if (isLifecycle && event.type === "job_failed") {
          send("error", event);
          cleanup();
        } else if (!isLifecycle) {
          send("progress", event);
        }
      } catch { /* ignore malformed messages */ }
    };

    await app.subscribeGoal(goalId);
    app.agentEvents.on(channel, onMessage);

    const cleanup = () => {
      app.agentEvents.off(channel, onMessage);
      app.unsubscribeGoal(goalId).catch(() => {/* non-fatal */});
      if (!reply.raw.writableEnded) reply.raw.end();
    };

    // Handle client disconnect
    reply.raw.on("close", cleanup);
  },
);
```

### Anti-Patterns to Avoid

- **Per-client Redis subscriber:** Opening a new `subscriber.subscribe()` connection for each SSE client will exhaust Redis connection limits at scale. Always use a single shared subscriber with in-process EventEmitter routing.
- **Using the publisher connection for subscribe:** ioredis puts a connection into subscriber mode on the first `subscribe()` call; it can no longer issue regular commands (PUBLISH, LRANGE, EXPIRE). Always maintain separate publisher and subscriber instances.
- **Omitting client disconnect cleanup:** If the SSE handler does not listen for the `reply.raw.on('close')` event, the EventEmitter listener leaks. This currently happens in the existing execution.ts stream handler (it uses `finally` but no disconnect detection).
- **Publishing from the HTTP server during Phase 2:** Only the worker process publishes events. The HTTP server only subscribes. Keeping these roles separate maintains the architecture's process separation.
- **Channel names without namespace prefix:** Using raw goalId as a Redis key risks collision with other Redis keyspaces. Always use `agent-events:goal:{goalId}` and `agent-events:history:{goalId}`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Redis connection for pub/sub | Custom TCP framing over net module | ioredis added to queue package | ioredis handles reconnection, backpressure, and RESP protocol |
| Event routing to SSE clients | Global Map<goalId, Set<WritableStream>> | Node EventEmitter + shared subscriber | EventEmitter handles edge cases (listener removal on disconnect, max listeners, error propagation) correctly |
| Event history | Custom in-memory ring buffer | Redis LIST + TTL | In-memory buffer is lost on server restart; Redis LIST survives and provides consistent replay |
| SSE heartbeat | setInterval-based keep-alive | Not needed for LAN/same-host | Agent tasks complete well within browser SSE timeout defaults; existing implementation omits heartbeat without problems |

**Key insight:** The Redis pub/sub + EventEmitter combo is a well-established pattern. The complexity is in the connection lifecycle (publisher vs. subscriber roles, per-client cleanup, shared subscriber) — not in the event routing logic itself. Getting these connection roles wrong causes subtle bugs (commands silently dropped in subscriber mode) that are hard to detect in tests.

## Common Pitfalls

### Pitfall 1: ioredis TypeScript Module Resolution
**What goes wrong:** `import Redis from 'ioredis'` in `packages/queue/src/pubsub.ts` fails at build time with `TS2307: Cannot find module 'ioredis'`.
**Why it happens:** ioredis is not in root `node_modules` — it lives inside `node_modules/bullmq/node_modules/ioredis/`. TypeScript's module resolver only walks up from the file's location, not into nested node_modules of dependencies.
**How to avoid:** Add `ioredis@5.9.3` as an explicit dependency in `packages/queue/package.json` and run `npm install`. Do not use a relative path import hack.
**Warning signs:** `TS2307` build error in queue package; Phase 1 hit an analogous problem with `import Redis from 'ioredis'` in the health check.

### Pitfall 2: Using Publisher Connection for Subscribe
**What goes wrong:** After calling `publisher.subscribe(channel)`, subsequent `publisher.publish(...)` or `publisher.lrange(...)` calls silently fail or throw `ERR Command not allowed in subscribe mode`.
**Why it happens:** Redis protocol puts a connection into subscribe mode on the first SUBSCRIBE command. This is a protocol-level constraint, not an ioredis limitation.
**How to avoid:** Always create two separate ioredis connections — one for publishing (all write operations) and one for subscribing. The `RedisPubSub` class uses `this.publisher` for publish/lrange/expire; the Fastify plugin creates a separate `subscriber` instance.
**Warning signs:** Commands after subscribe() returning null or throwing; events not appearing in SSE stream despite worker running.

### Pitfall 3: EventEmitter Listener Leak on Client Disconnect
**What goes wrong:** SSE clients that disconnect before job completion leave an orphaned EventEmitter listener. Over time (e.g., page refresh, tab close during execution), this accumulates, eventually causing Node's MaxListenersExceededWarning and potential memory growth.
**Why it happens:** The existing `execution.ts` SSE handler uses `try/finally` to close the response, but if the client disconnects first, the `reply.raw.end()` in `finally` is a no-op — the listener on `app.agentEvents` is never removed.
**How to avoid:** Add `reply.raw.on('close', cleanup)` where `cleanup` calls `app.agentEvents.off(channel, onMessage)`. Call `app.unsubscribeGoal(goalId)` only when no listeners remain for that goal.
**Warning signs:** `MaxListenersExceededWarning` in logs; `app.agentEvents.listenerCount(channel)` growing without bound.

### Pitfall 4: Race Between History Replay and Live Subscribe
**What goes wrong:** An event is published after `LRANGE` returns but before `subscribe()` completes. The late-joining client misses it.
**Why it happens:** There is a window between reading the history list and activating the pub/sub subscription.
**How to avoid:** Subscribe to the live channel BEFORE reading history, then replay history, then start delivering live events. This over-delivers (may get a duplicate of the last event), which is harmless. Alternatively: replay history first, then subscribe, and accept the race as a known edge case — for a single user monitoring their own job, one missed event in a 5-10 minute execution is acceptable.
**Decision:** Accept the race for Phase 2. The window is milliseconds; the consequence is one missed progress event, not data loss. If this matters, switch to Redis Streams in a future phase.

### Pitfall 5: Bot Commands Break Because of Inline Execution Removal
**What goes wrong:** The Discord/Slack `/execute` bot commands call `POST /api/goals/:id/execute`, which already goes through BullMQ (Phase 1). They do NOT use the SSE streaming endpoint. No changes are needed for bots.
**Why it happens:** Confusion about which endpoint bots use.
**How to avoid:** Only modify `GET /:id/execute/stream` (the SSE endpoint). Leave `POST /:id/execute` (the enqueue endpoint) untouched.
**Warning signs:** If you find yourself changing `POST /:id/execute`, stop — that endpoint is not in scope.

### Pitfall 6: TTL Not Set After Job Completion
**What goes wrong:** Redis LIST for history accumulates indefinitely, consuming memory for completed goals.
**Why it happens:** `EXPIRE` is set on each RPUSH (refreshing the TTL while job runs), but if the job completes without a final `EXPIRE` call, the list may outlive its usefulness.
**How to avoid:** Always call `EXPIRE` with a short TTL in the `publish()` call (it refreshes on every event). After job completion or failure, set a shorter TTL (e.g., 300 seconds) to allow late clients to connect before the history disappears.

## Code Examples

Verified patterns from official ioredis documentation and existing project patterns:

### Publisher: Two Clients Publishing to Channel + History
```typescript
// Source: ioredis docs — https://github.com/redis/ioredis#publish--subscribe
import Redis from "ioredis";

const pub = new Redis({ host: "localhost", port: 6379 });
const payload = JSON.stringify({ goalId: "goal-1", status: "started" });

// Publish and append to history atomically (near-atomic via Promise.all)
await Promise.all([
  pub.publish("agent-events:goal:goal-1", payload),
  pub.rpush("agent-events:history:goal-1", payload),
  pub.expire("agent-events:history:goal-1", 3600),
]);
```

### Subscriber: Reading History + Subscribing
```typescript
// Source: ioredis docs — subscribe mode
import Redis from "ioredis";

const sub = new Redis({ host: "localhost", port: 6379 });

// Read history (normal command, before subscribe)
const history = await sub.lrange("agent-events:history:goal-1", 0, -1);
const events = history.map((s) => JSON.parse(s));

// Switch to subscribe mode — after this, sub can only receive messages
await sub.subscribe("agent-events:goal:goal-1");

sub.on("message", (channel, message) => {
  const event = JSON.parse(message);
  // forward to SSE client
});
```

**Note:** `LRANGE` must be called BEFORE `subscribe()`. Once subscribe() is called, the connection is in subscribe mode and cannot run LRANGE.

### Fastify request.raw 'close' event for SSE cleanup
```typescript
// Source: Node.js HTTP docs — ServerResponse 'close' event
// Fires when the underlying TCP connection is closed (including client disconnect)

reply.raw.on("close", () => {
  // Client disconnected — remove listener to prevent leak
  emitter.off(channel, onMessageHandler);
});
```

### EventEmitter per-goal routing pattern
```typescript
// Source: established Node.js patterns for fan-out
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
emitter.setMaxListeners(200); // prevent MaxListenersExceededWarning at scale

// Subscriber side (one per SSE client)
const handler = (message: string) => { /* send to SSE */ };
emitter.on(channel, handler);

// On disconnect or completion:
emitter.off(channel, handler);
```

### Test pattern for SSE endpoint with mocked Redis
```typescript
// Source: existing streaming.test.ts pattern in this project

vi.mock("@ai-cofounder/queue", () => ({
  // ... existing mocks
  RedisPubSub: vi.fn().mockImplementation(() => ({
    getHistory: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  })),
  createSubscriber: vi.fn().mockReturnValue({
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    quit: vi.fn().mockResolvedValue(undefined),
  }),
  goalChannel: (goalId: string) => `agent-events:goal:${goalId}`,
}));
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline `dispatcher.runGoal()` in SSE handler | Worker executes, publishes via Redis pub/sub | Phase 2 | Execution no longer blocks HTTP server thread |
| SSE must be connected before execution starts | SSE can connect after execution starts (history replay) | Phase 2 | Dashboard can refresh mid-execution without losing progress |
| `GET /:id/execute/stream` starts AND streams execution | `POST /:id/execute` starts; `GET /:id/execute/stream` only listens | Phase 1 + 2 | Clear separation of concerns |

**Deprecated by Phase 2:**
- The existing inline execution block in `GET /:id/execute/stream` (`await dispatcher.runGoal(id, userId)`) — replace entirely with Redis subscribe logic.

## Open Questions

1. **Shared subscriber channel management**
   - What we know: The pubsub plugin must call `subscriber.subscribe(channel)` for each goal being watched, and `subscriber.unsubscribe(channel)` when no SSE clients remain.
   - What's unclear: ioredis allows subscribing to multiple channels on one connection, but if the channel is unsubscribed while another client is still listening (a race), the emitter won't receive messages even though clients are registered.
   - Recommendation: Reference-count subscribers using `emitter.listenerCount(channel)`: subscribe when count goes from 0 to 1, unsubscribe when count goes from 1 to 0. This is handled in the `subscribeGoal`/`unsubscribeGoal` pattern above.

2. **Behavior when SSE client connects for a job that hasn't started yet**
   - What we know: History list will be empty; no pub/sub events yet; the connection should wait.
   - What's unclear: How long should we hold the connection open with no events?
   - Recommendation: Keep the connection open; the `started` event gets sent immediately (as the current endpoint does). If the job never starts (e.g., queue is down), the SSE client will timeout after `timeoutMs` (120s per `use-sse.ts`). This is acceptable.

3. **TypeScript interface for Fastify decorators**
   - What we know: `app.agentEvents`, `app.subscribeGoal`, `app.unsubscribeGoal` will be decorated onto `FastifyInstance`. Without type augmentation in the pubsub plugin, TypeScript will complain in `execution.ts`.
   - Recommendation: Add `declare module 'fastify'` type augmentation in `plugins/pubsub.ts`, following the same pattern used by the existing queue, observability, and db plugins.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="pubsub\|sse-stream\|execution-queue"` |
| Full suite command | `npm run test` |
| Estimated runtime | ~15 seconds (mocked Redis, no real connections) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-10 | Worker calls `redisPubSub.publish()` with progress events | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="worker"` | ❌ Wave 0 gap (worker.test.ts exists but needs pub/sub coverage) |
| QUEUE-10 | `RedisPubSub.publish()` calls ioredis PUBLISH + RPUSH + EXPIRE | unit | `npm run test -w @ai-cofounder/queue -- --testPathPattern="pubsub"` | ❌ Wave 0 gap |
| QUEUE-11 | SSE stream endpoint replays history events from Redis LIST | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="sse-stream\|execution"` | ❌ Wave 0 gap |
| QUEUE-11 | SSE stream endpoint forwards live pub/sub events | unit | same as above | ❌ Wave 0 gap |
| QUEUE-11 | SSE client disconnect cleans up EventEmitter listener | unit | same as above | ❌ Wave 0 gap |
| QUEUE-11 | Bot commands (POST /api/goals/:id/execute) unaffected | regression | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="execution-queue"` | ✅ yes (execution-queue.test.ts) |
| QUEUE-10+11 | Full pub/sub round-trip: publish -> channel -> SSE client | integration | manual (requires real Redis) | manual-only |

### Nyquist Sampling Rate
- **Minimum sample interval:** After every committed task → run: `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="pubsub\|sse-stream\|execution-queue\|worker"`
- **Full suite trigger:** Before merging final task of the phase wave
- **Phase-complete gate:** Full suite green + existing 558+ tests still passing before `/gsd:verify-work` runs
- **Estimated feedback latency per task:** ~15 seconds

### Wave 0 Gaps (must be created before implementation)
- [ ] `packages/queue/src/__tests__/pubsub.test.ts` — unit tests for `RedisPubSub.publish()`, `getHistory()`, `createSubscriber()`, `goalChannel()`, `historyKey()` with mocked ioredis
- [ ] `apps/agent-server/src/__tests__/sse-stream.test.ts` — tests for `GET /:id/execute/stream` covering: history replay on connect, live event forwarding, client disconnect cleanup, completed/failed job terminal states
- [ ] Worker test coverage (existing `worker.test.ts`) — extend to verify `onProgress` callback invokes `redisPubSub.publish()` for each task start/complete/fail event

*(Existing `execution-queue.test.ts` covers QUEUE-02/09 and serves as regression for bot command path — no new file needed for that.)*

## Sources

### Primary (HIGH confidence)
- Codebase inspection — `packages/queue/src/connection.ts`, `workers.ts`, `helpers.ts`, `index.ts`
- Codebase inspection — `apps/agent-server/src/routes/execution.ts`, `agents/dispatcher.ts`, `worker.ts`
- Codebase inspection — `apps/dashboard/src/hooks/use-sse.ts`, `components/goals/execution-panel.tsx`
- ioredis bundled in BullMQ — confirmed version 5.9.3 in `/node_modules/bullmq/node_modules/ioredis/package.json`
- Direct code inspection — `RedisPubSub` class methods confirmed via `check_ioredis.cjs` runtime probe

### Secondary (MEDIUM confidence)
- ioredis GitHub README — subscribe/publish mode, connection duplication pattern
- Phase 1 RESEARCH.md and SUMMARY files — confirmed ioredis import problem history and `net.connect` workaround

### Tertiary (LOW confidence)
- General Redis pub/sub patterns for fan-out to multiple SSE clients — established community pattern, not verified against this specific ioredis version

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — ioredis version confirmed, BullMQ integration confirmed, no new framework needed
- Architecture: HIGH — existing SSE pattern in codebase is clear; pub/sub design follows standard Redis patterns; dispatcher `onProgress` callback already exists
- Pitfalls: HIGH — ioredis subscriber mode restriction is a Redis protocol fact; the listener leak and module resolution issues are confirmed by Phase 1 experience and direct runtime testing
- Test strategy: HIGH — follows existing Vitest + mocking patterns exactly as established in Phase 1

**Research date:** 2026-03-08
**Valid until:** 2026-09-08 (stable Redis + ioredis APIs; BullMQ 5.x is stable)
