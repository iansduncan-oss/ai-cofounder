# Next Session: Backend Feature Work

## Context

Session 54 completed all frontend quick wins — 8 commits adding 6 new pages, goal analytics, search, pipeline builder, and dashboard enhancements. The remaining roadmap items all require backend work. Pick based on what's unblocked.

## Pre-work

1. Read `.claude/primer.md` for full session 54 context
2. Check if Anthropic API credits have been topped up (`npm run test -w @ai-cofounder/llm` or check provider health)
3. Read `.claude/git-state.md` for repo state

## Items (priority order)

### 1. Voice UI Integration (no API credits needed)

**Goal:** Embed voice UI into the dashboard with shared conversation history.

**Current state:** `apps/voice-ui/public/` is a standalone static HTML/JS app served at `/voice/`. It uses Web Speech API + ElevenLabs TTS but has no shared conversation history, no persona context, and no auth.

**What to build:**
- New dashboard route `/dashboard/voice` with embedded voice interface
- Use the existing `streamChat` ApiClient method for conversation
- Share conversation ID with main chat so voice and text conversations are unified
- Voice-to-text via Web Speech API, text-to-speech via ElevenLabs (existing `POST /api/voice/stream` endpoint)
- Persona selector (existing `usePersonas()` hook + personas API)
- Waveform/pulse animation for listening/speaking states

**Key files:**
- `apps/voice-ui/public/app.js` — existing voice logic to port
- `apps/agent-server/src/routes/voice.ts` — existing TTS endpoint
- `apps/dashboard/src/routes/chat.tsx` — existing chat page pattern
- `apps/dashboard/src/components/chat/voice-ring.tsx` — existing voice animation component

### 2. Adaptive Agent Routing (no API credits needed)

**Goal:** Route tasks to agents based on historical performance, not static mapping.

**Current state:** `packages/llm/src/registry.ts` routes by task category (planning→Gemini, code→Groq, etc.) with static fallback chains. `apps/agent-server/src/agents/dispatcher.ts` assigns tasks to specialists via static role matching.

**What to build:**
- `AdaptiveRoutingService` that queries `tool_executions` and `tasks` tables for per-agent success rates
- Weight agent selection by: historical success rate (70%), avg latency (15%), recent trend (15%)
- Fall back to static routing when insufficient data (<10 samples)
- Wire into dispatcher's agent assignment logic
- Expose routing decisions via new `GET /api/analytics/routing` endpoint
- Add "Routing" section to the agents dashboard page showing why each agent was chosen

**Key files:**
- `apps/agent-server/src/agents/dispatcher.ts` — task assignment logic
- `packages/db/src/repositories.ts` — existing `getToolStats()`, `getGoalAnalytics()` for data
- `apps/agent-server/src/services/` — new service location

### 3. Extended Thinking (NEEDS Anthropic credits)

**Goal:** Dynamic reasoning depth based on task complexity.

**Current state:** Orchestrator has 5-round max, specialists have 3-round max. No complexity assessment. `packages/llm/src/providers/anthropic.ts` already supports `request.thinking` parameter with `budget_tokens`.

**What to build:**
- `ComplexityEstimator` that scores incoming tasks (0-1) based on: goal description length, number of subtasks, tool count, prior failure rate
- Map complexity to round budget: low (3 rounds), medium (5), high (8), critical (12)
- Map complexity to thinking token budget: low (0), medium (4096), high (8192), critical (16384)
- Wire into orchestrator constructor and specialist base class
- Log complexity scores to `thinking_traces` table for visibility
- Show complexity score in the existing thinking traces dashboard page

**Key files:**
- `apps/agent-server/src/agents/orchestrator.ts` — round limit config
- `apps/agent-server/src/agents/specialists/base.ts` — specialist round limit
- `packages/llm/src/providers/anthropic.ts` — thinking parameter support

### 4. Multi-User RBAC (largest scope, no API credits needed)

**Goal:** Role-based access control for team use.

**Current state:** Single admin via `adminUsers` table + JWT. Users exist per-platform but no roles/permissions. All queries unscoped.

**What to build (phased):**

**Phase A — Schema + middleware:**
- Add `roles` enum (admin, editor, viewer) to `adminUsers` table
- Add RBAC middleware that checks role on each route
- Scope goal/conversation/memory queries by userId

**Phase B — Invite flow:**
- `POST /api/auth/invite` — admin creates invite link
- `POST /api/auth/register` — user registers via invite
- Dashboard invite management UI

**Phase C — Per-user integrations:**
- `userGoogleTokens` table (linked to users, not adminUsers)
- Per-user Google Calendar/Gmail authorization
- Scoped briefings and meeting prep

**Key files:**
- `packages/db/src/schema.ts` — adminUsers, users tables
- `apps/agent-server/src/plugins/auth.ts` — JWT + auth logic
- `apps/agent-server/src/routes/*.ts` — all routes need scope filtering

## Execution Strategy

Enter plan mode for whichever item you pick. Read the key files listed above before planning. Items 1-2 are independent and could be parallelized across sessions. Item 3 is blocked on Anthropic credits. Item 4 is the largest but highest long-term value.
