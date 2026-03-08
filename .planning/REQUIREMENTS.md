# Requirements: AI Cofounder — Infrastructure & Reliability

**Defined:** 2026-03-07
**Core Value:** Agent tasks execute reliably without blocking the API server, and the dashboard is secured behind proper authentication.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Message Queue

- [x] **QUEUE-01**: Redis container added to Docker Compose for both dev and production environments
- [x] **QUEUE-02**: BullMQ queue module can enqueue goal/task execution jobs from HTTP route handlers
- [x] **QUEUE-03**: Worker process picks up jobs from the queue and executes them via orchestrator/dispatcher
- [x] **QUEUE-04**: Worker runs as a separate Docker container (same image, different CMD)
- [x] **QUEUE-05**: Failed jobs retry with exponential backoff up to a configurable max attempts
- [x] **QUEUE-06**: Jobs can be queried by status (waiting, active, completed, failed) via API
- [x] **QUEUE-07**: Worker handles SIGTERM gracefully — finishes active job before shutting down (stop_grace_period: 120s)
- [x] **QUEUE-08**: Redis connection health is monitored and exposed at GET /health endpoint
- [x] **QUEUE-09**: Job priorities allow urgent tasks to be processed before routine ones
- [x] **QUEUE-10**: Worker publishes real-time events to Redis pub/sub channel during job execution
- [ ] **QUEUE-11**: SSE endpoint subscribes to Redis pub/sub and forwards events to dashboard clients
- [x] **QUEUE-12**: Stalled jobs are detected and re-queued (lockDuration configured for 5-10 min agent tasks)
- [x] **QUEUE-13**: Completed/failed jobs are auto-cleaned from Redis (removeOnComplete, removeOnFail TTLs)

### Authentication

- [ ] **AUTH-01**: User can log in to the dashboard with email and password via POST /api/auth/login
- [ ] **AUTH-02**: Successful login returns a short-lived access token (JWT, 15min expiry)
- [ ] **AUTH-03**: Successful login sets a long-lived refresh token as HttpOnly + Secure + SameSite=Strict cookie
- [ ] **AUTH-04**: Protected API routes verify JWT via Fastify onRequest hook and reject unauthorized requests with 401
- [ ] **AUTH-05**: POST /api/auth/refresh issues a new access token using the refresh token cookie
- [ ] **AUTH-06**: User can log out via POST /api/auth/logout which clears the refresh cookie
- [ ] **AUTH-07**: Admin user is auto-created on server startup from ADMIN_EMAIL + ADMIN_PASSWORD env vars if no user exists
- [ ] **AUTH-08**: Passwords are hashed with bcrypt (cost factor 12) and never stored in plaintext
- [ ] **AUTH-09**: Bot endpoints (Discord/Slack webhook routes) use a separate auth mechanism (API key) and are not affected by JWT middleware
- [ ] **AUTH-10**: Dashboard stores access token in memory (not localStorage) and includes it as Authorization: Bearer header

### E2E Testing

- [ ] **TEST-01**: E2E test suite runs against a dedicated test database that is isolated from dev/production
- [ ] **TEST-02**: E2E tests use Fastify inject() for HTTP-level testing without actual network connections
- [ ] **TEST-03**: Full goal lifecycle test covers create goal → dispatch → orchestrator tool loop → goal completion
- [ ] **TEST-04**: LLM responses are mocked using existing MockLlmRegistry for deterministic, reproducible tests
- [ ] **TEST-05**: Test database is cleaned between test runs (truncate or transaction rollback)
- [ ] **TEST-06**: E2E test suite runs in GitHub Actions CI pipeline alongside existing unit tests

### Quick Wins

