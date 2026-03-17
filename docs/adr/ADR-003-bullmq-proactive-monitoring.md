# ADR-003: BullMQ for Proactive Monitoring and Background Jobs

## Status

Accepted

## Context

The system requires recurring background work: monitoring GitHub CI/PRs, checking VPS health, generating daily briefings, sending notifications, and executing multi-stage pipelines. Three approaches were considered:

1. **In-process timers** — `setInterval` / `setTimeout` in the Fastify server
2. **System cron** — OS-level cron jobs calling API endpoints
3. **BullMQ job queues** — Redis-backed persistent queues with workers

In-process timers are simple but don't survive restarts, can't distribute across processes, and provide no visibility into job state or failure history.

System cron is durable but requires OS-level configuration, has no built-in retry/backoff, and makes it difficult to pass structured data between jobs.

## Decision

Use **BullMQ with Redis** (option 3) for all background and recurring work.

- 5 named queues: `agent-tasks`, `monitoring`, `briefings`, `notifications`, `pipelines`
- `packages/queue` provides connection management, queue/worker factories, and a recurring job scheduler
- Workers run in-process within the agent-server (registered via `plugins/queue.ts`)
- Recurring jobs use BullMQ's `repeat` option (e.g., monitoring every 5 minutes, briefings daily)
- Redis configured with AOF persistence to survive restarts
- Priority support for urgent tasks (e.g., critical monitoring alerts)

## Consequences

**Benefits:**
- Jobs survive server restarts (persisted in Redis)
- Built-in retry with exponential backoff for transient failures
- Job visibility via BullMQ dashboard and REST API (`/api/queue/status`)
- Priority queues allow urgent work to preempt routine jobs
- Clean separation: queue producers (routes/services) vs consumers (workers)
- Dead letter queue for failed jobs with inspection API

**Trade-offs:**
- Redis dependency (required infrastructure alongside PostgreSQL)
- In-process workers share CPU with HTTP handlers (acceptable at current scale)
- BullMQ's repeat scheduler uses cron syntax, which can be unintuitive for sub-minute intervals
- Queue state is separate from DB state — requires careful coordination for consistency

**Files:** `packages/queue/`, `apps/agent-server/src/plugins/queue.ts`, `apps/agent-server/src/services/monitoring.ts`
