# Test Coverage Analysis

**Date:** 2026-03-31
**Branch:** `claude/analyze-test-coverage-UhY0Q`

## Overview

| Workspace | Source Files | Test Files | File Coverage |
|-----------|-------------|------------|---------------|
| **apps/agent-server** | 172 | 149 | 87% |
| **apps/dashboard** | 20 | 10 | 50% |
| **apps/discord-bot** | 15 | 2 | 13% |
| **apps/slack-bot** | 2 | 1 | 50% |
| **packages/db** | 8 | 4 | 50% |
| **packages/llm** | 10 | 6 | 60% |
| **packages/queue** | 7 | 2 | 29% |
| **packages/rag** | 7 | 7 | 100% |
| **packages/api-client** | 3 | 2 | 67% |
| **packages/bot-handlers** | 4 | 3 | 75% |
| **packages/mcp-server** | 3 | 1 | 33% |
| **packages/sandbox** | 3 | 1 | 33% |
| **packages/shared** | 5 | 3 | 60% |
| **packages/test-utils** | 6 | 0 | 0% |
| **Total** | 265 | 191 | 72% |

Current coverage thresholds (vitest.config.ts): Lines 60%, Functions 52%, Branches 50%, Statements 60%.

---

## Priority 1: Critical Gaps

### 1. Agent Core (0% tested) -- HIGH IMPACT

The entire agent execution layer has zero direct unit tests:

- `apps/agent-server/src/agents/dispatcher.ts` -- Task dispatch and execution ordering
- `apps/agent-server/src/agents/orchestrator.ts` -- Main agentic tool loop (up to 5 rounds)
- `apps/agent-server/src/agents/tool-executor.ts` -- Tool execution switch/dispatch
- `apps/agent-server/src/agents/summarizer.ts` -- Response summarization
- `apps/agent-server/src/agents/stream-events.ts` -- SSE event streaming

All 8 specialist agents are also untested:
- `agents/specialists/base.ts`, `coder.ts`, `debugger.ts`, `doc-writer.ts`, `planner.ts`, `researcher.ts`, `reviewer.ts`, `verifier.ts`

**Why it matters:** This is the core product logic. The orchestrator's tool loop, the dispatcher's task ordering, and each specialist's behavior are the most critical paths in the system. A regression here breaks everything.

**Recommended tests:**
- Orchestrator: tool loop termination, tool selection, context passing between rounds
- Dispatcher: task ordering by `orderIndex`, approval gate checks, context chain assembly
- Tool executor: correct dispatch for each tool name, error handling for unknown tools
- Each specialist: system prompt construction, tool availability, `completeWithRetry` behavior

### 2. Queue Infrastructure (29% tested) -- HIGH IMPACT

Only `pubsub.ts` and `queue-config.ts` are tested. Missing:

- `packages/queue/src/connection.ts` -- Redis connection management
- `packages/queue/src/workers.ts` -- Worker implementations
- `packages/queue/src/scheduler.ts` -- Recurring job scheduling
- `packages/queue/src/queues.ts` -- Queue definitions
- `packages/queue/src/helpers.ts` -- Queue utilities

**Why it matters:** All async processing (briefings, monitoring, notifications, meeting prep, pipelines) flows through BullMQ. Connection failures or worker bugs silently break background processing.

**Recommended tests:**
- Workers: job handler dispatch, error handling, retry behavior
- Scheduler: recurring job registration, cron expression handling
- Connection: graceful reconnection, connection pooling

### 3. LLM Provider Implementations (0% provider tests) -- HIGH IMPACT

Registry/coordination is well-tested, but no individual provider has tests:

- `packages/llm/src/providers/anthropic.ts`
- `packages/llm/src/providers/gemini.ts`
- `packages/llm/src/providers/groq.ts`
- `packages/llm/src/providers/openrouter.ts`
- `packages/llm/src/providers/openai-compatible.ts`
- `packages/llm/src/provider.ts` (base class)

**Why it matters:** Each provider has unique request/response mapping, error handling, and streaming behavior. Provider-specific bugs (wrong model names, incorrect token counting, malformed tool calls) are common and hard to catch without unit tests.

**Recommended tests:**
- Request formatting: correct headers, model mapping, tool schema translation
- Response parsing: content extraction, tool call parsing, token usage extraction
- Error handling: rate limits (429), auth failures (401), timeout behavior
- Streaming: chunk parsing, partial JSON handling

---

## Priority 2: Important Gaps