- [ ] **QWIN-01**: deleteFile workspace tool removes a single file with path validation (no traversal outside workspace)
- [ ] **QWIN-02**: deleteDirectory workspace tool removes a directory with recursive option and safety checks
- [ ] **QWIN-03**: GET /api/agents/roles returns list of available agent roles with descriptions
- [ ] **QWIN-04**: GET /api/conversations/:id/export returns full conversation with messages as JSON
- [ ] **QWIN-05**: OpenAPI spec is auto-generated from Fastify route schemas via @fastify/swagger
- [ ] **QWIN-06**: Swagger UI serves interactive API docs at a configurable endpoint

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### Queue Enhancements
- **QUEUE-V2-01**: Dead letter queue for jobs that fail after max retries
- **QUEUE-V2-02**: Bull Board web UI for monitoring queue health and job states
- **QUEUE-V2-03**: Concurrency control — configurable parallel job limit per worker
- **QUEUE-V2-04**: Job progress events — percentage-based progress reporting during execution

### Auth Enhancements
- **AUTH-V2-01**: Password change endpoint for authenticated users
- **AUTH-V2-02**: Login rate limiting to prevent brute force
- **AUTH-V2-03**: Session listing and revocation
- **AUTH-V2-04**: OAuth provider support (GitHub)

### Testing Enhancements
- **TEST-V2-01**: Queue integration tests (enqueue → worker → completion)
- **TEST-V2-02**: Auth flow tests (login → protected route → refresh → logout)
- **TEST-V2-03**: Bot command integration tests

## Out of Scope

| Feature | Reason |
|---------|--------|
| Horizontal scaling (multi-instance) | Queue enables this but actual multi-instance is future work |
| Circuit breaker pattern | Existing exponential backoff and provider fallback is adequate |
| WebSocket support | SSE streaming is working well for current needs |
| OAuth / SSO providers | JWT sufficient for single-user dashboard |
| Browser E2E tests (Playwright/Cypress) | API-level tests cover the important paths |
| Redis Cluster | Single VPS doesn't need cluster mode |
| Multi-tenant / RBAC | Single user, no need for complex authorization |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUEUE-01 | Phase 1 | Complete |
| QUEUE-02 | Phase 1 | Complete |
| QUEUE-03 | Phase 1 | Complete |
| QUEUE-04 | Phase 1 | Complete |
| QUEUE-05 | Phase 1 | Complete |
| QUEUE-06 | Phase 1 | Complete |
| QUEUE-07 | Phase 1 | Complete |
| QUEUE-08 | Phase 1 | Complete |
| QUEUE-09 | Phase 1 | Complete |
| QUEUE-12 | Phase 1 | Complete |
| QUEUE-13 | Phase 1 | Complete |
| QUEUE-10 | Phase 2 | Complete |
| QUEUE-11 | Phase 2 | Pending |
| AUTH-01 | Phase 3 | Pending |
| AUTH-02 | Phase 3 | Pending |
| AUTH-03 | Phase 3 | Pending |
| AUTH-04 | Phase 3 | Pending |
| AUTH-05 | Phase 3 | Pending |
| AUTH-06 | Phase 3 | Pending |
| AUTH-07 | Phase 3 | Pending |
| AUTH-08 | Phase 3 | Pending |
| AUTH-09 | Phase 3 | Pending |
| AUTH-10 | Phase 3 | Pending |
| TEST-01 | Phase 4 | Pending |
| TEST-02 | Phase 4 | Pending |
| TEST-03 | Phase 4 | Pending |
| TEST-04 | Phase 4 | Pending |
| TEST-05 | Phase 4 | Pending |
| TEST-06 | Phase 4 | Pending |
| QWIN-01 | Phase 4 | Pending |
| QWIN-02 | Phase 4 | Pending |
| QWIN-03 | Phase 4 | Pending |
| QWIN-04 | Phase 4 | Pending |
| QWIN-05 | Phase 4 | Pending |
| QWIN-06 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0

Note: The original count of "25 total" was incorrect — a recount of the defined requirements yields 35 (QUEUE 1-13 = 13, AUTH 1-10 = 10, TEST 1-6 = 6, QWIN 1-6 = 6).

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 after roadmap creation — traceability populated, coverage 35/35*
