# Architecture Research: Infrastructure & Reliability

## Component Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                          │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐            │
│  │ agent-   │   │ discord  │   │ slack    │            │
│  │ server   │   │ bot      │   │ bot      │            │
│  │ (Fastify)│   │          │   │          │            │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘            │
│       │              │              │                    │
│       │    ┌─────────┴──────────────┘                   │
│       │    │  (HTTP via api-client)                      │
│       ▼    ▼                                             │
│  ┌──────────────┐                                        │
│  │  API Routes   │ ← JWT auth middleware                 │
│  │  (Fastify)    │                                       │
│  └──────┬───────┘                                        │
│         │                                                │
│    ┌────┴────┐                                           │
│    │         │                                           │
│    ▼         ▼                                           │
│  ┌─────┐  ┌──────────┐                                  │
│  │ DB  │  │ Redis    │                                  │
│  │(PG) │  │(BullMQ)  │                                  │
│  └─────┘  └────┬─────┘                                  │
│                │                                         │
│         ┌──────┴──────┐                                  │
│         │   Worker    │                                  │
│         │  Process    │                                  │
│         │(BullMQ)     │                                  │
│         └─────────────┘                                  │
└─────────────────────────────────────────────────────────┘
```

## Component Boundaries

### 1. Redis Service (New)
- **Runs as:** Docker container (`redis:7-alpine`)
- **Talks to:** BullMQ (in agent-server and worker)
- **Persistence:** AOF or RDB snapshots (configurable, optional for job queues)
- **Port:** 6379 (internal Docker network only, not exposed to host)

### 2. Queue Module (New — in agent-server or new package)
- **Responsibility:** Define queues, enqueue jobs, export queue instances
- **Location option A:** `apps/agent-server/src/queues/` — simplest, queue is server-specific
- **Location option B:** New `packages/queue` — if bots need to enqueue directly (unlikely)
- **Recommendation:** Option A. Bots already go through api-client → agent-server.

### 3. Worker Process (New)
- **Responsibility:** Process jobs from BullMQ queues
- **Location:** `apps/agent-server/src/worker.ts` — separate entry point, same codebase
- **Shares:** DB access (packages/db), LLM access (packages/llm), agent code
- **Runs as:** Separate Docker container or process (same image, different CMD)
- **Key:** Worker imports orchestrator/dispatcher but doesn't start Fastify

### 4. Auth Module (New — in agent-server)
- **Responsibility:** JWT token issuance, verification, refresh
- **Location:** `apps/agent-server/src/plugins/auth.ts` (Fastify plugin)
- **Routes:** `apps/agent-server/src/routes/auth.ts`
- **DB:** New `users` table (or reuse existing user resolution pattern)
- **Middleware:** `onRequest` hook on protected routes

### 5. E2E Test Infrastructure (New)
- **Location:** `apps/agent-server/src/__tests__/e2e/` or `tests/e2e/` at root
- **Needs:** Test database, mock LLM registry, queue connection
- **Pattern:** `beforeAll` → build server with test config → run tests → `afterAll` cleanup

## Data Flow

### Job Queue Flow
```
HTTP Request → Route Handler → enqueue job (returns job ID)
                                    │
                                    ▼
                              Redis Queue
                                    │
                                    ▼
                            Worker picks up job
                                    │
                                    ▼
                          Orchestrator/Dispatcher runs
                                    │
                                    ▼
                          Job completes → updates DB
                                    │
                                    ▼
                          Client polls or receives SSE update
```

### Auth Flow
```
POST /api/auth/login (email + password)
    → bcrypt.compare()
    → Generate access token (JWT, 15min)
    → Generate refresh token (JWT, 7d, HttpOnly cookie)
    → Return { accessToken, user }

Subsequent requests:
    → Authorization: Bearer <accessToken>
    → onRequest hook calls jwtVerify()
    → Decoded user attached to request

Token refresh:
    POST /api/auth/refresh
    → Read refresh token from cookie
    → Verify, issue new access token
    → Return { accessToken }
```

## Build Order (Dependencies)

1. **Redis + BullMQ setup** — Add Redis to Docker Compose, create queue module, basic enqueue/dequeue
2. **Worker process** — Separate entry point that processes jobs (depends on #1)
3. **Migrate agent execution to queue** — Route handlers enqueue instead of executing inline (depends on #1, #2)
4. **JWT auth plugin** — Independent of queue work, can parallel
5. **Auth routes + dashboard integration** — Login page, token management (depends on #4)
6. **E2E test infrastructure** — Needs queue + auth in place to test full flows (depends on #3, #5)
7. **Quick wins** — Independent, can parallel with anything

## Integration Points

- **Bots → Queue:** Bots call api-client endpoints as before. The server handler enqueues instead of executing inline. No bot changes needed.
- **Dashboard → Auth:** Dashboard adds login page, stores JWT in memory (not localStorage for XSS safety), includes Authorization header in api-client requests.
- **SSE → Queue:** Existing SSE streaming needs to work with async job execution. Worker updates DB, SSE polls or gets notified via Redis pub/sub.
- **Prometheus → Queue:** BullMQ exposes metrics (active/waiting/completed/failed counts) — wire into existing Prometheus endpoint.
