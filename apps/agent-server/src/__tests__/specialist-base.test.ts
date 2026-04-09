import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { setupTestEnv, mockLlmModule, mockDbModule } from "@ai-cofounder/test-utils";

// Use vi.hoisted so these are available when vi.mock factories run
const {
  mockComplete,
  mockSetAttribute,
  mockSetStatus,
  mockSpanEnd,
  mockEstimate,
} = vi.hoisted(() => ({
  mockComplete: vi.fn(),
  mockSetAttribute: vi.fn(),
  mockSetStatus: vi.fn(),
  mockSpanEnd: vi.fn(),
  mockEstimate: vi.fn().mockReturnValue({ roundBudget: 3 }),
}));

beforeAll(() => {
  setupTestEnv();
});

// Mock @ai-cofounder/shared
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// Mock @ai-cofounder/db
vi.mock("@ai-cofounder/db", () => ({ ...mockDbModule() }));

// Mock @ai-cofounder/llm
vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));

vi.mock("@opentelemetry/api", () => ({
  trace: {
    getTracer: () => ({
      startActiveSpan: (_name: string, fn: (span: { setAttribute: typeof mockSetAttribute; setStatus: typeof mockSetStatus; end: typeof mockSpanEnd }) => unknown) =>
        fn({ setAttribute: mockSetAttribute, setStatus: mockSetStatus, end: mockSpanEnd }),
    }),
  },
  SpanStatusCode: { ERROR: 2 },
}));

// Mock complexity estimator — default roundBudget = 3
vi.mock("../../services/complexity-estimator.js", () => ({
  ComplexityEstimator: class {
    estimate = mockEstimate;
  },
}));

// Mock sanitizeForPrompt — pass-through
vi.mock("../agents/prompts/system.js", () => ({
  sanitizeForPrompt: (s: string) => s,
}));

