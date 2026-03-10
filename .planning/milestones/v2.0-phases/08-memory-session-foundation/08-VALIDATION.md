---
phase: 8
slug: memory-session-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-09
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (root) |
| **Quick run command** | `npm test -w @ai-cofounder/agent-server -- --run` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -w @ai-cofounder/agent-server -- --run`
- **After every plan wave:** Run `npm test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | MEM-01 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "conversation ingestion"` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | MEM-02 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "decision extraction"` | ❌ W0 | ⬜ pending |
| 08-01-03 | 01 | 1 | MEM-03 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "project ingestion"` | ❌ W0 | ⬜ pending |
| 08-02-01 | 02 | 2 | MEM-04 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "auto context"` | ❌ W0 | ⬜ pending |
| 08-02-02 | 02 | 2 | MEM-05 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "consolidation"` | ❌ W0 | ⬜ pending |
| 08-02-03 | 02 | 2 | SESS-01 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "session context"` | ❌ W0 | ⬜ pending |
| 08-02-04 | 02 | 2 | SESS-02 | unit | `npm test -w @ai-cofounder/agent-server -- --run -t "proactive reference"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `apps/agent-server/src/__tests__/conversation-ingestion.test.ts` — stubs for MEM-01, MEM-02, MEM-03
- [ ] `apps/agent-server/src/__tests__/session-context.test.ts` — stubs for MEM-04, MEM-05, SESS-01, SESS-02

*Existing vitest + test-utils infrastructure covers framework needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent references past decision unprompted | SESS-02 | Requires LLM output evaluation | Send a message about a previously decided topic, verify response includes reference |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
