# Requirements: AI Cofounder

**Defined:** 2026-03-07
**Updated:** 2026-03-09 (v1.1 Pipeline Dashboard UI)
**Core Value:** Users can visualize, monitor, and trigger multi-stage agent pipelines from the dashboard with real-time progress feedback.

## v1.0 Requirements (Complete)

All 35 requirements completed in v1.0 Infrastructure & Reliability milestone.

### Message Queue (13 requirements — all complete)
- [x] **QUEUE-01** through **QUEUE-13**: Redis + BullMQ infrastructure, worker process, job lifecycle, health monitoring, SSE streaming via pub/sub

### Authentication (10 requirements — all complete)
- [x] **AUTH-01** through **AUTH-10**: JWT login, refresh tokens, protected routes, admin seed, bot endpoint isolation

### E2E Testing (6 requirements — all complete)
- [x] **TEST-01** through **TEST-06**: Goal lifecycle E2E tests, test DB isolation, CI integration

### Quick Wins (6 requirements — all complete)
- [x] **QWIN-01** through **QWIN-06**: Workspace delete tools, agent roles, conversation export, OpenAPI/Swagger

## v1.1 Requirements

Requirements for Pipeline Dashboard UI milestone. Each maps to roadmap phases.

### Pipeline List

- [ ] **LIST-01**: User can view a page listing all pipeline runs with status, stage count, and timing
- [ ] **LIST-02**: User can filter pipeline runs by state (waiting, active, completed, failed)
- [ ] **LIST-03**: User can see pipeline list auto-refresh every 10 seconds while viewing
- [ ] **LIST-04**: User can navigate from a pipeline list item to its detail view

### Pipeline Detail

- [ ] **DETAIL-01**: User can view a pipeline's stages with per-stage status indicators (pending, active, completed, failed, skipped)
- [ ] **DETAIL-02**: User can expand a stage to see its output text and error details
- [ ] **DETAIL-03**: User can see timing information for each completed stage
- [ ] **DETAIL-04**: User can see the pipeline's overall state, goal link, and created/finished timestamps
- [ ] **DETAIL-05**: User can see active pipeline details auto-refresh every 5 seconds

### Pipeline Trigger

- [ ] **TRIGGER-01**: User can submit a goal-based pipeline (default 3-stage: planner → coder → reviewer) from the dashboard
- [ ] **TRIGGER-02**: User can build a custom pipeline with configurable stages (agent role, prompt, dependency flag)
- [ ] **TRIGGER-03**: User receives confirmation with job ID after successful pipeline submission
- [ ] **TRIGGER-04**: User is redirected to the pipeline detail view after submission

### Navigation

- [ ] **NAV-01**: User can access the pipelines page from the dashboard sidebar
- [ ] **NAV-02**: User can navigate between pipeline list and detail views via URL routing

## Future Requirements

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

### Pipeline Management
- **MGMT-01**: User can save pipeline stage configurations as reusable templates
- **MGMT-02**: User can schedule pipelines to run on a recurring basis
- **MGMT-03**: User can cancel a running pipeline
- **MGMT-04**: User can re-run a failed pipeline

### Pipeline Streaming
- **STREAM-01**: User receives real-time SSE events for stage transitions (not just polling)
- **STREAM-02**: User can see live agent output as stages execute

## Out of Scope

| Feature | Reason |
|---------|--------|
| Pipeline template CRUD | This milestone covers execution monitoring, not template management |
| Pipeline scheduling/recurring runs | Adds queue complexity; defer to future milestone |
| SSE streaming for pipeline events | Polling sufficient for v1.1; SSE requires new backend endpoint |
| Pipeline cancellation | Requires BullMQ job abort support; defer to future |
| Pipeline comparison/analytics | Not needed for core monitoring use case |
| Horizontal scaling (multi-instance) | Queue enables this but actual multi-instance is future work |
| OAuth / SSO providers | JWT sufficient for single-user dashboard |
| WebSocket support | SSE streaming is working well for current needs |

## Traceability

### v1.0 (Complete)

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUEUE-01 through QUEUE-09, QUEUE-12, QUEUE-13 | Phase 1 | Complete |
| QUEUE-10, QUEUE-11 | Phase 2 | Complete |
| AUTH-01 through AUTH-10 | Phase 3 | Complete |
| TEST-01 through TEST-06, QWIN-01 through QWIN-06 | Phase 4 | Complete |

### v1.1 (Active)

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIST-01 | — | Pending |
| LIST-02 | — | Pending |
| LIST-03 | — | Pending |
| LIST-04 | — | Pending |
| DETAIL-01 | — | Pending |
| DETAIL-02 | — | Pending |
| DETAIL-03 | — | Pending |
| DETAIL-04 | — | Pending |
| DETAIL-05 | — | Pending |
| TRIGGER-01 | — | Pending |
| TRIGGER-02 | — | Pending |
| TRIGGER-03 | — | Pending |
| TRIGGER-04 | — | Pending |
| NAV-01 | — | Pending |
| NAV-02 | — | Pending |

**Coverage:**
- v1.1 requirements: 15 total
- Mapped to phases: 0
- Unmapped: 15

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-09 after v1.1 requirements definition*
