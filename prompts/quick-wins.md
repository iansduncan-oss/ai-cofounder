# Quick Wins Implementation Prompt

Implement all 10 quick wins for the AI Cofounder monorepo at `~/Projects/ai-cofounder`. Each is a small, self-contained change. Build and test after all changes. Commit when done.

## 1. deleteFile / deleteDirectory workspace tools

**Files:** `apps/agent-server/src/services/workspace.ts`, `apps/agent-server/src/agents/tools/`, `apps/agent-server/src/agents/orchestrator.ts`

Add `deleteFile(path)` and `deleteDirectory(path)` methods to `WorkspaceService`. Both must use `resolveSafe()` for path traversal protection. `deleteDirectory` should require the directory to be empty (no recursive delete by default — add an optional `force` boolean). Add corresponding `LlmTool` definitions (`delete_file`, `delete_directory`) and wire them into the orchestrator's `executeTool()` switch. Add tests.

## 2. Populate size field in listDirectory

**Files:** `apps/agent-server/src/services/workspace.ts`

The `listDirectory` method returns entries with `size?: number` but doesn't populate it. Use `fs.stat()` to get file sizes in bytes. For directories, set size to `undefined` or omit. Update existing tests if any assert on the shape.

## 3. Optional depth param for git_clone

**Files:** `apps/agent-server/src/services/workspace.ts`, `apps/agent-server/src/agents/tools/`

Add an optional `depth` parameter to the `git_clone` tool definition and workspace service. When provided, pass `--depth <N>` to the git clone command for shallow clones. Update the tool's input schema to include `depth?: number`.

## 4. GET /api/workspace/usage endpoint

**Files:** `apps/agent-server/src/routes/` (new or existing workspace route file)

Add a `GET /api/workspace/usage` endpoint that returns disk usage of the workspace directory. Use `du -sh` or Node's `fs` to calculate total size. Return `{ path: string, totalBytes: number, totalHuman: string }`. Register in server.ts if needed.

## 5. Conversation export as JSON

**Files:** `apps/agent-server/src/routes/` (conversations route), `packages/api-client/src/client.ts`

Add `GET /api/conversations/:id/export` that returns the full conversation as a JSON download. Include: conversation metadata, all messages (ordered by createdAt), associated goals, and any decisions. Set `Content-Disposition: attachment; filename=conversation-<id>.json`. Add `exportConversation(id)` method to ApiClient.

## 6. Sandbox dependency support

**Files:** `packages/sandbox/src/`

Add optional `dependencies` parameter to code execution. For Python: run `pip install <deps>` before executing code. For JS/TS: run `npm install <deps>` before executing. Dependencies should be an array of strings. Add a reasonable timeout (30s for install). Update the orchestrator's `execute_code` tool schema to accept `dependencies?: string[]`.

## 7. Sandbox result caching

**Files:** `packages/sandbox/src/`

Add an in-memory LRU cache (Map with max size ~100 entries) keyed by `sha256(language + code + dependencies)`. Before executing, check cache. If hit and not expired (TTL: 5 minutes), return cached result. Store `{ stdout, stderr, exitCode, durationMs, cachedAt }`. Add a `cached: boolean` field to the execution result.

## 8. OpenAPI spec from Fastify schemas

**Files:** `apps/agent-server/src/server.ts`, `apps/agent-server/package.json`

Install `@fastify/swagger` and `@fastify/swagger-ui`. Register the plugins in `buildServer()`. Configure with title "AI Cofounder API", version from package.json. Serve Swagger UI at `/docs`. All routes that already have `schema` definitions will auto-document. Add `@fastify/swagger` and `@fastify/swagger-ui` to agent-server's dependencies.

## 9. Bot health check endpoints

**Files:** `apps/discord-bot/src/`, `apps/slack-bot/src/`

Add a simple HTTP health check server in each bot (port 3101 for discord, 3102 for slack). Each serves `GET /health` returning `{ status: "ok", bot: "discord"|"slack", uptime: process.uptime(), connected: boolean }`. The `connected` boolean reflects whether the bot is currently connected to its platform. Use Node's built-in `http.createServer` — no framework needed.

## 10. GET /api/agents/roles endpoint

**Files:** `apps/agent-server/src/routes/` (agents route)

Add `GET /api/agents/roles` that returns the list of available agent roles with descriptions:
```json
[
  { "role": "orchestrator", "description": "Main coordinator — plans, delegates, executes tools" },
  { "role": "researcher", "description": "Web search, information gathering, memory recall" },
  { "role": "coder", "description": "Code generation with self-review" },
  { "role": "reviewer", "description": "Code review and quality checks" },
  { "role": "planner", "description": "Task decomposition and planning" },
  { "role": "debugger", "description": "Error analysis, log tracing, fix proposals" },
  { "role": "doc_writer", "description": "Documentation generation" },
  { "role": "verifier", "description": "Goal completion verification" }
]
```

---

## After all changes

1. `npm run build` — verify no type errors
2. `npm run test` — verify all tests pass (existing + new)
3. Commit with message: `feat: implement 10 quick wins — workspace tools, sandbox caching, OpenAPI docs, bot health checks`
