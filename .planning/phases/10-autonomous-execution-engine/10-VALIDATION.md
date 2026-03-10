---
phase: 10
slug: autonomous-execution-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (root `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server -- --run --reporter=verbose` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~45 seconds |

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
| 10-01-01 | 01 | 1 | TERM-01 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "listGoalBacklog"` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | TERM-02 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "AutonomousExecutor"` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | TERM-03 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "buildConventionalCommit"` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | TERM-04 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "generatePrDescription"` | ❌ W0 | ⬜ pending |
| 10-01-05 | 01 | 1 | TERM-05 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "actionsTaken\|work.*log"` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | TERM-05 | unit | `npm run test -w @ai-cofounder/agent-server -- --run -t "autonomous.*routes\|sessions"` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | TERM-01+SSE | integration | `npm run test -w @ai-cofounder/agent-server -- --run execution-queue` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/autonomous-executor.test.ts` — stubs for TERM-01 through TERM-05
- [ ] `apps/agent-server/src/__tests__/autonomous-routes.test.ts` — stubs for REST API endpoints
- [ ] Add `listGoalBacklog` + `getCostByGoal` to `packages/test-utils/src/mocks/db.ts` → `mockDbModule()`

*Existing infrastructure covers test framework.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SSE events visible in dashboard | TERM-05 (SC5) | Requires browser + running dashboard | 1. Start dev, 2. Create goal with tasks, 3. Trigger autonomous run, 4. Observe SSE events in dashboard HUD |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
