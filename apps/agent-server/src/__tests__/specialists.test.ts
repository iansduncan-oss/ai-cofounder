import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockComplete = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({}),
  recallMemories: vi.fn().mockResolvedValue([
    { key: "pref", category: "preferences", content: "likes TypeScript" },
  ]),
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("../agents/tools/web-search.js", () => ({
  SEARCH_WEB_TOOL: {
    name: "search_web",
    description: "Search the web",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  executeWebSearch: vi.fn().mockResolvedValue({ results: [{ title: "Result", url: "https://example.com" }] }),
}));

vi.mock("../agents/tools/memory-tools.js", () => ({
  RECALL_MEMORIES_TOOL: {
    name: "recall_memories",
    description: "Recall memories",
    input_schema: { type: "object", properties: { query: { type: "string" } } },
  },
}));

const { ResearcherAgent } = await import("../agents/specialists/researcher.js");
const { CoderAgent } = await import("../agents/specialists/coder.js");
const { ReviewerAgent } = await import("../agents/specialists/reviewer.js");
const { PlannerAgent } = await import("../agents/specialists/planner.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

beforeEach(() => {
  vi.clearAllMocks();
});

function makeContext(overrides = {}) {
  return {
    taskId: "task-1",
    taskTitle: "Test Task",
    taskDescription: "Do something useful",
    goalTitle: "Test Goal",
    ...overrides,
  };
}

function mockTextResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

describe("Specialist Agents", () => {
  describe("ResearcherAgent", () => {
    it("has correct role and task category", () => {
      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      expect(agent.role).toBe("researcher");
      expect(agent.taskCategory).toBe("research");
    });

    it("includes search and memory tools", () => {
      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const tools = agent.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(["search_web", "recall_memories"]);
    });

    it("executes and returns text output", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Research findings here"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Research findings here");
      expect(result.model).toBe("test-model");
      expect(mockComplete).toHaveBeenCalledWith("research", expect.objectContaining({
        messages: expect.any(Array),
      }));
    });

    it("includes previous outputs in context", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Step 2 output"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      await agent.execute(makeContext({
        previousOutputs: ["Step 1 output"],
      }));

      const callArgs = mockComplete.mock.calls[0][1];
      expect(callArgs.messages[0].content).toContain("Step 1 output");
    });

    it("handles tool use loop", async () => {
      // First call: LLM wants to use a tool
      mockComplete
        .mockResolvedValueOnce({
          content: [
            { type: "tool_use", id: "tu-1", name: "search_web", input: { query: "test" } },
          ],
          model: "test-model",
          stop_reason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
          provider: "test",
        })
        // Second call: LLM returns text after tool result
        .mockResolvedValueOnce(mockTextResponse("Found useful info"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Found useful info");
      expect(mockComplete).toHaveBeenCalledTimes(2);
      // Usage should accumulate
      expect(result.usage.inputTokens).toBe(20);
    });

    it("respects max 3 tool rounds", async () => {
      // Return tool_use 4 times, should stop after 3 rounds
      const toolResponse = {
        content: [
          { type: "tool_use", id: "tu-1", name: "search_web", input: { query: "test" } },
        ],
        model: "test-model",
        stop_reason: "tool_use",
        usage: { inputTokens: 5, outputTokens: 5 },
        provider: "test",
      };

      mockComplete
        .mockResolvedValueOnce(toolResponse) // initial
        .mockResolvedValueOnce({ ...toolResponse, content: [{ ...toolResponse.content[0], id: "tu-2" }] }) // round 1
        .mockResolvedValueOnce({ ...toolResponse, content: [{ ...toolResponse.content[0], id: "tu-3" }] }) // round 2
        .mockResolvedValueOnce({ ...toolResponse, content: [{ ...toolResponse.content[0], id: "tu-4" }] }); // round 3

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      // 1 initial + 3 rounds = 4 calls
      expect(mockComplete).toHaveBeenCalledTimes(4);
      expect(result.output).toBe("(No output produced)");
    });
  });

  describe("CoderAgent", () => {
    it("has correct role and task category", () => {
      const registry = new LlmRegistry();
      const agent = new CoderAgent(registry);
      expect(agent.role).toBe("coder");
      expect(agent.taskCategory).toBe("code");
    });

    it("has review_code tool", () => {
      const registry = new LlmRegistry();
      const agent = new CoderAgent(registry);
      const tools = agent.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("review_code");
    });

    it("executes review_code tool via LLM", async () => {
      // First call: LLM wants to review code
      mockComplete
        .mockResolvedValueOnce({
          content: [
            {
              type: "tool_use",
              id: "tu-1",
              name: "review_code",
              input: { code: "const x = 1;", language: "typescript" },
            },
          ],
          model: "test-model",
          stop_reason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
          provider: "test",
        })
        // review_code calls registry.complete("simple", ...)
        .mockResolvedValueOnce(mockTextResponse("Code looks good"))
        // Final response after tool result
        .mockResolvedValueOnce(mockTextResponse("Here is the code"));

      const registry = new LlmRegistry();
      const agent = new CoderAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Here is the code");
      expect(mockComplete).toHaveBeenCalledTimes(3);
    });
  });

  describe("ReviewerAgent", () => {
    it("has correct role and task category", () => {
      const registry = new LlmRegistry();
      const agent = new ReviewerAgent(registry);
      expect(agent.role).toBe("reviewer");
      expect(agent.taskCategory).toBe("conversation");
    });

    it("has no tools", () => {
      const registry = new LlmRegistry();
      const agent = new ReviewerAgent(registry);
      expect(agent.getTools()).toHaveLength(0);
    });

    it("executes without tool loop", async () => {
      mockComplete.mockResolvedValueOnce(mockTextResponse("Quality: good. Minor issues found."));

      const registry = new LlmRegistry();
      const agent = new ReviewerAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Quality: good. Minor issues found.");
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe("PlannerAgent", () => {
    it("has correct role and task category", () => {
      const registry = new LlmRegistry();
      const agent = new PlannerAgent(registry);
      expect(agent.role).toBe("planner");
      expect(agent.taskCategory).toBe("planning");
    });

    it("has search_web tool", () => {
      const registry = new LlmRegistry();
      const agent = new PlannerAgent(registry);
      const tools = agent.getTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("search_web");
    });

    it("generates a plan", async () => {
      mockComplete.mockResolvedValueOnce(
        mockTextResponse("## Plan\n1. Research\n2. Implement\n3. Review"),
      );

      const registry = new LlmRegistry();
      const agent = new PlannerAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toContain("Plan");
      expect(result.output).toContain("Research");
    });
  });

  describe("completeWithRetry", () => {
    it("retries on transient 429 error and succeeds", async () => {
      mockComplete
        .mockRejectedValueOnce(new Error("rate limit exceeded (429)"))
        .mockResolvedValueOnce(mockTextResponse("Recovered"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Recovered");
      // 1st call fails, retry succeeds
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });

    it("retries on timeout error", async () => {
      mockComplete
        .mockRejectedValueOnce(new Error("Request timeout"))
        .mockResolvedValueOnce(mockTextResponse("Recovered from timeout"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Recovered from timeout");
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });

    it("retries on 503 overloaded error", async () => {
      mockComplete
        .mockRejectedValueOnce(new Error("503 Service Unavailable: overloaded"))
        .mockResolvedValueOnce(mockTextResponse("Back online"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Back online");
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });

    it("does not retry on non-transient errors", async () => {
      mockComplete.mockRejectedValueOnce(new Error("Invalid API key"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);

      await expect(agent.execute(makeContext())).rejects.toThrow("Invalid API key");
      expect(mockComplete).toHaveBeenCalledTimes(1);
    });

    it("throws if retry also fails", async () => {
      mockComplete
        .mockRejectedValueOnce(new Error("429 rate limit"))
        .mockRejectedValueOnce(new Error("429 rate limit again"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);

      await expect(agent.execute(makeContext())).rejects.toThrow("429 rate limit again");
      expect(mockComplete).toHaveBeenCalledTimes(2);
    });

    it("retries on ECONNRESET error", async () => {
      mockComplete
        .mockRejectedValueOnce(new Error("ECONNRESET"))
        .mockResolvedValueOnce(mockTextResponse("Reconnected"));

      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const result = await agent.execute(makeContext());

      expect(result.output).toBe("Reconnected");
    });
  });

  describe("System prompt includes goal title", () => {
    it("researcher includes goal context", () => {
      const registry = new LlmRegistry();
      const agent = new ResearcherAgent(registry);
      const prompt = agent.getSystemPrompt(makeContext({ goalTitle: "Launch Product" }));
      expect(prompt).toContain("Launch Product");
    });

    it("coder includes goal context", () => {
      const registry = new LlmRegistry();
      const agent = new CoderAgent(registry);
      const prompt = agent.getSystemPrompt(makeContext({ goalTitle: "Build API" }));
      expect(prompt).toContain("Build API");
    });
  });
});
