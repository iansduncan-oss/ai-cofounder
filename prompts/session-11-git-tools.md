# Session 11: Git Branch Tools + create_pr + run_tests

## Context

The AI Cofounder agent system has workspace and git integration via `WorkspaceService` (`apps/agent-server/src/services/workspace.ts`) with 10 LLM tools. The orchestrator can clone repos, read/write files, and do basic git ops (status, diff, add, commit, pull, log). But it **cannot** create branches, switch branches, or open PRs — so it's stuck on a single branch and can't complete the development workflow end-to-end.

The sandbox package (`packages/sandbox`) already supports executing code in Docker containers (TS, JS, Python, Bash). The `CoderAgent` uses it. But there's no dedicated `run_tests` tool the orchestrator can invoke directly.

**Goal**: Add `git_checkout`, `git_branch`, `create_pr` tools to the orchestrator, and a `run_tests` tool that executes test commands in the sandbox. This completes the autonomous dev loop: branch → code → test → commit → PR.

## Implementation Plan

### 1. Add `git_branch` and `git_checkout` to WorkspaceService

**File**: `apps/agent-server/src/services/workspace.ts`

Add two new methods:

```
async gitBranch(repoPath: string, branchName: string): Promise<string>
  // Creates a new branch: git branch <branchName>
  // Returns stdout

async gitCheckout(repoPath: string, branchName: string, create?: boolean): Promise<string>
  // Switches branch: git checkout <branchName>
  // If create=true: git checkout -b <branchName>
  // Returns stdout
```

Both must use `resolveSafe()` for path traversal protection, same as existing git methods.

### 2. Add `create_pr` tool via GitHub API

**File**: `apps/agent-server/src/agents/tools/github-tools.ts` (new file)

Export:
- `CREATE_PR_TOOL: LlmTool` — schema with inputs: `repoPath`, `title`, `body`, `base` (default "main"), `head` (branch name)
- `executeCreatePr(workspaceService, input)` — implementation that:
  1. Pushes the branch first: `git push -u origin <head>` via WorkspaceService
  2. Calls GitHub API `POST /repos/{owner}/{repo}/pulls` using `GITHUB_TOKEN` env var
  3. Extracts owner/repo from the git remote URL (parse `origin` remote)
  4. Returns `{ url, number, title }` on success

Add `gitPush` to WorkspaceService:
```
async gitPush(repoPath: string, remote?: string, branch?: string, setUpstream?: boolean): Promise<string>
```

The `GITHUB_TOKEN` env var already exists in `.env.example`. Use `optionalEnv("GITHUB_TOKEN", "")` — if not set, the tool should return an error message (not crash).

### 3. Add `run_tests` tool

**File**: `apps/agent-server/src/agents/tools/test-tools.ts` (new file)

Export:
- `RUN_TESTS_TOOL: LlmTool` — schema with inputs: `repoPath`, `command` (e.g. "npm test"), `timeout` (default 60000)
- `executeRunTests(sandboxService, workspaceService, input)` — implementation that:
  1. Reads the test command (default: `npm test`)
  2. Executes via sandbox service in a bash container with the repo mounted
  3. Returns `{ exitCode, stdout, stderr, timedOut }` — truncated to 3000 chars each

### 4. Register tools in Orchestrator

**File**: `apps/agent-server/src/agents/orchestrator.ts`

- Import the new tool constants and execute functions
- Add `GIT_BRANCH_TOOL`, `GIT_CHECKOUT_TOOL` to the workspace tools section (conditional on workspaceService)
- Add `CREATE_PR_TOOL` to workspace tools section (conditional on workspaceService + GITHUB_TOKEN being set)
- Add `RUN_TESTS_TOOL` (conditional on sandboxService + workspaceService)
- Add cases in `executeTool()` switch statement

### 5. Tests

**File**: `apps/agent-server/src/__tests__/workspace.test.ts` (existing)
- Add tests for `gitBranch`, `gitCheckout`, `gitPush`

**File**: `apps/agent-server/src/__tests__/github-tools.test.ts` (new)
- Test `executeCreatePr` with mocked fetch + workspace service
- Test remote URL parsing (HTTPS and SSH formats)
- Test error when GITHUB_TOKEN not set
- Test push failure handling

**File**: `apps/agent-server/src/__tests__/test-tools.test.ts` (new)
- Test `executeRunTests` with mocked sandbox service
- Test timeout handling
- Test output truncation

## Files Modified/Created

| File | Change |
|------|--------|
| `apps/agent-server/src/services/workspace.ts` | Add gitBranch, gitCheckout, gitPush methods |
| `apps/agent-server/src/agents/tools/github-tools.ts` | NEW — CREATE_PR_TOOL + executeCreatePr |
| `apps/agent-server/src/agents/tools/test-tools.ts` | NEW — RUN_TESTS_TOOL + executeRunTests |
| `apps/agent-server/src/agents/orchestrator.ts` | Register new tools + switch cases |
| `apps/agent-server/src/__tests__/workspace.test.ts` | Add git branch/checkout/push tests |
| `apps/agent-server/src/__tests__/github-tools.test.ts` | NEW — PR creation tests |
| `apps/agent-server/src/__tests__/test-tools.test.ts` | NEW — test runner tests |

## What's NOT changing

- Existing git tools (clone, status, diff, add, commit, pull, log) — untouched
- Sandbox package internals — just using its public API
- Discord/Slack bots — no new commands needed
- REST routes — orchestrator tools are accessed via the agent chat, not REST

## Verification

1. `npm run build` — passes
2. `npm run test -w @ai-cofounder/agent-server` — all tests pass
3. Manual: clone a repo, create branch, make changes, commit, push, create PR
4. Manual: run tests in a workspace repo via the orchestrator

## Important Patterns

- WorkspaceService uses `resolveSafe()` for ALL path inputs — never skip this
- LLM tools follow the pattern: export a constant `LlmTool` + an `execute*` function
- Orchestrator registers tools conditionally based on available services
- Tests mock `@ai-cofounder/db`, `@ai-cofounder/llm`, and `@ai-cofounder/shared` — see CLAUDE.md for the exact mock pattern
- `optionalEnv()` always requires 2 args (name, defaultValue)
- When adding new files, build `@ai-cofounder/db` first if imports reference it
