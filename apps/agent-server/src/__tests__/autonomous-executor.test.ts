import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// --- DB mocks ---
const mockGetGoal = vi.fn().mockResolvedValue({ id: "goal-abc12345", title: "Add user authentication" });
const mockGetCostByGoal = vi.fn().mockResolvedValue({
  totalCostUsd: 0.025,
  totalInputTokens: 5000,
  totalOutputTokens: 2000,
  requestCount: 10,
});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getGoal: (...args: unknown[]) => mockGetGoal(...args),
  getCostByGoal: (...args: unknown[]) => mockGetCostByGoal(...args),
}));

// --- LLM mock ---
const mockComplete = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "## Summary\nAdded JWT-based authentication." }],
  model: "claude-3-5-sonnet",
  stop_reason: "end_turn",
  usage: { inputTokens: 100, outputTokens: 80 },
  provider: "anthropic",
});

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry };
});

// --- Shared mock ---
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// --- GitHub tools mock ---
const mockExecuteCreatePr = vi.fn().mockResolvedValue({
  number: 42,
  html_url: "https://github.com/org/repo/pull/42",
  title: "Add user authentication",
  state: "open",
});

vi.mock("../agents/tools/github-tools.js", () => ({
  executeCreatePr: (...args: unknown[]) => mockExecuteCreatePr(...args),
}));

