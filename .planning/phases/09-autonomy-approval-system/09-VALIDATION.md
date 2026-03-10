---
phase: 9
slug: autonomy-approval-system
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm run test -w @ai-cofounder/agent-server -- --reporter=verbose --testPathPattern="autonomy"` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~45s full suite; ~8s autonomy-only |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy"`
- **After every plan wave:** Run `npm run test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 8 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | AUTO-01 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-tier"` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | AUTO-02 | unit+int | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-tier"` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | AUTO-03 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-tier"` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 1 | AUTO-04 | unit | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-routes"` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 1 | AUTO-05 | integration | `npm run test -w @ai-cofounder/agent-server -- --testPathPattern="autonomy-routes"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/autonomy-tier.test.ts` — stubs for AUTO-01, AUTO-02, AUTO-03
- [ ] `apps/agent-server/src/__tests__/autonomy-routes.test.ts` — stubs for AUTO-04, AUTO-05
- [ ] `packages/test-utils/src/mocks/db.ts` — add `listToolTierConfigs`, `upsertToolTierConfig`, `getToolTierConfig` to `mockDbModule()`

*All test files are Wave 0 gaps — must be created before implementation begins.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Slack button approve/reject callback | AUTO-04 | Requires live Slack app interaction | 1. Trigger yellow-tier tool 2. Click Approve in Slack 3. Verify tool executes |
| Dashboard tier config saves take effect immediately | AUTO-05 | Requires full stack (dashboard + server + DB) | 1. Change tool tier in dashboard 2. Trigger agent tool 3. Verify new tier enforced |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