// Dynamic imports after mocks are set up
const { SpecialistAgent } = await import("../agents/specialists/base.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

// --- Concrete TestAgent subclass ---

type SpecialistContext = InstanceType<typeof SpecialistAgent> extends { execute(ctx: infer C): unknown } ? C : never;

class TestAgent extends SpecialistAgent {
  readonly role = "researcher" as const;
  readonly taskCategory = "research" as const;

  getSystemPrompt(_context: SpecialistContext): string {
    return "You are a test agent.";
  }

  getTools() {
    return [
      {
        name: "test_tool",
        description: "A test tool",
        input_schema: {
          type: "object" as const,
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
    ];
  }

  // Expose protected method for direct testing
  public callCompleteWithRetry(...args: Parameters<LlmRegistry["complete"]>) {
    return this.completeWithRetry(...args);
  }

  // Expose protected executeTool for direct testing
  public callExecuteTool(block: unknown, context: SpecialistContext) {
    return this.executeTool(block as any, context);
  }
}

// Agent with no tools (for testing no-tool path)
class NoToolAgent extends SpecialistAgent {
  readonly role = "reviewer" as const;
  readonly taskCategory = "conversation" as const;

  getSystemPrompt(_context: SpecialistContext): string {
    return "You are a reviewer.";
  }

  getTools() {
    return [];
  }
}

// Agent that overrides executeTool
class ToolHandlerAgent extends TestAgent {
  public toolCallLog: unknown[] = [];

  protected override async executeTool(block: any, _context: SpecialistContext): Promise<unknown> {
    this.toolCallLog.push(block);
    return { result: "tool executed", tool: block.name };
  }
}

function makeContext(overrides: Partial<SpecialistContext> = {}): SpecialistContext {
  return {
    taskId: "task-1",
    taskTitle: "Test Task",
    taskDescription: "Do something useful",
    goalTitle: "Test Goal",
    ...overrides,
  } as SpecialistContext;
}

function mockTextResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test-provider",
  };
}

function mockToolUseResponse(name: string, input: Record<string, unknown>, id = "tu-1") {
  return {
    content: [{ type: "tool_use", id, name, input }],
    model: "test-model",
    stop_reason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 10 },
    provider: "test-provider",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEstimate.mockReturnValue({ roundBudget: 3 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SpecialistAgent base class", () => {
  // ---------------------------------------------------------------
  // 1. Basic execution -- no tools
  // ---------------------------------------------------------------
  describe("basic execution - no tools", () => {
    it("returns text output with model, provider, and usage", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Analysis complete"));

      const registry = new LlmRegistry();
      const agent = new NoToolAgent("reviewer", registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Analysis complete");
      expect(result.model).toBe("test-model");
      expect(result.provider).toBe("test-provider");
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it("passes undefined for tools when getTools returns empty array", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("No tools needed"));

      const registry = new LlmRegistry();
      const agent = new NoToolAgent("reviewer", registry);
      await agent.execute(makeContext());

      const callArgs = mockComplete.mock.calls[0][1];
      expect(callArgs.tools).toBeUndefined();
    });

    it("passes tools array when getTools returns tools", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("With tools"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext());

      const callArgs = mockComplete.mock.calls[0][1];
      expect(callArgs.tools).toHaveLength(1);
      expect(callArgs.tools[0].name).toBe("test_tool");
    });
  });

  // ---------------------------------------------------------------
  // 2. Tool loop -- 1 round
  // ---------------------------------------------------------------
  describe("tool loop - 1 round", () => {
    it("executes tool and returns final text output", async () => {
      mockComplete
        .mockResolvedValueOnce(mockToolUseResponse("test_tool", { query: "hello" }, "tu-1"))
        .mockResolvedValueOnce(mockTextResponse("Final answer"));

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Final answer");
      expect(mockComplete).toHaveBeenCalledTimes(2);
      // Tool was called
      expect(agent.toolCallLog).toHaveLength(1);
      expect(agent.toolCallLog[0]).toMatchObject({ name: "test_tool", input: { query: "hello" } });
    });

    it("accumulates usage across tool rounds", async () => {
      mockComplete
        .mockResolvedValueOnce(mockToolUseResponse("test_tool", { query: "q" }, "tu-1"))
        .mockResolvedValueOnce(mockTextResponse("Done"));

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      const result = await agent.execute(makeContext());

      // First call: inputTokens=10, outputTokens=10; second: inputTokens=10, outputTokens=20
      expect(result.usage.inputTokens).toBe(20);
      expect(result.usage.outputTokens).toBe(30);
    });

    it("pushes tool results as user message with tool_result content", async () => {
      mockComplete
        .mockResolvedValueOnce(mockToolUseResponse("test_tool", { query: "q" }, "tu-1"))
        .mockResolvedValueOnce(mockTextResponse("Done"));

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      await agent.execute(makeContext());

      // Second call should have the extended messages array
      const secondCallMessages = mockComplete.mock.calls[1][1].messages;
      // messages: [user, assistant (tool_use), user (tool_result)]
      expect(secondCallMessages).toHaveLength(3);
      expect(secondCallMessages[1].role).toBe("assistant");
      expect(secondCallMessages[2].role).toBe("user");
      expect(secondCallMessages[2].content[0].type).toBe("tool_result");
      expect(secondCallMessages[2].content[0].tool_use_id).toBe("tu-1");
    });
  });

  // ---------------------------------------------------------------
  // 3. Tool loop -- max rounds cap
  // ---------------------------------------------------------------
  describe("tool loop - max rounds cap", () => {
    it("stops at complexity budget when roundBudget <= 5", async () => {
      mockEstimate.mockReturnValue({ roundBudget: 3 });

      // Always return tool_use — should stop after 3 rounds
      for (let i = 0; i <= 3; i++) {
        mockComplete.mockResolvedValueOnce(
          mockToolUseResponse("test_tool", { query: `round-${i}` }, `tu-${i}`),
        );
      }

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      const result = await agent.execute(makeContext());

      // 1 initial call + 3 tool rounds = 4 calls
      expect(mockComplete).toHaveBeenCalledTimes(4);
      // No text content in final tool_use response
      expect(result.output).toBe("(No output produced)");
    });

    it("caps at 5 rounds even if complexity budget is higher", async () => {
      mockEstimate.mockReturnValue({ roundBudget: 10 });

      // Return tool_use for more than 5 rounds
      for (let i = 0; i <= 5; i++) {
        mockComplete.mockResolvedValueOnce(
          mockToolUseResponse("test_tool", { query: `round-${i}` }, `tu-${i}`),
        );
      }

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      const result = await agent.execute(makeContext());

      // 1 initial + 5 rounds = 6 calls (capped at 5 rounds)
      expect(mockComplete).toHaveBeenCalledTimes(6);
      expect(result.output).toBe("(No output produced)");
    });

    it("stops early when response is not tool_use", async () => {
      mockEstimate.mockReturnValue({ roundBudget: 5 });

      mockComplete
        .mockResolvedValueOnce(mockToolUseResponse("test_tool", { query: "q1" }, "tu-1"))
        .mockResolvedValueOnce(mockTextResponse("Done after 1 round"));

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      const result = await agent.execute(makeContext());

      expect(mockComplete).toHaveBeenCalledTimes(2);
      expect(result.output).toBe("Done after 1 round");
    });
  });

  // ---------------------------------------------------------------
  // 4. No output produced
  // ---------------------------------------------------------------
  describe("no output produced", () => {
    it("returns '(No output produced)' when content array is empty", async () => {
      mockComplete.mockResolvedValueOnce({
        content: [],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 5 },
        provider: "test-provider",
      });

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("(No output produced)");
    });

    it("returns '(No output produced)' when content has only tool_use blocks", async () => {
      // Final response is tool_use but loop has ended (round === MAX_TOOL_ROUNDS)
      mockEstimate.mockReturnValue({ roundBudget: 0 });

      mockComplete.mockResolvedValueOnce(
        mockToolUseResponse("test_tool", { query: "q" }, "tu-1"),
      );

      const registry = new LlmRegistry();
      const agent = new ToolHandlerAgent("test", registry);
      const result = await agent.execute(makeContext());

      // With roundBudget=0, max rounds = min(0, 5) = 0, so no tool rounds execute
      expect(result.output).toBe("(No output produced)");
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // 5. Previous outputs included in message
  // ---------------------------------------------------------------
  describe("previous outputs included in message", () => {
    it("includes previousOutputs in the user message", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Built on prior work"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(
        makeContext({
          previousOutputs: ["Step 1 result", "Step 2 result"],
        }),
      );

      const callArgs = mockComplete.mock.calls[0][1];
      const userMessage = callArgs.messages[0].content;

      expect(userMessage).toContain("Previous Task Outputs");
      expect(userMessage).toContain("Step 1");
      expect(userMessage).toContain("Step 1 result");
      expect(userMessage).toContain("Step 2");
      expect(userMessage).toContain("Step 2 result");
    });

    it("does not include previous outputs section when none provided", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("No prior"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext());

      const callArgs = mockComplete.mock.calls[0][1];
      const userMessage = callArgs.messages[0].content;

      expect(userMessage).not.toContain("Previous Task Outputs");
    });

    it("does not include previous outputs section when empty array provided", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("No prior"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext({ previousOutputs: [] }));

      const callArgs = mockComplete.mock.calls[0][1];
      const userMessage = callArgs.messages[0].content;

      expect(userMessage).not.toContain("Previous Task Outputs");
    });
  });

  // ---------------------------------------------------------------
  // 6. completeWithRetry -- transient 429 error retries once then succeeds
  // ---------------------------------------------------------------
  describe("completeWithRetry - transient 429 retries then succeeds", () => {
    it("retries on 429 rate limit and returns successful response", async () => {
      vi.useFakeTimers();

      mockComplete
        .mockRejectedValueOnce(new Error("rate limit exceeded (429)"))
        .mockResolvedValueOnce(mockTextResponse("Recovered"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      const executePromise = agent.execute(makeContext());

      // Advance timers past the retry delay (BASE_DELAY_MS * 2^0 + random ~500ms)
      await vi.advanceTimersByTimeAsync(5_000);

      const result = await executePromise;

      expect(result.output).toBe("Recovered");
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------
  // 7. completeWithRetry -- transient error retries then fails
  // ---------------------------------------------------------------
  describe("completeWithRetry - transient error retries then fails", () => {
    it("throws after both attempts fail with transient errors", async () => {
      vi.useFakeTimers();

      mockComplete
        .mockRejectedValueOnce(new Error("429 rate limit"))
        .mockRejectedValueOnce(new Error("429 rate limit again"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      let thrownError: Error | undefined;
      const executePromise = agent.execute(makeContext()).catch((err) => {
        thrownError = err as Error;
      });

      await vi.advanceTimersByTimeAsync(5_000);
      await executePromise;

      expect(thrownError).toBeDefined();
      expect(thrownError!.message).toContain("429 rate limit again");
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------
  // 8. completeWithRetry -- non-transient error does NOT retry
  // ---------------------------------------------------------------
  describe("completeWithRetry - non-transient error no retry", () => {
    it("immediately rethrows non-transient errors without retrying", async () => {
      mockComplete.mockRejectedValueOnce(new Error("Invalid API key"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      await expect(agent.execute(makeContext())).rejects.toThrow("Invalid API key");
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it("immediately rethrows generic errors", async () => {
      mockComplete.mockRejectedValueOnce(new Error("Unknown provider"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      await expect(agent.execute(makeContext())).rejects.toThrow("Unknown provider");
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it("does not retry non-Error exceptions", async () => {
      mockComplete.mockRejectedValueOnce("string error");

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      await expect(agent.execute(makeContext())).rejects.toBe("string error");
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------
  // 9. completeWithRetry -- various transient patterns
  // ---------------------------------------------------------------
  describe("completeWithRetry - various transient error patterns", () => {
    const transientMessages = [
      "503 Service Unavailable: overloaded",
      "Request timeout",
      "ECONNRESET",
      "socket hang up",
      "rate limit hit",
      "Error 429 Too Many Requests",
    ];

    for (const message of transientMessages) {
      it(`retries on "${message}" and recovers`, async () => {
        vi.useFakeTimers();

        mockComplete
          .mockRejectedValueOnce(new Error(message))
          .mockResolvedValueOnce(mockTextResponse(`Recovered from ${message}`));

        const registry = new LlmRegistry();
        const agent = new TestAgent("test", registry);
        const executePromise = agent.execute(makeContext());

        await vi.advanceTimersByTimeAsync(5_000);

        const result = await executePromise;

        expect(result.output).toBe(`Recovered from ${message}`);
        expect(mockComplete).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
      });
    }
  });

  // ---------------------------------------------------------------
  // 10. Default executeTool returns error
  // ---------------------------------------------------------------
  describe("default executeTool", () => {
    it("returns { error: 'No tool handler implemented' }", async () => {
      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      const result = await agent.callExecuteTool(
        { type: "tool_use", id: "tu-1", name: "unknown_tool", input: {} },
        makeContext(),
      );

      expect(result).toEqual({ error: "No tool handler implemented" });
    });
  });

  // ---------------------------------------------------------------
  // 11. execute wraps in span
  // ---------------------------------------------------------------
  describe("execute wraps in span", () => {
    it("sets span attributes for agent.role, task.id, and task.title", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Traced output"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext({ taskId: "task-42", taskTitle: "Important Task" }));

      // The outermost span (specialist.researcher) sets these attributes
      expect(mockSetAttribute).toHaveBeenCalledWith("agent.role", "researcher");
      expect(mockSetAttribute).toHaveBeenCalledWith("task.id", "task-42");
      expect(mockSetAttribute).toHaveBeenCalledWith("task.title", "Important Task");
    });

    it("calls span.end()", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Traced"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext());

      expect(mockSpanEnd).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------
  // 12. execute propagates errors and sets span status
  // ---------------------------------------------------------------
  describe("execute propagates errors and sets span status", () => {
    it("sets span status to ERROR and rethrows on failure", async () => {
      const error = new Error("LLM provider down");
      mockComplete.mockRejectedValueOnce(error);

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      await expect(agent.execute(makeContext())).rejects.toThrow("LLM provider down");

      // Span should have ERROR status set
      expect(mockSetStatus).toHaveBeenCalledWith(
        expect.objectContaining({ code: 2 }), // SpanStatusCode.ERROR = 2
      );
      // Span should still be ended in the finally block
      expect(mockSpanEnd).toHaveBeenCalled();
    });

    it("includes error message in span status", async () => {
      mockComplete.mockRejectedValueOnce(new Error("Something went wrong"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);

      await expect(agent.execute(makeContext())).rejects.toThrow("Something went wrong");

      // Find the call from the execute span (not the inner completeWithRetry span)
      const errorStatusCalls = mockSetStatus.mock.calls.filter(
        (call) => call[0].code === 2 && call[0].message?.includes("Something went wrong"),
      );
      expect(errorStatusCalls.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------
  // Additional edge cases
  // ---------------------------------------------------------------
  describe("edge cases", () => {
    it("uses correct task category when calling complete", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Output"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext());

      expect(mockComplete).toHaveBeenCalledWith("research", expect.any(Object));
    });

    it("passes system prompt from getSystemPrompt to complete", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Output"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext());

      const callArgs = mockComplete.mock.calls[0][1];
      expect(callArgs.system).toBe("You are a test agent.");
    });

    it("sets max_tokens to 4096", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Output"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(makeContext());

      const callArgs = mockComplete.mock.calls[0][1];
      expect(callArgs.max_tokens).toBe(4096);
    });

    it("includes task title and description in user message", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Output"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(
        makeContext({
          taskTitle: "Build Widget",
          taskDescription: "Create a fancy widget component",
        }),
      );

      const userMessage = mockComplete.mock.calls[0][1].messages[0].content;
      expect(userMessage).toContain("Build Widget");
      expect(userMessage).toContain("Create a fancy widget component");
    });

    it("concatenates multiple text blocks with newlines", async () => {
      mockComplete.mockResolvedValueOnce({
        content: [
          { type: "text", text: "First part" },
          { type: "text", text: "Second part" },
        ],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 20 },
        provider: "test-provider",
      });

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("First part\nSecond part");
    });

    it("calls ComplexityEstimator with task description and tool count", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Output"));

      const registry = new LlmRegistry();
      const agent = new TestAgent("test", registry);
      await agent.execute(
        makeContext({ taskDescription: "Complex task requiring analysis" }),
      );

      expect(mockEstimate).toHaveBeenCalledWith({
        description: "Complex task requiring analysis",
        toolCount: 1,
      });
    });
  });
});