// --- Dynamic imports after mocks ---
const { buildConventionalCommit, AutonomousExecutorService } = await import("../services/autonomous-executor.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults after clearAllMocks
  mockGetGoal.mockResolvedValue({ id: "goal-abc12345", title: "Add user authentication" });
  mockGetCostByGoal.mockResolvedValue({
    totalCostUsd: 0.025,
    totalInputTokens: 5000,
    totalOutputTokens: 2000,
    requestCount: 10,
  });
  mockComplete.mockResolvedValue({
    content: [{ type: "text", text: "## Summary\nAdded JWT-based authentication." }],
    model: "claude-3-5-sonnet",
    stop_reason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 80 },
    provider: "anthropic",
  });
  mockExecuteCreatePr.mockResolvedValue({
    number: 42,
    html_url: "https://github.com/org/repo/pull/42",
    title: "Add user authentication",
    state: "open",
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   buildConventionalCommit (TERM-03)
   ───────────────────────────────────────────────────────────────────────── */

describe("buildConventionalCommit", () => {
  it("formats basic commit with goalId ref", () => {
    const msg = buildConventionalCommit({
      type: "feat",
      description: "add login endpoint",
      goalId: "abc12345-1111-2222-3333-444455556666",
    });
    expect(msg).toBe("feat: add login endpoint [goal:abc12345]");
  });

  it("formats commit with scope", () => {
    const msg = buildConventionalCommit({
      type: "fix",
      scope: "auth",
      description: "fix token expiry",
      goalId: "abc12345-1111-2222-3333-444455556666",
    });
    expect(msg).toBe("fix(auth): fix token expiry [goal:abc12345]");
  });

  it("formats commit with taskId ref", () => {
    const msg = buildConventionalCommit({
      type: "feat",
      description: "implement route",
      goalId: "aaaa1111-bbbb-cccc-dddd-eeeeffffffff",
      taskId: "11223344-5566-7788-99aa-bbccddee0011",
    });
    expect(msg).toBe("feat: implement route [goal:aaaa1111 task:11223344]");
  });

  it("truncates description to fit 72-char limit", () => {
    const longDesc = "implement a very complex user authentication system with OAuth2 and session management support";
    const msg = buildConventionalCommit({
      type: "feat",
      description: longDesc,
      goalId: "abc12345-0000-0000-0000-000000000000",
    });
    expect(msg.length).toBeLessThanOrEqual(72);
    expect(msg).toContain("[goal:abc12345]");
    expect(msg).toContain("...");
  });

  it("handles edge case: very long scope + description", () => {
    const msg = buildConventionalCommit({
      type: "refactor",
      scope: "auth-module",
      description: "restructure the entire authentication module for better maintainability and testability",
      goalId: "abc12345-0000-0000-0000-000000000000",
    });
    expect(msg.length).toBeLessThanOrEqual(72);
    expect(msg).toContain("[goal:abc12345]");
  });

  it("does not truncate short descriptions", () => {
    const msg = buildConventionalCommit({
      type: "chore",
      description: "update deps",
      goalId: "xyz98765-0000-0000-0000-000000000000",
    });
    expect(msg).toBe("chore: update deps [goal:xyz98765]");
    expect(msg.length).toBeLessThanOrEqual(72);
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   AutonomousExecutorService.executeGoal (TERM-02)
   ───────────────────────────────────────────────────────────────────────── */

describe("AutonomousExecutorService.executeGoal", () => {
  const sampleProgress = {
    goalId: "goal-abc12345",
    goalTitle: "Add user authentication",
    status: "completed",
    totalTasks: 2,
    completedTasks: 2,
    tasks: [
      { id: "task-1", title: "Create auth route", agent: "coder", status: "completed", output: "Route created" },
      { id: "task-2", title: "Write tests", agent: "coder", status: "completed", output: "Tests written" },
    ],
  };

  function createMockDispatcher(progress = sampleProgress) {
    return {
      runGoal: vi.fn().mockImplementation(async (_goalId: string, _userId: string | undefined, onProgress?: Function) => {
        // Simulate progress events
        if (onProgress) {
          await onProgress({
            goalId: "goal-abc12345",
            goalTitle: "Add user authentication",
            taskId: "task-1",
            taskTitle: "Create auth route",
            agent: "coder",
            status: "started" as const,
            completedTasks: 0,
            totalTasks: 2,
          });
          await onProgress({
            goalId: "goal-abc12345",
            goalTitle: "Add user authentication",
            taskId: "task-1",
            taskTitle: "Create auth route",
            agent: "coder",
            status: "completed" as const,
            completedTasks: 1,
            totalTasks: 2,
            output: "Route created",
          });
        }
        return progress;
      }),
    };
  }

  function createMockWorkspaceService(statusOutput = " M src/auth.ts") {
    return {
      gitCheckout: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      gitStatus: vi.fn().mockResolvedValue({ stdout: statusOutput, stderr: "", exitCode: 0 }),
      gitAdd: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      gitCommit: vi.fn().mockResolvedValue({ stdout: "[main abc1234] feat: ...", stderr: "", exitCode: 0 }),
      gitPush: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    };
  }

  it("chains runGoal -> gitCheckout -> gitAdd -> gitCommit when workspace provided", async () => {
    const dispatcher = createMockDispatcher();
    const workspaceService = createMockWorkspaceService();
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, workspaceService as any, db, registry);
    const result = await executor.executeGoal({
      goalId: "goal-abc12345",
      userId: "user-1",
      workSessionId: "ws-1",
      repoDir: "my-repo",
    });

    expect(dispatcher.runGoal).toHaveBeenCalledWith("goal-abc12345", "user-1", expect.any(Function));
    expect(workspaceService.gitCheckout).toHaveBeenCalledWith("my-repo", "autonomous/goal-abc", true);
    expect(workspaceService.gitAdd).toHaveBeenCalledWith("my-repo", ["."]);
    expect(workspaceService.gitCommit).toHaveBeenCalledWith("my-repo", expect.stringContaining("[goal:goal-abc]"));
    expect(result.progress.status).toBe("completed");
    expect(result.actions).toBeDefined();
  });

  it("skips git ops when workspace not provided", async () => {
    const dispatcher = createMockDispatcher();
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    const result = await executor.executeGoal({
      goalId: "goal-abc12345",
      userId: "user-1",
      workSessionId: "ws-1",
    });

    expect(dispatcher.runGoal).toHaveBeenCalled();
    // No git operations should appear in actions
    const gitActions = result.actions.filter((a) => a.type !== "task_progress");
    expect(gitActions).toHaveLength(0);
  });

  it("skips commit when gitStatus returns empty (clean working tree)", async () => {
    const dispatcher = createMockDispatcher();
    const workspaceService = createMockWorkspaceService(""); // empty = clean
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, workspaceService as any, db, registry);
    await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
      repoDir: "my-repo",
    });

    expect(workspaceService.gitAdd).not.toHaveBeenCalled();
    expect(workspaceService.gitCommit).not.toHaveBeenCalled();
  });

  it("calls onProgress callback for each task event", async () => {
    const dispatcher = createMockDispatcher();
    const registry = new LlmRegistry();
    const db = {} as any;
    const onProgress = vi.fn();

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "started" }));
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ status: "completed" }));
  });

  it("skips git ops when goal status is not completed", async () => {
    const incompleteProgress = { ...sampleProgress, status: "failed" };
    const dispatcher = createMockDispatcher(incompleteProgress);
    const workspaceService = createMockWorkspaceService();
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, workspaceService as any, db, registry);
    await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
      repoDir: "my-repo",
    });

    // Branch should still be created, but no commit/push
    expect(workspaceService.gitAdd).not.toHaveBeenCalled();
    expect(workspaceService.gitCommit).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   generatePrDescription (TERM-04)
   ───────────────────────────────────────────────────────────────────────── */

