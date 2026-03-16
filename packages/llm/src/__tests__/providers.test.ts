import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LlmCompletionRequest,
  LlmTool,
} from "../types.js";

/* ────────────────────────────────────────────────────────────
 *  Mock external SDKs
 * ────────────────────────────────────────────────────────── */

// ── Anthropic SDK mock ──
const mockAnthropicCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockAnthropicCreate };
      constructor(_opts: unknown) {}
    },
  };
});

// ── OpenAI SDK mock (used by OpenAI-compatible, Groq, OpenRouter) ──
const mockOpenAICreate = vi.fn();
vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockOpenAICreate } };
      constructor(_opts: unknown) {}
    },
  };
});

// ── Google Generative AI mock ──
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});
vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: class MockGoogleAI {
      getGenerativeModel = mockGetGenerativeModel;
      constructor(_apiKey: string) {}
    },
    SchemaType: {
      STRING: "STRING",
      NUMBER: "NUMBER",
      INTEGER: "INTEGER",
      BOOLEAN: "BOOLEAN",
      ARRAY: "ARRAY",
      OBJECT: "OBJECT",
    },
  };
});

// ── Stable randomUUID mock for Gemini IDs ──
vi.mock("node:crypto", () => ({
  randomUUID: () => "00000000-0000-0000-0000-000000000000",
}));

/* ────────────────────────────────────────────────────────────
 *  Imports (after mocks)
 * ────────────────────────────────────────────────────────── */
import { AnthropicProvider } from "../providers/anthropic.js";
import { OpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { GroqProvider } from "../providers/groq.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import { GeminiProvider } from "../providers/gemini.js";

/* ────────────────────────────────────────────────────────────
 *  Helpers
 * ────────────────────────────────────────────────────────── */

const simpleRequest: LlmCompletionRequest = {
  messages: [{ role: "user", content: "Hello" }],
};

const requestWithSystem: LlmCompletionRequest = {
  system: "You are helpful.",
  messages: [{ role: "user", content: "Hello" }],
};

const requestWithTools: LlmCompletionRequest = {
  messages: [{ role: "user", content: "Search for cats" }],
  tools: [
    {
      name: "search",
      description: "Search the web",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "search query" },
        },
        required: ["query"],
      },
    },
  ],
};

const requestWithStructuredMessages: LlmCompletionRequest = {
  messages: [
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll search for that." },
        {
          type: "tool_use",
          id: "tool-1",
          name: "search",
          input: { query: "cats" },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "Found 10 results about cats",
        },
      ],
    },
  ],
};