### 4. Untested Routes (22 routes) -- MEDIUM IMPACT

These route files have no corresponding tests:

| Route | Description |
|-------|-------------|
| `agents.ts` | Core agent execution endpoints |
| `approvals.ts` | Approval workflow CRUD |
| `briefings.ts` | Daily briefing generation |
| `conversations.ts` | Conversation management |
| `milestones.ts` | Milestone tracking |
| `memories.ts` | Memory CRUD |
| `tasks.ts` | Task management |
| `users.ts` | User management |
| `subagents.ts` | Sub-agent orchestration |
| `decisions.ts` | Decision tracking |
| `schedules.ts` | Scheduled job management |
| `work-sessions.ts` | Work session tracking |
| `deploys.ts` | Deploy management |
| `reflections.ts` | Reflection endpoints |
| `recap.ts` | Recap generation |
| `channels.ts` | Channel management |
| `monitoring.ts` | System monitoring |
| `projects.ts` | Project registry |
| `agent-info.ts` | Agent metadata |
| `agent-messages.ts` | Agent messaging |
| `voice.ts` | Voice UI endpoints |
| `workspaces.ts` | Workspace management |

**Recommended focus:** Start with `agents.ts`, `approvals.ts`, `conversations.ts`, `milestones.ts`, and `tasks.ts` -- these are the most user-facing and frequently hit.

### 5. Untested Services (10 services) -- MEDIUM IMPACT

| Service | Description |
|---------|-------------|
| `action-recorder.ts` | Action auditing |
| `conversation-branching.ts` | Conversation fork logic |
| `discord.ts` | Discord integration |
| `document-watcher.ts` | Document change detection |
| `file-watcher.ts` | File system watching (chokidar) |
| `monitoring.ts` | System monitoring |
| `outbound-webhooks.ts` | Webhook delivery |
| `pr-review.ts` | PR review automation |
| `tts.ts` | Text-to-speech (ElevenLabs) |
| `vps-command.ts` | VPS command execution |

### 6. Discord Bot Commands (13% tested) -- MEDIUM IMPACT

Only 2 of 15 files are tested. All slash command handlers lack tests:
- `approve`, `ask`, `clear`, `execute`, `gmail`, `goals`, `help`, `memory`, `register-user`, `register`, `schedule`, `status`, `tasks`

**Recommended tests:** Mock the Discord.js interaction object and verify correct API client calls and response formatting.

### 7. Dashboard (50% tested) -- LOW-MEDIUM IMPACT

All 17 custom hooks are untested (`use-auth`, `use-sse`, `use-stream-chat`, `use-speech-recognition`, etc.). The API layer (`client.ts`, `mutations.ts`, `queries.ts`) also lacks tests.

**Recommended tests:** Use `@testing-library/react-hooks` for hook tests, mock fetch for API layer tests.

---

## Priority 3: Nice to Have

### 8. packages/mcp-server (33%)
- `formatters.ts` is untested -- output formatting for MCP tool responses

### 9. packages/sandbox (33%)
- Only types untested; core executor is tested

### 10. packages/test-utils (0%)
- Test infrastructure itself has no smoke tests
- Consider basic tests to verify mock factories produce valid shapes

### 11. packages/db repositories
- `settings.ts` and `workspaces.ts` repositories are untested

---

## Recommendations Summary

### Quick Wins (high value, moderate effort)
1. **Add orchestrator tests** -- mock LLM responses and verify tool loop behavior
2. **Add dispatcher tests** -- verify task ordering and approval gates
3. **Add LLM provider tests** -- mock HTTP responses and verify request/response mapping
4. **Add queue worker tests** -- mock BullMQ and verify job handler dispatch

### Medium-Term (high value, higher effort)
5. **Add tests for the 5 most critical untested routes** (agents, approvals, conversations, milestones, tasks)
6. **Add specialist agent tests** -- verify system prompts and tool configurations
7. **Add Discord bot command tests** -- mock interactions and verify API calls
8. **Test remaining 10 untested services**

### Coverage Infrastructure Improvements
9. **Raise coverage thresholds** -- current thresholds (60/52/50/60) are quite low; target 70/65/60/70 after filling gaps
10. **Add coverage to CI** -- fail the build if coverage drops below thresholds
11. **Add per-workspace coverage reporting** -- identify which packages are dragging down overall numbers
12. **Tag integration vs unit tests** -- ensure `npm run test` only runs fast unit tests; integration tests run separately
