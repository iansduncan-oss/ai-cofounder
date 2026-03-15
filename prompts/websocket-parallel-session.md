# Session: WebSocket Gateway + Parallel Task Execution

## Context

AI Cofounder is a Turborepo monorepo at `~/Projects/ai-cofounder` — a multi-agent system with Fastify agent-server, React dashboard, Discord/Slack bots, and BullMQ job queues. See `CLAUDE.md` at project root for full architecture.

This session implements two interconnected features: a WebSocket gateway for real-time dashboard communication, and parallel task execution in the dispatcher.

---

## Feature 1: WebSocket Gateway

### Goal
Replace the current SSE polling + multiple endpoint pattern with a single persistent WebSocket connection per dashboard client. The dashboard currently uses:
- `POST /api/agents/run/stream` — chat streaming (SSE via POST)
- `GET /api/goals/:id/execute/stream` — goal execution progress (SSE via GET)
- `GET /api/subagents/:id/stream` — subagent progress (SSE via GET)
- TanStack Query polling for everything else (goals, tasks, queue status, etc.)

### Architecture

**Server side** (`apps/agent-server`):

1. **Install `@fastify/websocket`** and create `src/plugins/websocket.ts`:
   - Register as a Fastify plugin at `GET /ws`
   - Authenticate via JWT token in query param or first message (reuse existing `@fastify/jwt` setup)
   - Manage connected clients in a `Map<userId, Set<WebSocket>>`
   - Route incoming client messages by `type` field (subscribe, unsubscribe, ping, cancel)
   - Broadcast server events to subscribed clients

2. **WebSocket message protocol** (JSON):
   ```typescript
   // Client → Server
   type ClientMessage =
     | { type: "subscribe"; channel: string }      // e.g. "goal:uuid", "chat:convId", "system"
     | { type: "unsubscribe"; channel: string }
     | { type: "ping" }
     | { type: "cancel"; goalId: string }           // cancel running goal

   // Server → Client
   type ServerMessage =
     | { type: "event"; channel: string; event: string; data: unknown }
     | { type: "pong" }
     | { type: "error"; message: string }
     | { type: "subscribed"; channel: string }
   ```

3. **Bridge existing Redis pub/sub to WebSocket**:
   - The existing `pubsubPlugin` (`src/plugins/pubsub.ts`) already uses Redis pub/sub + EventEmitter for goal/subagent events
   - Wire the WebSocket plugin to listen on the same EventEmitter (`app.agentEvents`)
   - When a goal event fires, broadcast to all clients subscribed to `goal:<goalId>`
   - Add a `system` channel for broadcast events (monitoring alerts, queue status changes, briefings)

4. **Keep SSE endpoints as fallback** — don't remove them yet. The WebSocket is an upgrade path, not a replacement. Mark them as deprecated in OpenAPI tags.

**Dashboard side** (`apps/dashboard`):

5. **Create `src/hooks/use-websocket.ts`**:
   - Single shared WebSocket connection managed via React context
   - Auto-reconnect with exponential backoff (1s, 2s, 4s, max 30s)
   - Heartbeat ping every 30s, detect stale connections
   - `subscribe(channel)` / `unsubscribe(channel)` methods
   - `useChannel(channel, onEvent)` hook for components to receive events

6. **Create `src/providers/websocket-provider.tsx`**:
   - Wraps app in WebSocket context
   - Manages connection lifecycle (connect on auth, close on logout)
   - Exposes `useWebSocket()` hook for raw access

7. **Migrate `useSSE` hook** to use WebSocket:
   - `useSSE(goalId)` → subscribes to `goal:<goalId>` channel via WebSocket
   - Same event types, same component interface
   - Falls back to SSE if WebSocket unavailable

8. **Migrate `useStreamChat` hook** to use WebSocket:
   - Chat streaming is POST-based (sends message, gets stream back)
   - Keep the POST for sending the message, but receive the stream via WebSocket
   - Subscribe to `chat:<conversationId>` channel before sending
   - Alternative: keep chat as-is since it's request-response shaped — only migrate goal/subagent/system events

**Tests:**
- `websocket.test.ts` — plugin tests with `app.inject()` + WebSocket client mock
- `use-websocket.test.ts` — hook tests with mock WebSocket
- Test reconnection, subscription management, auth rejection

### Key files to read first
- `apps/agent-server/src/plugins/pubsub.ts` — existing Redis pub/sub + EventEmitter
- `apps/agent-server/src/routes/execution.ts` — goal execution SSE endpoint
- `apps/agent-server/src/routes/subagents.ts` — subagent SSE endpoint
- `apps/dashboard/src/hooks/use-sse.ts` — current SSE consumption
- `apps/dashboard/src/hooks/use-stream-chat.ts` — current chat streaming
- `packages/api-client/src/client.ts` — streamExecute/streamChat methods
- `apps/agent-server/src/plugins/jwt-guard.ts` — route registration + auth

