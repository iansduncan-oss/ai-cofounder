---
phase: 15
slug: content-automations
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `apps/agent-server/vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | CONT-01 | unit | `npx vitest run n8n-bridge` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 1 | CONT-02 | unit | `npx vitest run n8n-executions` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | CONT-01 | integration | `npx vitest run pipeline-template` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 1 | CONT-04 | unit | `npx vitest run journal-pipeline` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 2 | CONT-01 | integration | `npx vitest run dashboard-pipeline` | ❌ W0 | ⬜ pending |
| 15-03-02 | 03 | 2 | CONT-02 | integration | `npx vitest run dashboard-n8n` | ❌ W0 | ⬜ pending |
| 15-04-01 | 04 | 2 | CONT-03 | unit | `npx vitest run content-scheduling` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for n8n bridge service (CONT-01, CONT-02)
- [ ] Test stubs for pipeline template management (CONT-01)
- [ ] Test stubs for journal integration (CONT-04)
- [ ] Test stubs for dashboard content components (CONT-01, CONT-02)
- [ ] Test stubs for content scheduling (CONT-03)

*Existing vitest infrastructure covers framework needs — only test files needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| YouTube pipeline triggers real n8n workflow | CONT-01 | Requires running n8n instance | Trigger from dashboard, verify n8n execution starts |
| Published content links resolve | CONT-04 | External URL validation | Click links in work journal entries |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
