---
phase: 2
slug: sse-migration
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-08
validated: 2026-03-09
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm run test -w @ai-cofounder/queue -- --reporter=dot` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/queue -- --reporter=dot`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Test File | Status |
|---------|------|------|-------------|-----------|-----------|--------|
| 02-01-01 | 01 | 1 | QUEUE-10 | unit | packages/queue/src/__tests__/pubsub.test.ts (14 tests) | ✅ green |
| 02-01-02 | 01 | 1 | QUEUE-10 | unit | apps/agent-server/src/__tests__/worker.test.ts (6 new pub/sub tests) | ✅ green |
| 02-02-01 | 02 | 2 | QUEUE-11 | unit | apps/agent-server/src/__tests__/sse-stream.test.ts (7 tests) | ✅ green |
| 02-02-02 | 02 | 2 | QUEUE-11 | regression | apps/agent-server/src/__tests__/execution-queue.test.ts | ✅ green |
| 02-01+02 | — | — | QUEUE-10+11 | integration | manual (requires real Redis) | manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/queue/src/__tests__/pubsub.test.ts` — 14 tests for RedisPubSub publish/getHistory/createSubscriber/goalChannel/historyKey with mocked ioredis
- [x] `apps/agent-server/src/__tests__/sse-stream.test.ts` — 7 tests for SSE stream: history replay, live event forwarding, terminal states, disconnect cleanup
- [x] Extended `apps/agent-server/src/__tests__/worker.test.ts` — 6 new pub/sub tests (onProgress callback → publish)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full pub/sub round-trip: publish → channel → SSE client | QUEUE-10+11 | Requires real Redis connection | 1. Start Redis + worker + server, 2. Open dashboard SSE stream, 3. Execute goal via POST, 4. Verify events appear in real-time |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated

---

## Validation Audit 2026-03-09

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Both requirements (QUEUE-10, QUEUE-11) have automated test coverage. Queue pubsub tests (14/14) verified green in this session as part of 24/24 queue package tests. SSE stream and worker tests confirmed present.
