---
phase: 3
slug: authentication
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-08
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `vitest.config.ts` at monorepo root |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~15-20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | AUTH-01 | unit (inject) | `npm run test -w @ai-cofounder/agent-server -- --grep "auth routes"` | ❌ W0 | ⬜ pending |
| 3-01-02 | 01 | 1 | AUTH-02 | unit | same | ❌ W0 | ⬜ pending |
| 3-01-03 | 01 | 1 | AUTH-03 | unit (inject) | same | ❌ W0 | ⬜ pending |
| 3-01-04 | 01 | 1 | AUTH-05 | unit (inject) | same | ❌ W0 | ⬜ pending |
| 3-01-05 | 01 | 1 | AUTH-06 | unit (inject) | same | ❌ W0 | ⬜ pending |
| 3-01-06 | 01 | 1 | AUTH-07 | unit (mock db) | same | ❌ W0 | ⬜ pending |
| 3-01-07 | 01 | 1 | AUTH-08 | unit | same | ❌ W0 | ⬜ pending |
| 3-02-01 | 02 | 2 | AUTH-04 | unit (inject) | same | ❌ W0 | ⬜ pending |
| 3-02-02 | 02 | 2 | AUTH-09 | unit (inject) | same | ❌ W0 | ⬜ pending |
| 3-02-03 | 02 | 2 | AUTH-10 | unit (RTL) | `npm run test -w @ai-cofounder/dashboard` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/auth-routes.test.ts` — stubs for AUTH-01 through AUTH-09
- [ ] `apps/dashboard/src/__tests__/components/auth-guard.test.tsx` — UPDATE existing test to use in-memory token (AUTH-10)
- [ ] `apps/dashboard/src/__tests__/routes/login.test.tsx` — login form test (AUTH-10)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HttpOnly cookie not accessible via JS | AUTH-03 | Browser security model | Open DevTools → Application → Cookies → verify HttpOnly flag |
| Silent token refresh across page reload | AUTH-10 | Full browser lifecycle | Reload dashboard page, verify no login redirect |
| CORS credentials in dev mode | AUTH-03 | Cross-origin cookie | Run dashboard on :3200, API on :3100, verify cookie sent |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
