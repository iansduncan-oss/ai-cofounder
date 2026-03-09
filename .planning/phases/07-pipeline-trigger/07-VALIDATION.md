---
phase: 7
slug: pipeline-trigger
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + jsdom + @testing-library/react |
| **Config file** | `apps/dashboard/vite.config.ts` (test section) |
| **Quick run command** | `npm run test -w @ai-cofounder/dashboard` |
| **Full suite command** | `npm run test -w @ai-cofounder/dashboard` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/dashboard`
- **After every plan wave:** Run `npm run test -w @ai-cofounder/dashboard`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | TRIGGER-01 | unit | `npm run test -w @ai-cofounder/dashboard` | ✅ (extend pipelines.test.tsx) | ⬜ pending |
| 07-01-02 | 01 | 1 | TRIGGER-02 | unit | `npm run test -w @ai-cofounder/dashboard` | ✅ (extend pipelines.test.tsx) | ⬜ pending |
| 07-01-03 | 01 | 1 | TRIGGER-03 | unit | `npm run test -w @ai-cofounder/dashboard` | ✅ (extend pipelines.test.tsx) | ⬜ pending |
| 07-01-04 | 01 | 1 | TRIGGER-04 | unit | `npm run test -w @ai-cofounder/dashboard` | ✅ (extend pipelines.test.tsx) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- `apps/dashboard/src/__tests__/pages/pipelines.test.tsx` — existing test file to extend
- `apps/dashboard/src/__tests__/setup.ts` — shared test setup with jest-dom matchers
- `apps/dashboard/src/__tests__/test-utils.tsx` — `renderWithProviders()` wrapper with MemoryRouter
- `useNavigate` mock pattern established in `login.test.tsx`

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
