import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({}),
}));

const mockComplete = vi.fn();

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
  return {
    LlmRegistry: MockLlmRegistry,
  };
});

vi.mock("../agents/tools/verification-tools.js", () => ({
  VERIFY_RESULT_TOOL: {
    name: "submit_verification",
    description: "submit verification",
    input_schema: {
      type: "object",
      properties: {
        verdict: { type: "string" },
        confidence: { type: "number" },
        summary: { type: "string" },
        checks: { type: "array", items: { type: "object" } },
        suggestions: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "confidence", "summary", "checks"],
    },
  },
}));

vi.mock("../agents/tools/filesystem-tools.js", () => ({
  READ_FILE_TOOL: {
    name: "read_file",
    description: "read file",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  LIST_DIRECTORY_TOOL: {
    name: "list_directory",
    description: "list dir",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
  },
}));

vi.mock("../agents/tools/git-tools.js", () => ({
  GIT_STATUS_TOOL: {
    name: "git_status",
    description: "git status",
    input_schema: { type: "object", properties: { repo_dir: { type: "string" } }, required: ["repo_dir"] },
  },
  GIT_LOG_TOOL: {
    name: "git_log",
    description: "git log",
    input_schema: { type: "object", properties: { repo_dir: { type: "string" } }, required: ["repo_dir"] },
  },
  GIT_DIFF_TOOL: {
    name: "git_diff",
    description: "git diff",
    input_schema: { type: "object", properties: { repo_dir: { type: "string" } }, required: ["repo_dir"] },
  },
}));

vi.mock("../agents/tools/workspace-tools.js", () => ({
  RUN_TESTS_TOOL: {
    name: "run_tests",
    description: "run tests",
    input_schema: { type: "object", properties: { repo_dir: { type: "string" } }, required: ["repo_dir"] },
  },
}));

const { VerifierAgent } = await import("../agents/specialists/verifier.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

function toolUseResponse(name: string, input: Record<string, unknown>) {
  return {
    content: [{ type: "tool_use", id: `tu-${name}`, name, input }],
    model: "test-model",
    stop_reason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 15 },
    provider: "test",
  };
}

const baseContext = {
  taskId: "verify-goal-1",
  taskTitle: "Verify goal: Build auth system",
  taskDescription: "Verify the deliverables for goal",
  goalTitle: "Build auth system",
  userId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("VerifierAgent", () => {
  it("has the correct role and taskCategory", () => {
    const agent = new VerifierAgent(new LlmRegistry());
    expect(agent.role).toBe("verifier");
    expect(agent.taskCategory).toBe("code");
  });

  it("always includes submit_verification tool", () => {
    const agent = new VerifierAgent(new LlmRegistry());
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("submit_verification");
  });

  it("does NOT include workspace tools without workspaceService", () => {
    const agent = new VerifierAgent(new LlmRegistry());
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).not.toContain("read_file");
    expect(names).not.toContain("list_directory");
    expect(names).not.toContain("git_status");
    expect(names).not.toContain("run_tests");
  });

  it("includes workspace tools when workspaceService is provided", () => {
    const mockWorkspace = {} as any;
    const agent = new VerifierAgent(new LlmRegistry(), undefined, mockWorkspace);
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("submit_verification");
    expect(names).toContain("read_file");
    expect(names).toContain("list_directory");
    expect(names).toContain("git_status");
    expect(names).toContain("git_log");
    expect(names).toContain("git_diff");
    expect(names).toContain("run_tests");
  });

  it("does NOT include write tools", () => {
    const mockWorkspace = {} as any;
    const agent = new VerifierAgent(new LlmRegistry(), undefined, mockWorkspace);
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).not.toContain("write_file");
    expect(names).not.toContain("git_add");
    expect(names).not.toContain("git_commit");
    expect(names).not.toContain("git_push");
  });

  it("executes and returns output", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("Verification complete: all checks passed"));

    const agent = new VerifierAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("Verification complete");
    expect(result.model).toBe("test-model");
    expect(result.provider).toBe("test");
  });

  it("stores lastVerification when submit_verification is called", async () => {
    const verdict = {
      verdict: "pass",
      confidence: 0.95,
      summary: "All tests pass",
      checks: [{ name: "tests_pass", passed: true }],
    };

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("submit_verification", verdict))
      .mockResolvedValueOnce(textResponse("Verification submitted"));

    const agent = new VerifierAgent(new LlmRegistry());
    await agent.execute(baseContext);

    expect(agent.lastVerification).toEqual(verdict);
  });

  it("handles read_file tool use", async () => {
    const mockWorkspace = {
      readFile: vi.fn().mockResolvedValue("const x = 1;"),
    } as any;

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("read_file", { path: "src/index.ts" }))
      .mockResolvedValueOnce(textResponse("Code looks correct"));

    const agent = new VerifierAgent(new LlmRegistry(), undefined, mockWorkspace);
    await agent.execute(baseContext);

    expect(mockWorkspace.readFile).toHaveBeenCalledWith("src/index.ts");
  });

  it("handles git_status tool use", async () => {
    const mockWorkspace = {
      gitStatus: vi.fn().mockResolvedValue({ stdout: "M src/index.ts", stderr: "", exitCode: 0 }),
    } as any;

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("git_status", { repo_dir: "." }))
      .mockResolvedValueOnce(textResponse("Changes detected"));

    const agent = new VerifierAgent(new LlmRegistry(), undefined, mockWorkspace);
    await agent.execute(baseContext);

    expect(mockWorkspace.gitStatus).toHaveBeenCalledWith(".");
  });

  it("handles run_tests tool use", async () => {
    const mockWorkspace = {
      runTests: vi.fn().mockResolvedValue({ stdout: "10 tests passed", stderr: "", exitCode: 0 }),
    } as any;

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("run_tests", { repo_dir: ".", command: "npm test" }))
      .mockResolvedValueOnce(textResponse("All tests pass"));

    const agent = new VerifierAgent(new LlmRegistry(), undefined, mockWorkspace);
    await agent.execute(baseContext);

    expect(mockWorkspace.runTests).toHaveBeenCalledWith(".", "npm test", 300_000);
  });

  it("returns error for workspace tools without workspace", async () => {
    mockComplete
      .mockResolvedValueOnce(toolUseResponse("read_file", { path: "test.ts" }))
      .mockResolvedValueOnce(textResponse("Workspace not available"));

    const agent = new VerifierAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("Workspace not available");
  });

  it("handles unknown tool gracefully", async () => {
    mockComplete
      .mockResolvedValueOnce(toolUseResponse("unknown_tool", {}))
      .mockResolvedValueOnce(textResponse("Proceeding"));

    const agent = new VerifierAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toBe("Proceeding");
  });

  it("truncates large read_file output", async () => {
    const largeContent = "x".repeat(15_000);
    const mockWorkspace = {
      readFile: vi.fn().mockResolvedValue(largeContent),
    } as any;

    mockComplete
      .mockResolvedValueOnce(toolUseResponse("read_file", { path: "big.ts" }))
      .mockResolvedValueOnce(textResponse("File was truncated"));

    const agent = new VerifierAgent(new LlmRegistry(), undefined, mockWorkspace);
    await agent.execute(baseContext);

    // The tool result should have been truncated
    const toolResultCall = mockComplete.mock.calls[1];
    const messages = toolResultCall[1].messages;
    const toolResult = messages[messages.length - 1].content[0];
    const parsed = JSON.parse(toolResult.content);
    expect(parsed.content.length).toBeLessThan(largeContent.length);
    expect(parsed.content).toContain("truncated");
  });
});