/* ════════════════════════════════════════════════════════════
 *  AnthropicProvider
 * ════════════════════════════════════════════════════════════ */

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("is available when apiKey is provided", () => {
      const provider = new AnthropicProvider("sk-test");
      expect(provider.available).toBe(true);
      expect(provider.name).toBe("anthropic");
      expect(provider.defaultModel).toBe("claude-sonnet-4-20250514");
    });

    it("is not available when apiKey is undefined", () => {
      const provider = new AnthropicProvider(undefined);
      expect(provider.available).toBe(false);
    });

    it("accepts a custom default model", () => {
      const provider = new AnthropicProvider("sk-test", "claude-opus-4-20250514");
      expect(provider.defaultModel).toBe("claude-opus-4-20250514");
    });
  });

  describe("complete()", () => {
    it("throws when not configured", async () => {
      const provider = new AnthropicProvider(undefined);
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "Anthropic provider not configured",
      );
    });

    it("sends a basic text completion and maps the response", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hi there!" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 8 },
      });

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);

      expect(mockAnthropicCreate).toHaveBeenCalledWith({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: undefined,
        messages: [{ role: "user", content: "Hello" }],
        tools: undefined,
      });

      expect(response).toEqual({
        content: [{ type: "text", text: "Hi there!" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 8 },
      });
    });

    it("uses provided model, max_tokens, temperature, and system prompt", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        model: "claude-opus-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      });

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({
        model: "claude-opus-4-20250514",
        system: "You are a pirate.",
        messages: [{ role: "user", content: "Ahoy" }],
        max_tokens: 1024,
        temperature: 0.5,
      });

      expect(mockAnthropicCreate).toHaveBeenCalledWith({
        model: "claude-opus-4-20250514",
        max_tokens: 1024,
        system: [{ type: "text", text: "You are a pirate.", cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: "Ahoy" }],
        tools: undefined,
        temperature: 0.5,
      });
    });

    it("maps tool_use response blocks correctly", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [
          { type: "text", text: "Let me search." },
          {
            type: "tool_use",
            id: "toolu_123",
            name: "search",
            input: { query: "cats" },
          },
        ],
        model: "claude-sonnet-4-20250514",
        stop_reason: "tool_use",
        usage: { input_tokens: 15, output_tokens: 25 },
      });

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(requestWithTools);

      expect(response.stop_reason).toBe("tool_use");
      expect(response.content).toHaveLength(2);
      expect(response.content[0]).toEqual({ type: "text", text: "Let me search." });
      expect(response.content[1]).toEqual({
        type: "tool_use",
        id: "toolu_123",
        name: "search",
        input: { query: "cats" },
      });
    });

    it("sends tools in Anthropic format", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "ok" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 5 },
      });

      const provider = new AnthropicProvider("sk-test");
      await provider.complete(requestWithTools);

      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      expect(callArgs.tools).toEqual([
        {
          name: "search",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: {
              query: { type: "string", description: "search query" },
            },
            required: ["query"],
          },
          cache_control: { type: "ephemeral" },
        },
      ]);
    });

    it("converts structured message content blocks", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Got it" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 20, output_tokens: 5 },
      });

      const provider = new AnthropicProvider("sk-test");
      await provider.complete(requestWithStructuredMessages);

      const callArgs = mockAnthropicCreate.mock.calls[0][0];
      // assistant message with tool_use blocks
      expect(callArgs.messages[0].role).toBe("assistant");
      expect(callArgs.messages[0].content).toEqual([
        { type: "text", text: "I'll search for that." },
        { type: "tool_use", id: "tool-1", name: "search", input: { query: "cats" } },
      ]);
      // user message with tool_result block
      expect(callArgs.messages[1].role).toBe("user");
      expect(callArgs.messages[1].content).toEqual([
        {
          type: "tool_result",
          tool_use_id: "tool-1",
          content: "Found 10 results about cats",
        },
      ]);
    });

    it("maps stop_reason 'max_tokens' correctly", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "truncated" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "max_tokens",
        usage: { input_tokens: 5, output_tokens: 4096 },
      });

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("max_tokens");
    });

    it("maps unknown stop_reason to 'unknown'", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "?" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "content_filter",
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("unknown");
    });

    it("maps null stop_reason to 'unknown'", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "?" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: null,
        usage: { input_tokens: 5, output_tokens: 2 },
      });

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("unknown");
    });

    it("handles unknown content block types gracefully", async () => {
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: "thinking", thinking: "hmm..." }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 5, output_tokens: 3 },
      });

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);
      // Unknown block types fall through to the default: empty text block
      expect(response.content).toEqual([{ type: "text", text: "" }]);
    });

    it("propagates API errors", async () => {
      mockAnthropicCreate.mockRejectedValueOnce(new Error("Rate limit exceeded"));

      const provider = new AnthropicProvider("sk-test");
      await expect(provider.complete(simpleRequest)).rejects.toThrow("Rate limit exceeded");
    });
  });
});

/* ════════════════════════════════════════════════════════════
 *  OpenAICompatibleProvider
 * ════════════════════════════════════════════════════════════ */

