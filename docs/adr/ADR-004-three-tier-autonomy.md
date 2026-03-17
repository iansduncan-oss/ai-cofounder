# ADR-004: Three-Tier Autonomy System

**Status:** Accepted
**Date:** 2026-03-10
**Tags:** autonomy, orchestrator, approvals

## Context

The orchestrator executes 30+ tools on behalf of the user. Some tools are safe to run unattended (memory recall, web search), while others have real-world side effects that require human oversight (git push, file deletion, deploy triggers). We needed a system that:

1. Allows fully autonomous execution of safe operations
2. Pauses for human approval on risky operations
3. Completely blocks destructive operations from autonomous sessions
4. Can be reconfigured at runtime without redeployment

## Decision

Implement a **three-tier tool classification** system — green, yellow, red — stored in the `toolTierConfigs` database table and enforced by the `AutonomyTierService`.

### Tiers

| Tier | Behavior | Examples |
|------|----------|---------|
| **Green** | Execute immediately, no approval needed | `recall_memories`, `search_web`, `browse_web`, `read_file`, `list_directory`, `git_status`, `git_diff`, `git_log` |
| **Yellow** | Pause and create an approval request; resume after human approves | `write_file`, `git_commit`, `git_push`, `create_pr`, `execute_code`, `trigger_workflow` |
| **Red** | Blocked entirely from autonomous sessions; available in interactive sessions only | `delete_file`, `delete_directory`, `create_plan` (via autonomous), `request_approval` |

### Architecture

```
AutonomyTierService
├── In-memory Map cache (tool → tier + timeout)
├── load() — reads from DB at startup via listToolTierConfigs()
├── reload() — live reload with mutex (prevents concurrent reloads)
├── getTier(toolName) → "green" | "yellow" | "red"
├── getTimeoutMs(toolName) → number
└── getAllRed() → string[]

Orchestrator.executeTool()
├── Checks tier before execution
├── Green → execute
├── Yellow → create approval, pause task
└── Red → reject with explanation
```

### Runtime Reconfiguration

Tool tiers are stored in the `toolTierConfigs` DB table with columns: `id`, `toolName`, `tier`, `timeoutMs`, `reason`, `updatedAt`. The service exposes CRUD via REST endpoints (`GET/PUT /api/autonomy/tiers`), and the dashboard provides a management UI.

## Consequences

### Benefits

- **Safety by default** — new tools default to green, but dangerous tools are explicitly gated
- **Runtime flexibility** — tier changes take effect on next `reload()` without restart
- **Audit trail** — approval records in DB track who approved what and when
- **Autonomous-safe** — red tier prevents autonomous sessions from taking destructive actions

### Trade-offs

- In-memory cache means tier changes require explicit reload (not instant)
- Approval flow adds latency to yellow-tier tool execution
- Tier classification is a manual decision — no automatic risk assessment

## Files

- `apps/agent-server/src/services/autonomy-tier.ts` — AutonomyTierService
- `apps/agent-server/src/routes/autonomy.ts` — CRUD API for tier configuration
- `packages/db/src/schema.ts` — `toolTierConfig` table
- `packages/db/src/repositories.ts` — `listToolTierConfigs()`, `upsertToolTierConfig()`
