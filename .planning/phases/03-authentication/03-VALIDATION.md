---
phase: 3
slug: authentication
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-08
validated: 2026-03-09
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` at monorepo root |
| **Quick run command** | `npm run test -w @ai-cofounder/dashboard -- --reporter=dot` |
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

| Task ID | Plan | Wave | Requirement | Test Type | Test File | Status |
|---------|------|------|-------------|-----------|-----------|--------|
| 3-01-01 | 01 | 1 | AUTH-01 | unit (inject) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-01-02 | 01 | 1 | AUTH-02 | unit | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-01-03 | 01 | 1 | AUTH-03 | unit (inject) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-01-04 | 01 | 1 | AUTH-05 | unit (inject) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-01-05 | 01 | 1 | AUTH-06 | unit (inject) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-01-06 | 01 | 1 | AUTH-07 | unit (mock db) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-01-07 | 01 | 1 | AUTH-08 | unit | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-02-01 | 02 | 2 | AUTH-04 | unit (inject) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-02-02 | 02 | 2 | AUTH-09 | unit (inject) | apps/agent-server/src/__tests__/auth-routes.test.ts | ✅ green |
| 3-02-03 | 02 | 2 | AUTH-10 | unit (RTL) | apps/dashboard/src/__tests__/components/auth-guard.test.tsx + routes/login.test.tsx | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `apps/agent-server/src/__tests__/auth-routes.test.ts` — 17 tests covering AUTH-01 through AUTH-09
- [x] `apps/dashboard/src/__tests__/components/auth-guard.test.tsx` — Updated to use setAccessToken() (AUTH-10)
- [x] `apps/dashboard/src/__tests__/routes/login.test.tsx` — Login form tests (AUTH-10)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| HttpOnly cookie not accessible via JS | AUTH-03 | Browser security model | Open DevTools → Application → Cookies → verify HttpOnly flag |
| Silent token refresh across page reload | AUTH-10 | Full browser lifecycle | Reload dashboard page, verify no login redirect |
| CORS credentials in dev mode | AUTH-03 | Cross-origin cookie | Run dashboard on :5173, API on :3100, verify cookie sent |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 20s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated

---

## Validation Audit 2026-03-09

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 10 AUTH requirements have automated test coverage. auth-routes.test.ts has 17 tests (server-side), auth-guard.test.tsx and login.test.tsx cover dashboard-side auth. Dashboard tests (80/80) verified green in this session.
