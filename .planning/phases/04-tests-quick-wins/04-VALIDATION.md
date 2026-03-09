---
phase: 4
slug: tests-quick-wins
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-08
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~60 seconds (agent-server); ~120 seconds full suite |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | TEST-01 | integration | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-01-02 | 01 | 1 | TEST-02 | integration | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-01-03 | 01 | 1 | TEST-05 | integration | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-02-01 | 02 | 1 | TEST-03 | integration | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-02-02 | 02 | 1 | TEST-04 | integration | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-02-03 | 02 | 1 | TEST-06 | smoke | `npm run test` | CI yml | pending |
| 04-03-01 | 03 | 2 | QWIN-01 | unit | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-03-02 | 03 | 2 | QWIN-02 | unit | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-03-03 | 03 | 2 | QWIN-03 | unit | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-03-04 | 03 | 2 | QWIN-04 | unit | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-03-05 | 03 | 2 | QWIN-05 | unit | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |
| 04-03-06 | 03 | 2 | QWIN-06 | unit | `npm run test -w @ai-cofounder/agent-server` | W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/e2e-goal-lifecycle.test.ts` — stubs for TEST-01 through TEST-06
- [ ] Truncate helper (inline in e2e test file) — cleanup between runs for TEST-05
- [ ] QWIN-01/02 tests in `apps/agent-server/src/__tests__/workspace-service.test.ts`
- [ ] QWIN-03 test in agents routes test file
- [ ] QWIN-04 test in `apps/agent-server/src/__tests__/conversation-routes.test.ts`
- [ ] QWIN-05/06 swagger tests (new test file or existing)

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