describe("OpenAICompatibleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("is available when apiKey is provided", () => {
      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      expect(provider.available).toBe(true);
      expect(provider.name).toBe("test-provider");
      expect(provider.defaultModel).toBe("test-model");
    });

    it("is not available when apiKey is undefined", () => {
      const provider = new OpenAICompatibleProvider(
        "test-provider",
        undefined,
        "test-model",
        "https://api.test.com/v1",
      );
      expect(provider.available).toBe(false);
    });
  });

  describe("complete()", () => {
    it("throws when not configured", async () => {
      const provider = new OpenAICompatibleProvider(
        "test-provider",
        undefined,
        "test-model",
        "https://api.test.com/v1",
      );
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "test-provider provider not configured",
      );
    });

    it("sends a basic completion and maps response", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "Hi there!", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 8 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      const response = await provider.complete(simpleRequest);

      expect(response).toEqual({
        content: [{ type: "text", text: "Hi there!" }],
        model: "test-model",
        stop_reason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 8 },
      });
    });

    it("prepends system message to OpenAI messages array", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "ok", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await provider.complete(requestWithSystem);

      const callArgs = mockOpenAICreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({
        role: "system",
        content: "You are helpful.",
      });
      expect(callArgs.messages[1]).toEqual({
        role: "user",
        content: "Hello",
      });
    });

    it("converts tools to OpenAI function format", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "searching...", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await provider.complete(requestWithTools);

      const callArgs = mockOpenAICreate.mock.calls[0][0];
      expect(callArgs.tools).toEqual([
        {
          type: "function",
          function: {
            name: "search",
            description: "Search the web",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "search query" },
              },
              required: ["query"],
            },
          },
        },
      ]);
    });

    it("does not send tools when tools array is empty", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "ok", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await provider.complete({
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      });

      const callArgs = mockOpenAICreate.mock.calls[0][0];
      expect(callArgs.tools).toBeUndefined();
    });

    it("maps tool_calls in response to tool_use blocks", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Let me search.",
              tool_calls: [
                {
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "search",
                    arguments: '{"query":"cats"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      const response = await provider.complete(requestWithTools);

      expect(response.stop_reason).toBe("tool_use");
      expect(response.content).toEqual([
        { type: "text", text: "Let me search." },
        {
          type: "tool_use",
          id: "call_123",
          name: "search",
          input: { query: "cats" },
        },
      ]);
    });

    it("handles tool_calls with empty arguments string", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: "call_456",
                  type: "function",
                  function: {
                    name: "get_status",
                    arguments: "",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 10 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      const response = await provider.complete(simpleRequest);

      expect(response.content).toEqual([
        {
          type: "tool_use",
          id: "call_456",
          name: "get_status",
          input: {},
        },
      ]);
    });

    it("converts structured messages with tool_result and tool_use blocks", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "Done", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 30, completion_tokens: 5 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await provider.complete(requestWithStructuredMessages);

      const callArgs = mockOpenAICreate.mock.calls[0][0];
      const messages = callArgs.messages;

      // Assistant message with tool_calls
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toBe("I'll search for that.");
      expect(messages[0].tool_calls).toEqual([
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "search",
            arguments: '{"query":"cats"}',
          },
        },
      ]);

      // Tool result as "tool" role message
      expect(messages[1]).toEqual({
        role: "tool",
        tool_call_id: "tool-1",
        content: "Found 10 results about cats",
      });
    });

    it("maps finish_reason 'length' to 'max_tokens'", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "truncated", tool_calls: null },
            finish_reason: "length",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 4096 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("max_tokens");
    });

    it("maps unknown finish_reason to 'unknown'", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "?", tool_calls: null },
            finish_reason: "content_filter",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("unknown");
    });

    it("throws on empty response (no choices)", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 0 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "test-provider: empty response",
      );
    });

    it("defaults usage to 0 when not provided", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "ok", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: undefined,
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      const response = await provider.complete(simpleRequest);
      expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    it("uses provided model instead of default", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "ok", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "custom-model",
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await provider.complete({ ...simpleRequest, model: "custom-model" });

      const callArgs = mockOpenAICreate.mock.calls[0][0];
      expect(callArgs.model).toBe("custom-model");
    });

    it("passes temperature only when provided", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "ok", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "test-model",
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      });

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await provider.complete(simpleRequest);

      const callArgs = mockOpenAICreate.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("temperature");
    });

    it("propagates API errors", async () => {
      mockOpenAICreate.mockRejectedValueOnce(new Error("500 Internal Server Error"));

      const provider = new OpenAICompatibleProvider(
        "test-provider",
        "sk-test",
        "test-model",
        "https://api.test.com/v1",
      );
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "500 Internal Server Error",
      );
    });
  });
});

/* ════════════════════════════════════════════════════════════
 *  GroqProvider
 * ════════════════════════════════════════════════════════════ */

describe("GroqProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("has correct name, model, and availability", () => {
      const provider = new GroqProvider("gsk-test");
      expect(provider.name).toBe("groq");
      expect(provider.defaultModel).toBe("llama-3.3-70b-versatile");
      expect(provider.available).toBe(true);
    });

    it("is not available without an API key", () => {
      const provider = new GroqProvider(undefined);
      expect(provider.available).toBe(false);
    });
  });

  describe("complete()", () => {
    it("delegates to OpenAI-compatible complete()", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "Groq response", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "llama-3.3-70b-versatile",
        usage: { prompt_tokens: 5, completion_tokens: 8 },
      });

      const provider = new GroqProvider("gsk-test");
      const response = await provider.complete(simpleRequest);

      expect(response.content).toEqual([{ type: "text", text: "Groq response" }]);
      expect(response.model).toBe("llama-3.3-70b-versatile");
      expect(response.stop_reason).toBe("end_turn");
    });

    it("throws when not configured", async () => {
      const provider = new GroqProvider(undefined);
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "groq provider not configured",
      );
    });
  });
});

