---
phase: 6
slug: pipeline-detail
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace config) |
| **Config file** | `vitest.config.ts` — dashboard uses its own via `npm test -w @ai-cofounder/dashboard` |
| **Quick run command** | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx --reporter=verbose` |
| **Full suite command** | `npm test -w @ai-cofounder/dashboard` |
| **Estimated runtime** | ~5-10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx --reporter=verbose`
- **After every plan wave:** Run `npm test -w @ai-cofounder/dashboard`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | DETAIL-01 | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "shows stage status"` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | DETAIL-02 | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "expands stage"` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | DETAIL-03 | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "shows duration"` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | DETAIL-04 | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "shows metadata"` | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | DETAIL-05 | unit | `npx vitest run apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx -t "auto-refresh"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/dashboard/src/__tests__/pages/pipeline-detail.test.tsx` — stubs for DETAIL-01 through DETAIL-05

*Existing infrastructure covers all other phase requirements (test-utils.tsx, setup.ts, vitest globals configured).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto-refresh visual indicator | DETAIL-05 | Visual confirmation of "Auto-refreshing every 5s" text appearing/disappearing | 1. Navigate to an active pipeline detail page 2. Verify "Auto-refreshing every 5s" text is visible 3. Wait for pipeline to complete 4. Verify text disappears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
