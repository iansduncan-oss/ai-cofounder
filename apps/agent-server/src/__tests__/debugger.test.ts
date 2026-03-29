import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

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
    fatal: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  saveCodeExecution: vi.fn().mockResolvedValue({}),
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

vi.mock("../agents/tools/web-search.js", () => ({
  SEARCH_WEB_TOOL: {
    name: "search_web",
    description: "search",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  executeWebSearch: vi.fn().mockResolvedValue({ results: [] }),
}));

vi.mock("../agents/tools/memory-tools.js", () => ({
  RECALL_MEMORIES_TOOL: {
    name: "recall_memories",
    description: "recall",
    input_schema: { type: "object", properties: {} },
  },
}));

vi.mock("../agents/tools/sandbox-tools.js", () => ({
  EXECUTE_CODE_TOOL: {
    name: "execute_code",
    description: "execute",
    input_schema: {
      type: "object",
      properties: { code: { type: "string" }, language: { type: "string" } },
      required: ["code", "language"],
    },
  },
}));

const { DebuggerAgent } = await import("../agents/specialists/debugger.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");
const { executeWebSearch } = await import("../agents/tools/web-search.js");
const { recallMemories, searchMemoriesByVector } = await import("@ai-cofounder/db");

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
  taskId: "task-1",
  taskTitle: "Debug login crash",
  taskDescription: "The login endpoint crashes with a null reference error",
  goalTitle: "Fix production bugs",
  userId: "user-1",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DebuggerAgent", () => {
  it("has the correct role and taskCategory", () => {
    const agent = new DebuggerAgent(new LlmRegistry());
    expect(agent.role).toBe("debugger");
    expect(agent.taskCategory).toBe("code");
  });

  it("returns tools including analyze_error and trace_issue", () => {
    const agent = new DebuggerAgent(new LlmRegistry());
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("analyze_error");
    expect(names).toContain("trace_issue");
    expect(names).toContain("search_web");
    expect(names).toContain("recall_memories");
  });

  it("includes execute_code when sandbox is available", () => {
    const mockSandbox = { available: true, execute: vi.fn() };
    const agent = new DebuggerAgent(new LlmRegistry(), undefined, undefined, mockSandbox as any);
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("execute_code");
  });

  it("excludes execute_code when sandbox is not available", () => {
    const agent = new DebuggerAgent(new LlmRegistry());
    const tools = agent.getTools();
    const names = tools.map((t: any) => t.name);
    expect(names).not.toContain("execute_code");
  });

  it("executes a simple debugging task without tools", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("Root cause: missing null check on user.email"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("missing null check");
    expect(result.model).toBe("test-model");
    expect(result.provider).toBe("test");
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it("handles analyze_error tool use", async () => {
    // First call: agent wants to use analyze_error
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("analyze_error", {
          error_text: "TypeError: Cannot read property 'email' of null",
          context: "Login endpoint handler",
        }),
      )
      // Second call (inner analyze_error LLM call)
      .mockResolvedValueOnce(textResponse("Error type: TypeError\nLikely cause: user object is null"))
      // Third call: agent processes tool result
      .mockResolvedValueOnce(textResponse("Fix: add null check before accessing user.email"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("null check");
    expect(mockComplete).toHaveBeenCalledTimes(3);
  });

  it("handles trace_issue tool use", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("trace_issue", {
          symptom: "500 error on /login",
          code_snippets: "function login(req) { const user = getUser(req.body.id); return user.email; }",
        }),
      )
      .mockResolvedValueOnce(textResponse("Bug is at line: return user.email — user can be null"))
      .mockResolvedValueOnce(textResponse("Add: if (!user) return 404"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("404");
    expect(mockComplete).toHaveBeenCalledTimes(3);
  });

  it("handles search_web tool use", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("search_web", { query: "TypeError Cannot read property of null Node.js" }),
      )
      .mockResolvedValueOnce(textResponse("Found common fix: optional chaining"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("optional chaining");
    expect(executeWebSearch).toHaveBeenCalledWith("TypeError Cannot read property of null Node.js", undefined);
  });

  it("handles recall_memories tool use with text fallback", async () => {
    (recallMemories as any).mockResolvedValueOnce([
      { key: "debug-session-1", category: "technical", content: "Similar crash in auth module fixed by adding null guard" },
    ]);

    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("recall_memories", { query: "login null error" }),
      )
      .mockResolvedValueOnce(textResponse("Based on past debugging: add null guard"));

    const db = {} as any;
    const agent = new DebuggerAgent(new LlmRegistry(), db);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("null guard");
    expect(recallMemories).toHaveBeenCalled();
  });

  it("handles recall_memories with vector search when embedding service available", async () => {
    const mockEmbeddingService = {
      embed: vi.fn().mockResolvedValue(new Array(768).fill(0)),
    };

    (searchMemoriesByVector as any).mockResolvedValueOnce([
      { key: "debug-1", category: "technical", content: "Past fix", distance: 0.1 },
    ]);

    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("recall_memories", { query: "login crash" }),
      )
      .mockResolvedValueOnce(textResponse("Applied learnings from past fix"));

    const db = {} as any;
    const agent = new DebuggerAgent(new LlmRegistry(), db, mockEmbeddingService as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("learnings");
    expect(mockEmbeddingService.embed).toHaveBeenCalledWith("login crash");
    expect(searchMemoriesByVector).toHaveBeenCalled();
  });

  it("handles execute_code tool use", async () => {
    const mockSandbox = {
      available: true,
      execute: vi.fn().mockResolvedValue({
        stdout: "Test passed",
        stderr: "",
        exitCode: 0,
        durationMs: 150,
        timedOut: false,
        language: "typescript",
      }),
    };

    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("execute_code", {
          code: "console.log('test')",
          language: "typescript",
        }),
      )
      .mockResolvedValueOnce(textResponse("Code executes successfully, confirming fix works"));

    const agent = new DebuggerAgent(new LlmRegistry(), undefined, undefined, mockSandbox as any);
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("confirming fix works");
    expect(mockSandbox.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "console.log('test')",
        language: "typescript",
        taskId: "task-1",
      }),
    );
  });

  it("returns error for recall_memories without user context", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("recall_memories", { query: "test" }),
      )
      .mockResolvedValueOnce(textResponse("No memories available"));

    const contextNoUser = { ...baseContext, userId: undefined };
    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(contextNoUser);

    expect(result.output).toBe("No memories available");
  });

  it("returns error for execute_code without sandbox", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("execute_code", { code: "1+1", language: "javascript" }),
      )
      .mockResolvedValueOnce(textResponse("Cannot execute code, sandbox unavailable"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toContain("sandbox unavailable");
  });

  it("handles unknown tool gracefully", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("unknown_tool", {}),
      )
      .mockResolvedValueOnce(textResponse("Proceeding without tool"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    expect(result.output).toBe("Proceeding without tool");
  });

  it("includes previous outputs in context", async () => {
    mockComplete.mockResolvedValueOnce(textResponse("Building on previous research"));

    const contextWithOutputs = {
      ...baseContext,
      previousOutputs: ["Step 1: Found the crash occurs on line 42"],
    };

    const agent = new DebuggerAgent(new LlmRegistry());
    await agent.execute(contextWithOutputs);

    const callArgs = mockComplete.mock.calls[0];
    const messages = callArgs[1].messages;
    expect(messages[0].content).toContain("Previous Task Outputs");
    expect(messages[0].content).toContain("line 42");
  });

  it("accumulates token usage across tool rounds", async () => {
    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("analyze_error", { error_text: "some error" }),
      )
      .mockResolvedValueOnce(textResponse("Analysis result"))
      .mockResolvedValueOnce(textResponse("Final output"));

    const agent = new DebuggerAgent(new LlmRegistry());
    const result = await agent.execute(baseContext);

    // 2 outer LLM calls tracked by base class: initial (tool_use) + final (end_turn)
    // Inner analyze_error call is within executeTool, not tracked by base accumulator
    expect(result.usage.inputTokens).toBe(20); // 10 + 10
    expect(result.usage.outputTokens).toBe(35); // 15 + 20
  });

  it("caps execute_code timeout at 60s", async () => {
    const mockSandbox = {
      available: true,
      execute: vi.fn().mockResolvedValue({
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 100,
        timedOut: false,
        language: "typescript",
      }),
    };

    mockComplete
      .mockResolvedValueOnce(
        toolUseResponse("execute_code", {
          code: "while(true){}",
          language: "typescript",
          timeout_ms: 999_999,
        }),
      )
      .mockResolvedValueOnce(textResponse("Done"));

    const agent = new DebuggerAgent(new LlmRegistry(), undefined, undefined, mockSandbox as any);
    await agent.execute(baseContext);

    expect(mockSandbox.execute).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
  });
});
