# Claude Code Integration Follow-ups

Complete the remaining Claude Code DX improvements for the ai-cofounder project.

## 1. Add missing auto-build hook

Edit `/Users/ianduncan/Projects/ai-cofounder/.claude/settings.local.json` — add a PostToolUse hook for `packages/mcp-server` (same pattern as the other auto-build hooks).

## 2. Expand workspace permissions

In the same `settings.local.json`, add commonly-approved commands to the `permissions.allow` array:
- `Bash(npm run dev 2>&1)`
- `Bash(npm run lint 2>&1)`
- `Bash(npm run build -w @ai-cofounder/* 2>&1)` (or individual workspace builds if wildcards aren't supported)
- `Bash(npm run db:generate 2>&1)`
- `Bash(npm run db:migrate 2>&1)`
- `Bash(npm run db:studio 2>&1)`

## 3. Create custom subagent for endpoint scaffolding

Create `.claude/agents/scaffold-endpoint.md` — a subagent that scaffolds a new API endpoint. Given an endpoint name and description, it should:
1. Create the route file in `apps/agent-server/src/routes/`
2. Create a test file in `apps/agent-server/src/__tests__/`
3. If it needs a new orchestrator tool, create the tool definition in `apps/agent-server/src/agents/tools/`
4. Add the ApiClient method in `packages/api-client/src/client.ts`
5. Add the type in `packages/api-client/src/types.ts` and re-export from `index.ts`

Follow existing patterns in the codebase. Read 2-3 existing routes and their tests first to understand conventions.

## 4. Pre-commit type-check hook

Add a PreCommit hook to `.claude/settings.local.json` that runs `npx tsc --noEmit` in the project root to catch type errors before committing. Keep it fast — only check, don't build.

## 5. Update auto-memory

Update `/Users/ianduncan/.claude/projects/-Users-ianduncan/memory/MEMORY.md`:
- Add `packages/mcp-server` to Architecture section
- Update Claude Code Enhancements section: 5 MCP servers, 5 skills, 8 auto-build hooks (was 3)
- Add the scaffold-endpoint subagent to Key Files or a new section

## 6. Commit everything

Commit all changes from this session AND the previous session (skills, hooks, MCP server, CLAUDE.md, backlog, this prompt) with a descriptive message.
