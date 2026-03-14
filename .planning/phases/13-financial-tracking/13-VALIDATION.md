---
phase: 13
slug: financial-tracking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-14
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (root `vitest.config.ts`) |
| **Config file** | `/Users/ianduncan/Projects/ai-cofounder/vitest.config.ts` |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern=budget-alert` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~30 seconds (targeted), ~90 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=budget-alert`
- **After every plan wave:** Run `npm run test -w @ai-cofounder/agent-server && npm run test -w @ai-cofounder/db`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | FIN-01 | unit | `npm run test -w @ai-cofounder/db -- --testPathPattern=repositories` | Partial | ⬜ pending |
| 13-01-02 | 01 | 1 | FIN-02 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=usage` | ❌ W0 | ⬜ pending |
| 13-01-03 | 01 | 1 | FIN-03 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=budget-alert` | ❌ W0 | ⬜ pending |
| 13-01-04 | 01 | 1 | FIN-03 | smoke | Check `setupRecurringJobs` registers `budget_check` with `every: 60_000` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 1 | FIN-04 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=budget-alert` | ❌ W0 | ⬜ pending |
| 13-02-02 | 02 | 1 | FIN-02 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern=usage` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/budget-alert.test.ts` — stubs for FIN-03, FIN-04 (BudgetAlertService tests)
- [ ] `apps/agent-server/src/__tests__/usage-routes.test.ts` — stubs for FIN-02 daily endpoint, FIN-03/04 budget endpoint
- [ ] `getCostByDay` test added to `packages/db/src/__tests__/repositories.test.ts` — covers FIN-02

*Existing vitest infrastructure covers all framework needs — no new test tool installation required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dashboard daily trend chart renders correctly | FIN-02 | Visual component — recharts rendering | Load dashboard Usage page, verify LineChart shows 30-day trend |
| Budget gauge card displays threshold | FIN-03 | Visual component | Set DAILY_BUDGET_USD, load dashboard, verify gauge |
| Slack notification received on threshold | FIN-03 | External integration | Set low budget, trigger LLM calls, check Slack channel |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