---

## Feature 2: Parallel Task Execution

### Goal
Enable the TaskDispatcher to execute independent tasks concurrently across different specialist agents, rather than the current sequential group-by-group execution.

### Architecture

**Current behavior** (`apps/agent-server/src/agents/dispatcher.ts`):
- Tasks are grouped by `parallelGroup` field
- Tasks within the same group run concurrently via `Promise.allSettled()`
- Groups execute sequentially in a for-loop (line ~122)
- Context chain (`previousOutputs`) accumulates across groups

**New behavior:**

1. **Dependency-based execution** — Replace group-based ordering with a dependency graph:
   - Add optional `dependsOn: string[]` field to tasks (array of task IDs that must complete first)
   - Tasks with no dependencies (or all dependencies satisfied) can execute immediately
   - Use a "ready queue" pattern: as tasks complete, check which blocked tasks become unblocked

2. **Modify `runGoal()` in dispatcher.ts**:
   ```typescript
   async runGoal(goalId, prompt, userId?, onProgress?) {
     const tasks = await getTasksByGoalId(db, goalId);
     const completed = new Map<string, string>(); // taskId → output
     const running = new Set<string>();
     const failed = new Set<string>();

     while (hasRunnableTasks(tasks, completed, running, failed)) {
       const ready = getReadyTasks(tasks, completed, running, failed);
       const promises = ready.map(task => {
         running.add(task.id);
         return this.executeTask(task, ..., Array.from(completed.values()))
           .then(result => { completed.set(task.id, result.output); running.delete(task.id); })
           .catch(err => { failed.add(task.id); running.delete(task.id); });
       });
       await Promise.race(promises); // Process as tasks complete, not waiting for all
     }
   }
   ```

3. **Concurrency limit** — Don't run unlimited parallel tasks:
   - Add `MAX_CONCURRENT_TASKS = 3` config (matches subagent worker concurrency)
   - Only dequeue from ready queue when under limit
   - Prevents overwhelming LLM providers

4. **Context passing refinement**:
   - Currently all previous outputs are passed as flat array
   - With parallel execution, pass only outputs from *dependency* tasks, not all completed tasks
   - `executeTask()` receives `dependencyOutputs: Map<string, string>` instead of `previousOutputs: string[]`

5. **Failure propagation**:
   - If a task fails, all tasks that depend on it should be marked as `blocked` or `skipped`
   - Tasks without dependency on the failed task continue executing
   - Goal completes when all non-blocked tasks finish (or fail)

6. **Progress events** — Emit richer events for the dashboard:
   ```typescript
   { type: "task_started", taskId, taskTitle, agent, runningCount, totalTasks }
   { type: "task_completed", taskId, output, completedCount, totalTasks }
   { type: "task_failed", taskId, error, blockedTasks: string[] }
   { type: "tasks_parallel", taskIds: string[], message: "Running 3 tasks concurrently" }
   ```

### DB changes needed
- Add `depends_on` column to `tasks` table (text array or JSONB) — or use a separate `task_dependencies` join table
- Planner agent needs to populate dependencies when creating tasks
- Migration via `db:generate` + `db:migrate`

### Key files to modify
- `apps/agent-server/src/agents/dispatcher.ts` — core execution logic
- `packages/db/src/schema.ts` — add `dependsOn` to tasks table
- `packages/db/src/repositories/tasks.ts` — query helpers
- `apps/agent-server/src/agents/tools/create-plan.ts` — planner sets dependencies
- `apps/agent-server/src/worker.ts` — may need concurrency adjustment

### Tests
- `dispatcher.test.ts` — test parallel execution, dependency resolution, failure propagation, concurrency limits
- Test that independent tasks actually run concurrently (timing assertions or mock tracking)
- Test that dependent tasks wait for their dependencies
- Test failure cascading (task C depends on B, B fails → C is skipped)

---

## Implementation Order

1. **WebSocket plugin** (server) — install dep, create plugin, bridge to pub/sub
2. **WebSocket hook + provider** (dashboard) — connection management, subscription API
3. **Migrate goal execution streaming** — useSSE → WebSocket channel
4. **Add system channel** — broadcast monitoring/queue events
5. **Task dependency schema** — DB migration for `dependsOn` field
6. **Parallel dispatcher** — rewrite `runGoal()` with dependency graph execution
7. **Planner integration** — teach planner to set task dependencies
8. **Dashboard parallel progress** — show concurrent task execution in goal detail

## Success Criteria
- Dashboard connects via single WebSocket, receives goal/subagent/system events in real-time
- SSE endpoints still work as fallback
- Tasks with no dependencies execute concurrently (up to concurrency limit)
- Task failure correctly blocks dependent tasks without stopping independent ones
- Full test coverage for WebSocket plugin, hook, dispatcher changes
