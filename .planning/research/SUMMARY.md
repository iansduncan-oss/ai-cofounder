# Research Summary: Infrastructure & Reliability

## Stack Recommendation

| Component | Choice | Why |
|-----------|--------|-----|
| Job Queue | BullMQ ^5.x | Production-grade, native TS, built-in retries/priorities/concurrency |
| Redis Client | ioredis ^5.x | BullMQ requirement, superior pub/sub support |
| Redis Server | redis:7-alpine (Docker) | Small footprint, BullMQ compatible |
| JWT Auth | @fastify/jwt ^9.x | Official Fastify plugin, idiomatic integration |
| Password Hashing | bcrypt ^5.x | Industry standard, adaptive cost factor |
| Cookie Support | @fastify/cookie ^11.x | HttpOnly refresh token storage |
| API Docs | @fastify/swagger ^9.x + swagger-ui ^5.x | Auto-generate OpenAPI from Fastify schemas |
| E2E Testing | vitest (existing) + Fastify inject() | No new test framework needed |

## Table Stakes Features

**Message Queue:**
- Job enqueue/dequeue from HTTP handlers
- Retries with exponential backoff
- Job status tracking (waiting/active/completed/failed)
- Graceful shutdown (finish active jobs on SIGTERM)
- Redis connection health checks
- Job completion notification to clients

**JWT Auth:**
- Login endpoint (email/password → JWT)
- Short-lived access token (15min)
- Long-lived refresh token (7d, HttpOnly cookie)
- Protected route middleware (onRequest hook)
- Logout (clear cookie)

**E2E Tests:**
- Full goal lifecycle test (create → dispatch → execute → verify)
- Test database isolation
- Mock LLM responses (use existing MockLlmRegistry)
- CI pipeline integration

## Critical Pitfalls

1. **SSE streaming breaks when moving to async queue** — The orchestrator currently streams directly to clients. Workers need Redis pub/sub or DB-based signaling to maintain real-time updates. Plan this before migrating.

2. **Store JWT in memory, not localStorage** — XSS vulnerability. Access token in React state, refresh token as HttpOnly cookie only.

3. **Bot endpoints need separate auth** — JWT is for dashboard. Bots use API key or shared secret. Apply JWT middleware selectively.

4. **BullMQ stalled job handling** — Configure `lockDuration` for long agent tasks (5-10 min). Default 30s will cause stalled job errors on normal agent runs.

5. **Worker graceful shutdown on deploy** — Docker `stop_grace_period: 120s` for long-running agent tasks. Handle SIGTERM → `worker.close()`.

## Build Order

1. Redis + BullMQ setup (queue module, Docker Compose)
2. Worker process (separate entry point, same codebase)
3. Migrate agent execution to queue (hardest — SSE streaming adaptation)
4. JWT auth plugin + routes (can parallel with #1-2)
5. Dashboard auth integration (login page, token management)
6. E2E test infrastructure (depends on queue + auth)
7. Quick wins (independent, parallel with anything)

## Key Insight

The hardest part is **not** adding Redis or BullMQ — it's maintaining real-time streaming after moving agent execution to a background worker. The current architecture streams SSE events directly from the orchestrator loop in the request handler. When the orchestrator runs in a worker process, those events need to flow through Redis pub/sub back to the SSE endpoint. This is the critical integration point to get right.
