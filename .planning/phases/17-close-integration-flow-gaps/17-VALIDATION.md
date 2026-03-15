---
phase: 17
slug: close-integration-flow-gaps
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` (monorepo root) |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 17-01-01 | 01 | 1 | TERM-01, TERM-05 | unit | `npm run test -w @ai-cofounder/dashboard -- --reporter=verbose --testPathPattern="autonomous-sessions"` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | CONT-04, DASH-01 | unit | `npm run test -w @ai-cofounder/dashboard -- --reporter=verbose --testPathPattern="journal"` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 1 | PROJ-01, DASH-04 | unit | `npm run test -w @ai-cofounder/dashboard -- --reporter=verbose --testPathPattern="project"` | ❌ W0 | ⬜ pending |
| 17-04-01 | 04 | 1 | AUTO-01, AUTO-02, AUTO-03, SCHED-01 | unit | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="scheduler"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/dashboard/src/__tests__/autonomous-sessions.test.tsx` — renders sessions from API, status badges, duration display
- [ ] `apps/dashboard/src/__tests__/journal.test.tsx` — content_pipeline type renders "Content Pipeline" label with correct icon
- [ ] `apps/agent-server/src/__tests__/scheduler-tier.test.ts` — autonomyTierService passed to Orchestrator constructor

*Existing infrastructure covers remaining requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Project switcher changes workspace display context | PROJ-01, DASH-04 | Workspace-page context is UI-specific; no API filter to assert | 1. Open dashboard, 2. Switch project in header, 3. Verify workspace page shows selected project path |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
