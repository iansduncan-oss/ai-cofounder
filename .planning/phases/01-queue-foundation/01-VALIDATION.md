---
phase: 1
slug: queue-foundation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-07
validated: 2026-03-09
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root vitest.config.ts) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -w @ai-cofounder/queue -- --reporter=dot 2>&1 \| tail -10` |
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

| Task ID | Plan | Wave | Requirement | Test Type | Test File | Status |
|---------|------|------|-------------|-----------|-----------|--------|
| 1-01-01 | 01 | 1 | QUEUE-01 | manual | docker-compose.yml / docker-compose.prod.yml | ✅ green |
| 1-01-02 | 01 | 1 | QUEUE-05 | unit | packages/queue/src/__tests__/queue-config.test.ts | ✅ green |
| 1-01-03 | 01 | 1 | QUEUE-09 | unit | packages/queue/src/__tests__/queue-config.test.ts | ✅ green |
| 1-01-04 | 01 | 1 | QUEUE-12 | unit | packages/queue/src/__tests__/queue-config.test.ts | ✅ green |
| 1-01-05 | 01 | 1 | QUEUE-13 | unit | packages/queue/src/__tests__/queue-config.test.ts | ✅ green |
| 1-02-01 | 02 | 1 | QUEUE-02 | unit | apps/agent-server/src/__tests__/execution-queue.test.ts | ✅ green |
| 1-02-02 | 02 | 1 | QUEUE-03 | unit | apps/agent-server/src/__tests__/worker.test.ts | ✅ green |
| 1-02-03 | 02 | 1 | QUEUE-04 | manual | docker-compose.prod.yml (worker service) | ✅ green |
| 1-02-04 | 02 | 1 | QUEUE-07 | unit | apps/agent-server/src/__tests__/worker.test.ts | ✅ green |
| 1-03-01 | 03 | 2 | QUEUE-06 | unit | apps/agent-server/src/__tests__/queue-status.test.ts | ✅ green |
| 1-03-02 | 03 | 2 | QUEUE-08 | unit | apps/agent-server/src/__tests__/health-redis.test.ts | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/queue/src/__tests__/queue-config.test.ts` — 10 tests covering QUEUE-05, QUEUE-09, QUEUE-12, QUEUE-13
- [x] `apps/agent-server/src/__tests__/worker.test.ts` — 7 tests covering QUEUE-03, QUEUE-07
- [x] `apps/agent-server/src/__tests__/queue-status.test.ts` — 7 tests covering QUEUE-06
- [x] `apps/agent-server/src/__tests__/health-redis.test.ts` — 5 tests covering QUEUE-08
- [x] `apps/agent-server/src/__tests__/execution-queue.test.ts` — 8 tests covering QUEUE-02

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Redis container starts with stack | QUEUE-01 | Docker Compose infrastructure | `docker compose up -d` → verify `redis` container running |
| Worker runs as separate container | QUEUE-04 | Docker Compose service definition | `docker compose -f docker-compose.prod.yml up worker` → verify separate PID |
| SIGTERM grace period in production | QUEUE-07 | Docker `stop_grace_period` config | `docker compose stop worker` → verify 120s grace period in logs |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated

---

## Validation Audit 2026-03-09

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 11 requirements (QUEUE-01 through QUEUE-09, QUEUE-12, QUEUE-13) have automated test coverage or documented manual verification. All test files exist and were confirmed passing at execution time. Queue package tests (24/24) verified green in this session.
