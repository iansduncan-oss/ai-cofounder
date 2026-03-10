---
phase: 11
slug: autonomous-scheduling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server -- --run --reporter=verbose` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~45 seconds (agent-server workspace) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server -- --run --reporter=verbose`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | SCHED-02 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "DistributedLock"` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | SCHED-03 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "TokenBudget"` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | SCHED-01 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "scheduler.*autonomous"` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 2 | SCHED-04 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "CiSelfHeal"` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 2 | SCHED-02 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*skipped"` | ✅ extend | ⬜ pending |
| 11-02-03 | 02 | 2 | SCHED-03 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*aborted"` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/distributed-lock.test.ts` — stubs for SCHED-02 (acquire, release, contention, TTL)
- [ ] `apps/agent-server/src/__tests__/ci-self-heal.test.ts` — stubs for SCHED-04 (recordFailure 1x/2x, recordSuccess, healAttempted guard, branch skip)
- [ ] Extend `apps/agent-server/src/__tests__/autonomous-session.test.ts` — SCHED-02 lock-skip, SCHED-03 token-abort
- [ ] Extend `apps/agent-server/src/__tests__/autonomous-executor.test.ts` — SCHED-03 per-task token accumulation

*No new framework install needed — Vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Recurring job fires on schedule | SCHED-01 | Requires real BullMQ + Redis timing | Start server, wait for interval, check work_sessions table |
| CI self-heal creates actual PR | SCHED-04 | Requires real GitHub API + CI failure | Introduce a test failure, push, wait for 2 monitoring cycles |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
