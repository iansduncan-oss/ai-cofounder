---
phase: 1
slug: queue-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root vitest.config.ts) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -w @ai-cofounder/agent-server -- --reporter=dot 2>&1 \| tail -10` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30-60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -w @ai-cofounder/agent-server -- --reporter=dot 2>&1 | tail -10`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | QUEUE-01 | manual | `docker compose config \| grep redis` | ✅ | ⬜ pending |
| 1-01-02 | 01 | 1 | QUEUE-01 | manual | `docker compose -f docker-compose.prod.yml config \| grep redis` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | QUEUE-02 | unit | `npm test -w @ai-cofounder/agent-server -- execution` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | QUEUE-03 | unit | `npm test -w @ai-cofounder/agent-server -- worker` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 1 | QUEUE-04 | manual | `docker compose up worker` | N/A | ⬜ pending |
| 1-02-04 | 02 | 1 | QUEUE-07 | unit | `npm test -w @ai-cofounder/agent-server -- worker` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | QUEUE-05 | unit | `npm test -w @ai-cofounder/queue` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 2 | QUEUE-06 | unit | `npm test -w @ai-cofounder/agent-server -- goals` | ❌ W0 | ⬜ pending |
| 1-03-03 | 03 | 2 | QUEUE-08 | unit | `npm test -w @ai-cofounder/agent-server -- health` | ❌ W0 | ⬜ pending |
| 1-03-04 | 03 | 2 | QUEUE-09 | unit | `npm test -w @ai-cofounder/queue` | ❌ W0 | ⬜ pending |
| 1-03-05 | 03 | 2 | QUEUE-12 | unit | `npm test -w @ai-cofounder/queue` | ❌ W0 | ⬜ pending |
| 1-03-06 | 03 | 2 | QUEUE-13 | unit | `npm test -w @ai-cofounder/queue` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/queue/src/__tests__/queue.test.ts` — stubs for QUEUE-05, QUEUE-09, QUEUE-12, QUEUE-13 (retry config, priority mapping, lockDuration, TTL cleanup)
- [ ] `apps/agent-server/src/__tests__/worker.test.ts` — stubs for QUEUE-03, QUEUE-07 (worker bootstrap, SIGTERM graceful shutdown)
- [ ] `apps/agent-server/src/__tests__/queue-status.test.ts` — stubs for QUEUE-06 (goal queue-status endpoint with mocked Job.fromId)
- [ ] `apps/agent-server/src/__tests__/health-redis.test.ts` — stubs for QUEUE-08 (health endpoint with Redis ping)

*Existing `routes.test.ts` execution tests need updating to expect 202 + jobId instead of blocking response — test update, not new file.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Redis container starts with stack | QUEUE-01 | Docker Compose infrastructure | `docker compose up -d` → verify `redis` container running |
| Worker runs as separate container | QUEUE-04 | Docker Compose service definition | `docker compose -f docker-compose.prod.yml up worker` → verify separate PID |
| SIGTERM grace period in production | QUEUE-07 | Docker `stop_grace_period` config | `docker compose stop worker` → verify 120s grace period in logs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