/* ════════════════════════════════════════════════════════════
 *  OpenRouterProvider
 * ════════════════════════════════════════════════════════════ */

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("has correct name, model, and availability", () => {
      const provider = new OpenRouterProvider("or-test");
      expect(provider.name).toBe("openrouter");
      expect(provider.defaultModel).toBe("meta-llama/llama-3.3-70b-instruct:free");
      expect(provider.available).toBe(true);
    });

    it("is not available without an API key", () => {
      const provider = new OpenRouterProvider(undefined);
      expect(provider.available).toBe(false);
    });
  });

  describe("complete()", () => {
    it("delegates to OpenAI-compatible complete()", async () => {
      mockOpenAICreate.mockResolvedValueOnce({
        choices: [
          {
            message: { content: "OpenRouter response", tool_calls: null },
            finish_reason: "stop",
          },
        ],
        model: "meta-llama/llama-3.3-70b-instruct:free",
        usage: { prompt_tokens: 5, completion_tokens: 8 },
      });

      const provider = new OpenRouterProvider("or-test");
      const response = await provider.complete(simpleRequest);

      expect(response.content).toEqual([{ type: "text", text: "OpenRouter response" }]);
      expect(response.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
      expect(response.stop_reason).toBe("end_turn");
    });

    it("throws when not configured", async () => {
      const provider = new OpenRouterProvider(undefined);
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "openrouter provider not configured",
      );
    });
  });
});

