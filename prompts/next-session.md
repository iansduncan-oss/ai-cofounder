# AI Cofounder — Next Session Prompt

Copy and paste this to start the next session:

---

Continue work on the AI Cofounder project at `~/Projects/ai-cofounder`.

## Context

Session 4 (observability) completed. Working tree is clean. All 11 packages pass (859 tests total).

**What was done this session:**
- Applied `provider_health` and `tool_executions` DB tables via `db:push`
- Wired `recordToolExecution()` in orchestrator's `executeTool()` — fires async alongside Prometheus `recordToolMetrics()`, non-fatal on error
- Threaded `requestId` from Fastify request tracing middleware → `orchestrator.run()`/`runStream()` → `executeTool()` → `recordToolExecution()` for end-to-end correlation
- Fixed 13 test failures by adding `recordToolExecution` and `touchMemory` mocks to `orchestrator.test.ts`
- Added observability mocks (`upsertProviderHealth`, `getProviderHealthRecords`, `recordToolExecution`, `getToolStats`) to `packages/test-utils/src/mocks/db.ts`

**Unpushed:** Multiple commits on main ahead of origin. Push when ready — CI will auto-deploy.

**Test counts:** agent-server 479 (31 files), db 123, llm 94, bot-handlers 48, api-client 36, slack-bot 34, discord-bot 27, sandbox 12, shared 6 — 859 total.

## Tasks (in priority order)

### 1. Push to remote and deploy
Push commits to origin/main. CI auto-deploys on green tests. Verify deploy succeeds.

### 2. Scheduler daemon
Background loop to auto-execute due schedules. Infrastructure exists (`services/scheduler.ts`, `listDueSchedules()`, schedule CRUD) but no runner is wired up. Wire a `setInterval` in server startup that checks `listDueSchedules()` and executes them via the orchestrator.

### 3. Daily briefing
Scheduled morning summary: in-flight goals, blocked tasks, yesterday's activity, costs. `services/briefing.ts` and routes exist. Wire into scheduler so it runs at `BRIEFING_HOUR` (env var).

### 4. Dashboard polish
The dashboard builds but has TypeScript errors (`apps/dashboard/src/routes/memories.tsx` — property access on `{}`). Fix type errors, verify pages render. Zero test coverage — consider adding key component tests.

### 5. Proactive notifications improvements
Extend `services/notifications.ts` with richer Slack Block Kit formatting for goal completions, Discord webhook notifications via `DISCORD_FOLLOWUP_WEBHOOK_URL`.

## Key patterns
- Tests mock `@ai-cofounder/db`, `@ai-cofounder/llm`, `@ai-cofounder/shared` before dynamic imports
- MockLlmRegistry must include `getProviderHealth = vi.fn().mockReturnValue([])`
- Build deps first when adding new files: `npm run build -w @ai-cofounder/db`
- `optionalEnv()` requires 2 args (name, defaultValue)
- Commit messages follow conventional commits (feat/fix/test/refactor)
- Docker must be running for `db:push` — use `open -a "Docker Desktop"` then poll `docker ps`
