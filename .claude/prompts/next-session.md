# Next Session Priorities

## Context

Session 55 shipped all 4 backend roadmap items (adaptive routing, voice UI, RBAC, extended thinking) plus workspace multi-tenancy foundation, self-healing, WebSocket chat, and 4 production deploys. v3.0 milestone is fully shipped. The system is feature-rich but needs a consolidation pass.

## Pre-work

1. Read `.claude/primer.md` for full session context
2. Check if Anthropic API credits have been topped up
3. `ssh vps "curl -sf http://localhost:3100/health/deep | python3 -m json.tool"` — verify production health

## Priority Items

### 1. Complete Workspace Multi-Tenancy (medium effort, high value)

The foundation is deployed (workspaces table, nullable workspace_id columns, context plugin, dashboard page). What remains:

- **Thread workspaceId through all service constructors** — episodic memory, procedural memory, decision extractor, reflection, verification, memory consolidation all accept optional workspaceId now but don't receive it from the orchestrator
- **Orchestrator needs workspace context** — when running from a route, the orchestrator should receive `request.workspaceId` and pass it to all service calls
- **Worker needs workspace resolution** — background jobs (BullMQ) need to resolve workspace from goal/conversation context
- **Migration: SET NOT NULL** — once all callers pass workspaceId, run a follow-up migration to enforce NOT NULL
- **Tests** — workspace scoping tests (user A can't see user B's goals in workspace B)

### 2. Verify Extended Thinking in Production (quick, blocked on credits)

If Anthropic credits are topped up:
- Run a goal with planning task category — should trigger ComplexityEstimator → thinking tokens
- Check `GET /api/thinking/:conversationId` for stored thinking traces
- Verify dashboard thinking page displays them

### 3. End-to-End RBAC Verification (quick)

- Create an invite via `POST /api/auth/invite` with admin JWT
- Open the invite link, register as editor
- Verify editor can create goals but not access `/api/settings`
- Verify viewer role gets 403 on write operations

### 4. v4.0 Milestone Planning (if time permits)

Potential v4.0 themes:
- **Multi-tenant teams** — team creation, shared workspaces, per-team billing
- **Context window optimization** — LLM-based conversation summarization for long contexts
- **Plugin system** — third-party tool registration, custom agent specialists
- **Mobile app** — React Native wrapper or PWA for mobile notifications + quick actions
- **Advanced analytics** — cost attribution per workspace, ROI tracking, agent performance trends

### 5. Production Observability

- Add Grafana dashboards for new features:
  - Adaptive routing decisions (override rate, confidence distribution)
  - Complexity scores over time
  - RBAC activity (invites, role changes)
  - Workspace usage breakdown
- Alert rules for new failure modes (workspace resolution failures, routing errors)

## What NOT to Do

- Don't start new major features until workspace tenancy is complete
- Don't refactor working code — the codebase is stable and well-tested
- Don't add more dashboard pages — we have 40+ already
