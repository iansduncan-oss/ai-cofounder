---
phase: 16
slug: dashboard-command-center
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-15
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + @testing-library/react |
| **Config file** | `vitest.config.ts` (root — covers `**/src/**/*.test.{ts,tsx}`) |
| **Quick run command** | `npm run test -w @ai-cofounder/dashboard` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~30 seconds (dashboard), ~120 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/dashboard`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | DASH-06 | unit | `npm test -w @ai-cofounder/db` | tdd | pending |
| 16-01-02 | 01 | 1 | DASH-06 | unit | `npm test -w @ai-cofounder/agent-server -- --testPathPattern=settings-api --run` | tdd | pending |
| 16-01-03 | 01 | 1 | DASH-01, DASH-02 | unit | `npm test -w @ai-cofounder/dashboard -- --testPathPattern='journal\|approvals' --run` | tdd | pending |
| 16-02-01 | 02 | 1 | DASH-04 | unit | `npm test -w @ai-cofounder/dashboard -- --testPathPattern=project-switcher --run` | tdd | pending |
| 16-02-02 | 02 | 1 | DASH-05 | unit | `npm test -w @ai-cofounder/dashboard -- --testPathPattern=notifications --run` | tdd | pending |
| 16-03-01 | 03 | 2 | DASH-06 | unit | `npm test -w @ai-cofounder/dashboard -- --testPathPattern=settings-extended --run` | tdd | pending |

*Status: pending | green | red | flaky*

---

## Wave 0 Requirements

All Wave 0 test gaps are now addressed by tdd="true" tasks within their respective plans:

- [x] `apps/dashboard/src/__tests__/routes/journal.test.tsx` — created in Plan 01 Task 3 (tdd)
- [x] `apps/dashboard/src/__tests__/routes/approvals.test.tsx` — created in Plan 01 Task 3 (tdd)
- [x] `apps/dashboard/src/__tests__/components/project-switcher.test.tsx` — created in Plan 02 Task 1 (tdd)
- [x] `apps/dashboard/src/__tests__/routes/notifications.test.tsx` — created in Plan 02 Task 2 (tdd)
- [x] `apps/dashboard/src/__tests__/routes/settings-extended.test.tsx` — created in Plan 03 Task 1 (tdd)
- [x] DASH-03 (UsagePage) — already complete per research, existing test coverage sufficient
- [x] Confirm root vitest.config.ts includes `.test.tsx` glob

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Approval actions update agent execution within 2s | DASH-02 | Requires running agent-server + real WebSocket | 1. Open approvals page 2. Trigger yellow-tier tool 3. Approve from dashboard 4. Verify execution resumes within 2s |
| Settings changes take effect immediately | DASH-06 | Requires full server restart verification | 1. Change budget threshold in settings 2. Verify budget gauge updates without refresh |
| Notification center shows real-time updates | DASH-05 | Requires WebSocket push | 1. Open notifications page 2. Trigger an event (approval, budget alert) 3. Verify it appears without refresh |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or tdd="true" test creation
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all resolved via tdd tasks)
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved
