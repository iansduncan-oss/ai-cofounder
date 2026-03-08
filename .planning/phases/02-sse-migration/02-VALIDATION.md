---
phase: 2
slug: sse-migration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="pubsub\|sse-stream\|execution-queue"` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="pubsub\|sse-stream\|execution-queue\|worker"`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | QUEUE-10 | unit | `npm run test -w @ai-cofounder/queue -- --testPathPattern="pubsub"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 1 | QUEUE-10 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="worker"` | ✅ (extend) | ⬜ pending |
| 02-02-01 | 02 | 2 | QUEUE-11 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="sse-stream\|execution"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | QUEUE-11 | unit | same as above | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | QUEUE-11 | regression | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="execution-queue"` | ✅ | ⬜ pending |
| 02-01+02 | — | — | QUEUE-10+11 | integration | manual (requires real Redis) | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/queue/src/__tests__/pubsub.test.ts` — stubs for RedisPubSub publish/getHistory/createSubscriber/goalChannel/historyKey with mocked ioredis
- [ ] `apps/agent-server/src/__tests__/sse-stream.test.ts` — stubs for SSE stream endpoint: history replay, live event forwarding, client disconnect cleanup, terminal states
- [ ] Extend `apps/agent-server/src/__tests__/worker.test.ts` — add pub/sub coverage (onProgress callback → publish)

*Existing `execution-queue.test.ts` covers QUEUE-02/09 regression — no new file needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full pub/sub round-trip: publish → channel → SSE client | QUEUE-10+11 | Requires real Redis connection | 1. Start Redis + worker + server, 2. Open dashboard SSE stream, 3. Execute goal via POST, 4. Verify events appear in real-time |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
