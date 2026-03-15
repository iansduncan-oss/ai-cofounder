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
| 15-01-01 | 01 | 1 | CONT-01 | unit | `npm run build -w @ai-cofounder/db` | N/A (build) | ⬜ pending |
| 15-01-02 | 01 | 1 | CONT-02 | unit | `npm run build -w @ai-cofounder/db && npm run build -w @ai-cofounder/agent-server` | N/A (build) | ⬜ pending |
| 15-02-01 | 02 | 2 | CONT-01, CONT-02 | integration | `npx vitest run pipeline-templates` | ❌ W0 | ⬜ pending |
| 15-02-02 | 02 | 2 | CONT-03, CONT-04 | unit | `npx vitest run --testPathPattern="pipeline\|n8n\|journal"` | ❌ W0 | ⬜ pending |
| 15-03-01 | 03 | 3 | CONT-01 | build | `npm run build -w @ai-cofounder/api-client && npm run build -w @ai-cofounder/dashboard` | N/A (build) | ⬜ pending |
| 15-03-02 | 03 | 3 | CONT-02 | build | `npm run build -w @ai-cofounder/dashboard` | N/A (build) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for pipeline template routes (`apps/agent-server/src/__tests__/pipeline-templates.test.ts`)
- [ ] Extended tests for N8nService.listExecutions (`apps/agent-server/src/__tests__/n8n-service.test.ts`)

*Existing vitest infrastructure covers framework needs — only test files needed. Plan 01 tasks are build-verified (no dedicated test files). Plan 03 tasks are build-verified (dashboard components).*

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
