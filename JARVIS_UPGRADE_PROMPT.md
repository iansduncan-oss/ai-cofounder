# JARVIS Upgrade — Next Session Prompt

Copy-paste the section below as your prompt:

---

## Upgrade JARVIS — Next Phase

Continue upgrading the AI Cofounder's JARVIS mode. The project is at `~/Projects/ai-cofounder` (Turborepo monorepo). Check MEMORY.md and backlog.md in `~/.claude/projects/-Users-ianduncan/memory/` for full context.

### What's Already Done
- Queue system (BullMQ + Redis, 5 queues, recurring jobs)
- Proactive monitoring (GitHub CI/PRs, VPS health, alerts)
- HUD dashboard (8 metric cards, detail panels, data panels, briefing display)
- LLM-powered narrative briefings
- Autonomous pipelines (PipelineExecutor with stage grouping + REST API)
- Persona system (DB table, CRUD API, dashboard page, TTS voice binding)
- Voice UI (SSE streaming, ElevenLabs TTS with persona voice override)
- 558 agent-server tests + 73 dashboard tests, all passing

### What to Build Next (in priority order)

**1. Pipeline Dashboard UI**
The pipeline backend is done (`POST /api/pipelines`, `POST /api/pipelines/goal/:goalId`). Build a `/dashboard/pipelines` page showing:
- List of pipeline runs with status (pending/running/completed/failed)
- Stage-by-stage progress visualization
- Ability to trigger a new pipeline from a goal
- Add ApiClient methods for pipeline endpoints, query keys, hooks

**2. Enhanced Briefings with TTS Audio**
- Add a "Play Briefing" button on the HUD that calls `/voice/tts` with the briefing text
- Audio player component with play/pause/progress
- Option to auto-play morning briefing when HUD loads

**3. Anticipatory Suggestions**
- Background job that analyzes user patterns (working hours, deploy frequency, common tasks)
- Proactive suggestions surfaced on HUD: "You usually deploy on Fridays — want me to run tests?"
- `suggestions` DB table with type, message, confidence, dismissed flag
- Dismissible suggestion cards on HUD

**4. RAG Pipeline for Memory**
- Ingest all conversation messages into pgvector embeddings (768-dim, Gemini text-embedding-004)
- `recall_memories` tool already uses vector search — extend to search conversation history too
- Background job to embed new messages periodically
- Memory search endpoint that combines semantic memory + conversation history

**5. Conversation Continuity**
- Auto-summarize conversations on completion (use conversation_summaries table that exists but is unused)
- Orchestrator loads recent conversation summaries as context
- "Last time we discussed X" capability in system prompt

### Guidelines
- Follow existing patterns (see CLAUDE.md for test mocking, route registration, etc.)
- Build `@ai-cofounder/db` before adding new route files
- Run tests after each feature (`npm run test -w @ai-cofounder/agent-server`)
- Build dashboard to verify (`npm run build -w @ai-cofounder/dashboard`)
- Keep all existing tests passing

Start with Task 1 (Pipeline Dashboard UI) and work through the list. Ask me if you need decisions on approach.