/* ════════════════════════════════════════════════════════════
 *  GeminiProvider
 * ════════════════════════════════════════════════════════════ */

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGenerativeModel.mockReturnValue({
      generateContent: mockGenerateContent,
    });
  });

  describe("initialization", () => {
    it("is available when apiKey is provided", () => {
      const provider = new GeminiProvider("gm-test");
      expect(provider.available).toBe(true);
      expect(provider.name).toBe("gemini");
      expect(provider.defaultModel).toBe("gemini-2.5-flash");
    });

    it("is not available when apiKey is undefined", () => {
      const provider = new GeminiProvider(undefined);
      expect(provider.available).toBe(false);
    });

    it("accepts a custom default model", () => {
      const provider = new GeminiProvider("gm-test", "gemini-2.5-pro");
      expect(provider.defaultModel).toBe("gemini-2.5-pro");
    });
  });

  describe("complete()", () => {
    it("throws when not configured", async () => {
      const provider = new GeminiProvider(undefined);
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "Gemini provider not configured",
      );
    });

    it("sends a basic text completion and maps the response", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: "Hello from Gemini!" }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 8,
          },
        },
      });

      const provider = new GeminiProvider("gm-test");
      const response = await provider.complete(simpleRequest);

      expect(response).toEqual({
        content: [{ type: "text", text: "Hello from Gemini!" }],
        model: "gemini-2.5-flash",
        stop_reason: "end_turn",
        usage: { inputTokens: 5, outputTokens: 8 },
      });
    });

    it("sets systemInstruction when system prompt provided", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete(requestWithSystem);

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: "gemini-2.5-flash",
        systemInstruction: "You are helpful.",
      });
    });

    it("does not set systemInstruction when no system prompt", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete(simpleRequest);

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: "gemini-2.5-flash",
      });
    });

    it("maps function call responses to tool_use blocks", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { text: "Searching..." },
                  {
                    functionCall: {
                      name: "search",
                      args: { query: "cats" },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 20 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      const response = await provider.complete(requestWithTools);

      expect(response.stop_reason).toBe("tool_use");
      expect(response.content).toHaveLength(2);
      expect(response.content[0]).toEqual({ type: "text", text: "Searching..." });
      expect(response.content[1]).toEqual({
        type: "tool_use",
        id: "gemini-00000000-0000-0000-0000-000000000000",
        name: "search",
        input: { query: "cats" },
      });
    });

    it("handles functionCall with null args", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "get_status",
                      args: null,
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 10 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      const response = await provider.complete(simpleRequest);

      expect(response.content[0]).toEqual({
        type: "tool_use",
        id: "gemini-00000000-0000-0000-0000-000000000000",
        name: "get_status",
        input: {},
      });
    });

    it("converts tools to Gemini function declarations", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete(requestWithTools);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.tools).toEqual([
        {
          functionDeclarations: [
            {
              name: "search",
              description: "Search the web",
              parameters: {
                type: "OBJECT",
                properties: {
                  query: { type: "STRING", description: "search query" },
                },
                required: ["query"],
              },
            },
          ],
        },
      ]);
    });

    it("converts structured messages with tool_use and tool_result", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "Got it" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete(requestWithStructuredMessages);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const contents = callArgs.contents;

      // assistant (model) message with functionCall
      expect(contents[0].role).toBe("model");
      expect(contents[0].parts).toEqual([
        { text: "I'll search for that." },
        { functionCall: { name: "search", args: { query: "cats" } } },
      ]);

      // user message with functionResponse
      expect(contents[1].role).toBe("user");
      expect(contents[1].parts).toEqual([
        {
          functionResponse: {
            name: "tool-1",
            response: { result: "Found 10 results about cats" },
          },
        },
      ]);
    });

    it("throws on empty candidates", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "Gemini: empty response",
      );
    });

    it("throws on null candidates", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: null,
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "Gemini: empty response",
      );
    });

    it("defaults usage to 0 when usageMetadata missing", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: undefined,
        },
      });

      const provider = new GeminiProvider("gm-test");
      const response = await provider.complete(simpleRequest);
      expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    });

    it("uses provided model instead of default", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete({ ...simpleRequest, model: "gemini-2.5-pro" });

      expect(mockGetGenerativeModel).toHaveBeenCalledWith({
        model: "gemini-2.5-pro",
      });
    });

    it("passes generation config (maxOutputTokens and temperature)", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete({
        ...simpleRequest,
        max_tokens: 2048,
        temperature: 0.7,
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.generationConfig).toEqual({
        maxOutputTokens: 2048,
        temperature: 0.7,
      });
    });

    it("does not include temperature in config when not provided", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete(simpleRequest);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      expect(callArgs.generationConfig).toEqual({
        maxOutputTokens: 4096,
      });
    });

    it("converts complex nested tool schemas", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        },
      });

      const complexTool: LlmTool = {
        name: "create_item",
        description: "Create an item",
        input_schema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Item name" },
            count: { type: "integer", description: "Count" },
            active: { type: "boolean", description: "Is active" },
            tags: {
              type: "array",
              description: "Tags",
              items: { type: "string" },
            },
            metadata: {
              type: "object",
              description: "Metadata",
              properties: {
                source: { type: "string", description: "Source" },
              },
              required: ["source"],
            },
          },
          required: ["name"],
        },
      };

      const provider = new GeminiProvider("gm-test");
      await provider.complete({
        messages: [{ role: "user", content: "create it" }],
        tools: [complexTool],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const fnDecl = callArgs.tools[0].functionDeclarations[0];

      expect(fnDecl.parameters.properties.name).toEqual({
        type: "STRING",
        description: "Item name",
      });
      expect(fnDecl.parameters.properties.count).toEqual({
        type: "INTEGER",
        description: "Count",
      });
      expect(fnDecl.parameters.properties.active).toEqual({
        type: "BOOLEAN",
        description: "Is active",
      });
      expect(fnDecl.parameters.properties.tags).toEqual({
        type: "ARRAY",
        description: "Tags",
        items: { type: "STRING", description: undefined },
      });
      expect(fnDecl.parameters.properties.metadata).toEqual({
        type: "OBJECT",
        description: "Metadata",
        properties: {
          source: { type: "STRING", description: "Source" },
        },
        required: ["source"],
      });
    });

    it("maps unknown type to STRING in schema conversion", async () => {
      mockGenerateContent.mockResolvedValueOnce({
        response: {
          candidates: [
            {
              content: { parts: [{ text: "ok" }] },
            },
          ],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
        },
      });

      const provider = new GeminiProvider("gm-test");
      await provider.complete({
        messages: [{ role: "user", content: "test" }],
        tools: [
          {
            name: "test_tool",
            description: "Test",
            input_schema: {
              type: "object",
              properties: {
                field: { type: "custom_type" as unknown as string, description: "Unknown type" },
              },
              required: [],
            },
          },
        ],
      });

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const fieldDef = callArgs.tools[0].functionDeclarations[0].parameters.properties.field;
      expect(fieldDef.type).toBe("STRING");
    });

    it("propagates API errors", async () => {
      mockGenerateContent.mockRejectedValueOnce(new Error("Quota exceeded"));

      const provider = new GeminiProvider("gm-test");
      await expect(provider.complete(simpleRequest)).rejects.toThrow("Quota exceeded");
    });
  });
});