describe("generatePrDescription", () => {
  const sampleProgress = {
    goalId: "goal-abc12345",
    goalTitle: "Add user authentication",
    status: "completed",
    totalTasks: 2,
    completedTasks: 2,
    tasks: [
      { id: "task-1", title: "Create auth route", agent: "coder", status: "completed", output: "Route created" },
      { id: "task-2", title: "Write tests", agent: "coder", status: "completed", output: "Tests written" },
    ],
  };

  it("calls registry.complete with goal title and task summaries", async () => {
    const dispatcher = { runGoal: vi.fn() };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    await executor.generatePrDescription("Add user authentication", sampleProgress as any);

    expect(mockComplete).toHaveBeenCalledWith(
      "conversation",
      expect.objectContaining({
        system: expect.stringContaining("PR description"),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Add user authentication"),
          }),
        ]),
      }),
    );
  });

  it("returns markdown with Autonomously generated footer", async () => {
    const dispatcher = { runGoal: vi.fn() };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    const result = await executor.generatePrDescription("Add user authentication", sampleProgress as any);

    expect(result).toContain("## Summary");
    expect(result).toContain("*Autonomously generated by AI Cofounder*");
  });

  it("includes completed task titles in the LLM prompt", async () => {
    const dispatcher = { runGoal: vi.fn() };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    await executor.generatePrDescription("Add user authentication", sampleProgress as any);

    const callArgs = mockComplete.mock.calls[0];
    const userMessage = callArgs[1].messages[0].content as string;
    expect(userMessage).toContain("Create auth route");
    expect(userMessage).toContain("Write tests");
  });
});

/* ─────────────────────────────────────────────────────────────────────────
   Work log structure (TERM-05)
   ───────────────────────────────────────────────────────────────────────── */

describe("Work log structure (TERM-05)", () => {
  const sampleProgress = {
    goalId: "goal-abc12345",
    goalTitle: "Add user authentication",
    status: "completed",
    totalTasks: 1,
    completedTasks: 1,
    tasks: [{ id: "task-1", title: "Create auth route", agent: "coder", status: "completed", output: "Route created" }],
  };

  it("actions array contains typed entries for each git operation", async () => {
    const dispatcher = {
      runGoal: vi.fn().mockResolvedValue(sampleProgress),
    };
    const workspaceService = {
      gitCheckout: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      gitStatus: vi.fn().mockResolvedValue({ stdout: " M src/auth.ts", stderr: "", exitCode: 0 }),
      gitAdd: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
      gitCommit: vi.fn().mockResolvedValue({ stdout: "[main abc1234] feat: ...", stderr: "", exitCode: 0 }),
    };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, workspaceService as any, db, registry);
    const result = await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
      repoDir: "my-repo",
    });

    const actionTypes = result.actions.map((a) => a.type);
    expect(actionTypes).toContain("git_branch");
    expect(actionTypes).toContain("git_add");
    expect(actionTypes).toContain("git_commit");

    // All actions must have timestamps
    result.actions.forEach((action) => {
      expect(action.timestamp).toBeGreaterThan(0);
      expect(typeof action.type).toBe("string");
    });
  });

  it("costSummary is populated when getCostByGoal returns data", async () => {
    const dispatcher = {
      runGoal: vi.fn().mockResolvedValue(sampleProgress),
    };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    const result = await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
    });

    expect(result.costSummary).toBeDefined();
    expect(result.costSummary?.totalCostUsd).toBe(0.025);
    expect(result.costSummary?.totalInputTokens).toBe(5000);
    expect(result.costSummary?.requestCount).toBe(10);
  });

  it("task_progress actions include taskId, taskTitle, agent, and status", async () => {
    const onProgress = vi.fn().mockImplementation(async (event: unknown) => {
      // Forward event to simulate real progress
      void event;
    });
    const dispatcher = {
      runGoal: vi.fn().mockImplementation(async (_goalId: string, _userId: string | undefined, cb?: Function) => {
        if (cb) {
          await cb({
            goalId: "goal-abc12345",
            goalTitle: "Add user authentication",
            taskId: "task-1",
            taskTitle: "Create auth route",
            agent: "coder",
            status: "started" as const,
            completedTasks: 0,
            totalTasks: 1,
          });
        }
        return sampleProgress;
      }),
    };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    const result = await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
      onProgress,
    });

    const progressActions = result.actions.filter((a) => a.type === "task_progress");
    expect(progressActions.length).toBeGreaterThan(0);
    expect(progressActions[0].taskId).toBe("task-1");
    expect(progressActions[0].taskTitle).toBe("Create auth route");
    expect(progressActions[0].agent).toBe("coder");
    expect(progressActions[0].status).toBe("started");
  });

  it("output in task_progress actions is truncated to 500 chars", async () => {
    const longOutput = "x".repeat(600);
    const dispatcher = {
      runGoal: vi.fn().mockImplementation(async (_goalId: string, _userId: string | undefined, cb?: Function) => {
        if (cb) {
          await cb({
            goalId: "goal-abc12345",
            goalTitle: "Add user authentication",
            taskId: "task-1",
            taskTitle: "Create auth route",
            agent: "coder",
            status: "completed" as const,
            completedTasks: 1,
            totalTasks: 1,
            output: longOutput,
          });
        }
        return sampleProgress;
      }),
    };
    const registry = new LlmRegistry();
    const db = {} as any;

    const executor = new AutonomousExecutorService(dispatcher as any, undefined, db, registry);
    const result = await executor.executeGoal({
      goalId: "goal-abc12345",
      workSessionId: "ws-1",
    });

    const progressActions = result.actions.filter((a) => a.type === "task_progress");
    expect(progressActions[0].output?.length).toBeLessThanOrEqual(500);
  });
});
