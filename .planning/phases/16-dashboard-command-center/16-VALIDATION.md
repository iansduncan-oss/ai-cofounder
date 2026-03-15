---
phase: 16
slug: dashboard-command-center
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 16-01-01 | 01 | 1 | DASH-01 | unit | `npm test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | DASH-02 | unit | `npm test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |
| 16-01-03 | 01 | 1 | DASH-03 | unit | `npm test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 1 | DASH-04 | unit | `npm test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |
| 16-02-02 | 02 | 1 | DASH-05 | unit | `npm test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |
| 16-03-01 | 03 | 1 | DASH-06 | unit | `npm test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/dashboard/src/__tests__/routes/journal.test.tsx` — covers DASH-01
- [ ] `apps/dashboard/src/__tests__/routes/approvals.test.tsx` — covers DASH-02
- [ ] `apps/dashboard/src/__tests__/routes/usage.test.tsx` — covers DASH-03
- [ ] `apps/dashboard/src/__tests__/components/project-switcher.test.tsx` — covers DASH-04
- [ ] `apps/dashboard/src/__tests__/routes/notifications.test.tsx` — covers DASH-05
- [ ] `apps/dashboard/src/__tests__/routes/settings-extended.test.tsx` — covers DASH-06 new sections
- [ ] Confirm root vitest.config.ts includes `.test.tsx` glob

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Approval actions update agent execution within 2s | DASH-02 | Requires running agent-server + real WebSocket | 1. Open approvals page 2. Trigger yellow-tier tool 3. Approve from dashboard 4. Verify execution resumes within 2s |
| Settings changes take effect immediately | DASH-06 | Requires full server restart verification | 1. Change budget threshold in settings 2. Verify budget gauge updates without refresh |
| Notification center shows real-time updates | DASH-05 | Requires WebSocket push | 1. Open notifications page 2. Trigger an event (approval, budget alert) 3. Verify it appears without refresh |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
