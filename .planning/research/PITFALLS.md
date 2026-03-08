# Pitfalls Research: Infrastructure & Reliability

## Message Queue Pitfalls

### 1. Not handling worker crashes mid-job
**Warning signs:** Jobs marked as "active" forever, never completing or failing.
**Prevention:** BullMQ handles this with `stalledInterval` — configure it (default 30s). Use `lockDuration` appropriate for agent tasks (5-10 minutes for long orchestrator runs). Set `maxStalledCount: 1` so stalled jobs retry once, then fail.
**Phase:** Queue setup (Phase 1)

### 2. Redis memory exhaustion
**Warning signs:** Redis OOM errors, completed job data accumulating.
**Prevention:** Configure `removeOnComplete: { age: 3600, count: 1000 }` and `removeOnFail: { age: 86400 }` to auto-clean completed/failed jobs. Set `maxmemory` and `maxmemory-policy allkeys-lru` in Redis config.
**Phase:** Queue setup (Phase 1)

### 3. Breaking SSE streaming when moving to async
**Warning signs:** Dashboard chat stops showing real-time responses after migration.
**Prevention:** The current streaming flow sends SSE events directly from the orchestrator loop. When the orchestrator runs in a worker, those events need a different transport path. Options: (a) Redis pub/sub from worker → SSE endpoint, (b) Worker writes to DB, SSE polls. Plan this before migrating.
**Phase:** Migration to queue (Phase 2) — this is the hardest part

### 4. Job serialization issues
**Warning signs:** "Cannot serialize" errors, losing class instances across queue boundary.
**Prevention:** BullMQ jobs are JSON-serialized. Don't pass class instances, functions, or circular references as job data. Pass IDs and reconstruct in worker.
**Phase:** Queue setup (Phase 1)

### 5. Forgetting graceful shutdown
**Warning signs:** Jobs lost on deploy, half-completed agent tasks.
**Prevention:** Handle SIGTERM in worker: call `worker.close()` which waits for active jobs to finish. Set Docker `stop_grace_period: 120s` for long-running agent tasks.
**Phase:** Worker process (Phase 1)

---

## JWT Authentication Pitfalls

### 6. Storing JWT in localStorage
**Warning signs:** XSS vulnerability — any script can read the token.
**Prevention:** Store access token in memory (JavaScript variable/React state). Store refresh token as HttpOnly + Secure + SameSite=Strict cookie. Access token is short-lived, refreshed via cookie.
**Phase:** Auth implementation (Phase 2)

### 7. No token refresh flow
**Warning signs:** Users get logged out every 15 minutes when access token expires.
**Prevention:** Implement refresh endpoint. Dashboard api-client intercepts 401 responses, calls refresh, retries original request. Silent refresh on page load.
**Phase:** Auth implementation (Phase 2)

### 8. Not protecting bot endpoints
**Warning signs:** Bots can't authenticate after adding auth middleware.
**Prevention:** Bot endpoints (called from Discord/Slack bots) use a separate auth mechanism — API key or shared secret, not JWT. Apply JWT middleware selectively to dashboard-facing routes, not bot routes.
**Phase:** Auth implementation (Phase 2)

### 9. Hardcoded user credentials
**Warning signs:** Password in source code or config file.
**Prevention:** Hash password at registration time. Store hash in DB. Load initial user via seed script or environment variable (email + password), not hardcoded.
**Phase:** Auth implementation (Phase 2)

---

## E2E Testing Pitfalls

### 10. Tests depending on external services
**Warning signs:** Tests fail when LLM providers are down, flaky due to network issues.
**Prevention:** Mock LLM responses in E2E tests. Use MockLlmRegistry (already exists in test-utils). Don't call real LLM APIs in automated tests.
**Phase:** E2E tests (Phase 3)

### 11. Test database pollution
**Warning signs:** Tests fail when run in different order, state leaks between tests.
**Prevention:** Use transactions that rollback after each test, OR truncate tables in `beforeEach`. Run tests against a dedicated test database, never dev/prod.
**Phase:** E2E tests (Phase 3)

### 12. E2E tests too slow for CI
**Warning signs:** CI pipeline takes 10+ minutes, developers skip running tests.
**Prevention:** Use Fastify's `inject()` instead of actual HTTP (no network overhead). Limit E2E tests to critical paths only (5-10 tests, not 50). Use `--bail` to fail fast.
**Phase:** E2E tests (Phase 3)

### 13. Testing too much in E2E
**Warning signs:** E2E tests duplicate unit test coverage, test pyramid inverted.
**Prevention:** E2E tests verify integration points and full workflows only. Don't test individual functions in E2E — that's what the existing 958 unit tests do. Focus on: "does a goal go from created to completed?"
**Phase:** E2E tests (Phase 3)

---

## Docker / Infrastructure Pitfalls

### 14. Redis not persisting across deploys
**Warning signs:** All queued jobs lost on `docker-compose down/up`.
**Prevention:** Mount Redis data directory as a Docker volume. Configure AOF persistence for durability. For job queues specifically, losing pending jobs on deploy is often acceptable — active jobs are the concern (see graceful shutdown).
**Phase:** Queue setup (Phase 1)

### 15. Worker and server fighting over the same job
**Warning signs:** Duplicate execution, race conditions.
**Prevention:** Only the worker process should create BullMQ `Worker` instances. The server only enqueues via `Queue.add()`. Never process jobs in the HTTP server process.
**Phase:** Worker process (Phase 1)
