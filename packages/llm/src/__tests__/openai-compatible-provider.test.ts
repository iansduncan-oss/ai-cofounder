import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the OpenAI SDK ─────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
    })),
  };
});

import { OpenAICompatibleProvider } from "../providers/openai-compatible.js";
import { GroqProvider } from "../providers/groq.js";
import { OpenRouterProvider } from "../providers/openrouter.js";
import type { LlmCompletionRequest } from "../types.js";

describe("OpenAICompatibleProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────────

  it("sets name, default model, and available flag", () => {
    const provider = new OpenAICompatibleProvider(
      "test-provider",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );
    expect(provider.name).toBe("test-provider");
    expect(provider.defaultModel).toBe("model-1");
    expect(provider.available).toBe(true);
  });

  it("marks available=false when API key is undefined", () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      undefined,
      "model-1",
      "https://api.example.com/v1",
    );
    expect(provider.available).toBe(false);
  });

  // ── complete() — not configured ───────────────────────────────────

  it("throws when client is not configured", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      undefined,
      "model-1",
      "https://api.example.com/v1",
    );
    await expect(
      provider.complete({ messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("test provider not configured");
  });

  // ── complete() — simple text response ─────────────────────────────

  it("returns a text response and maps 'stop' to 'end_turn'", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Hello!", tool_calls: undefined },
          finish_reason: "stop",
        },
      ],
      model: "model-1",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const result = await provider.complete({
      system: "Be helpful.",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.content).toEqual([{ type: "text", text: "Hello!" }]);
    expect(result.model).toBe("model-1");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);

    // Verify system message is prepended
    const params = mockCreate.mock.calls[0][0];
    expect(params.messages[0]).toEqual({ role: "system", content: "Be helpful." });
    expect(params.messages[1]).toEqual({ role: "user", content: "Hello" });
  });

  // ── complete() — tool call response ───────────────────────────────

  it("returns tool use blocks and maps 'tool_calls' to 'tool_use'", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Searching...",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "search_web",
                  arguments: '{"query":"vitest"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      model: "model-1",
      usage: { prompt_tokens: 15, completion_tokens: 10 },
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Search for vitest" }],
      tools: [
        {
          name: "search_web",
          description: "Search",
          input_schema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      ],
    });

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toHaveLength(2); // text + tool_use
    expect(result.content[0]).toEqual({ type: "text", text: "Searching..." });
    expect(result.content[1]).toEqual({
      type: "tool_use",
      id: "call-1",
      name: "search_web",
      input: { query: "vitest" },
    });
  });

  // ── finish_reason mapping ─────────────────────────────────────────

  it("maps 'length' finish_reason to 'max_tokens'", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "Truncated..." },
          finish_reason: "length",
        },
      ],
      model: "model-1",
      usage: { prompt_tokens: 10, completion_tokens: 4096 },
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "test" }],
    });
    expect(result.stop_reason).toBe("max_tokens");
  });

  it("maps unknown finish_reason to 'unknown'", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: { content: "" },
          finish_reason: "content_filter",
        },
      ],
      model: "model-1",
      usage: { prompt_tokens: 1, completion_tokens: 0 },
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "test" }],
    });
    expect(result.stop_reason).toBe("unknown");
  });

  // ── Message format conversion — structured content ────────────────

  it("converts user tool_result blocks to 'tool' role messages", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [
        { message: { content: "Got it." }, finish_reason: "stop" },
      ],
      model: "model-1",
      usage: { prompt_tokens: 20, completion_tokens: 3 },
    });

    const request: LlmCompletionRequest = {
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me search." },
            { type: "tool_use", id: "tc-1", name: "search", input: { q: "test" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tc-1", content: "search results" },
          ],
        },
      ],
    };

    await provider.complete(request);

    const messages = mockCreate.mock.calls[0][0].messages;

    // Assistant message should have text content + tool_calls
    expect(messages[0].role).toBe("assistant");
    expect(messages[0].content).toBe("Let me search.");
    expect(messages[0].tool_calls).toEqual([
      {
        id: "tc-1",
        type: "function",
        function: { name: "search", arguments: '{"q":"test"}' },
      },
    ]);

    // Tool result message should use "tool" role
    expect(messages[1]).toEqual({
      role: "tool",
      tool_call_id: "tc-1",
      content: "search results",
    });
  });

  // ── Empty response ────────────────────────────────────────────────

  it("throws on empty response with no choices", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [],
      model: "model-1",
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    });

    await expect(
      provider.complete({ messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("test: empty response");
  });

  // ── Usage defaults to 0 when missing ──────────────────────────────

  it("defaults usage to 0 when usage is undefined", async () => {
    const provider = new OpenAICompatibleProvider(
      "test",
      "key-123",
      "model-1",
      "https://api.example.com/v1",
    );

    mockCreate.mockResolvedValue({
      choices: [
        { message: { content: "Hi" }, finish_reason: "stop" },
      ],
      model: "model-1",
      usage: undefined,
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });
});

// ── GroqProvider subclass ───────────────────────────────────────────

describe("GroqProvider", () => {
  it("has correct name, default model, and base URL", () => {
    const provider = new GroqProvider("groq-key");
    expect(provider.name).toBe("groq");
    expect(provider.defaultModel).toBe("llama-3.3-70b-versatile");
    expect(provider.available).toBe(true);
  });

  it("is unavailable without API key", () => {
    const provider = new GroqProvider(undefined);
    expect(provider.available).toBe(false);
  });
});

// ── OpenRouterProvider subclass ─────────────────────────────────────

describe("OpenRouterProvider", () => {
  it("has correct name, default model, and base URL", () => {
    const provider = new OpenRouterProvider("or-key");
    expect(provider.name).toBe("openrouter");
    expect(provider.defaultModel).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(provider.available).toBe(true);
  });

  it("is unavailable without API key", () => {
    const provider = new OpenRouterProvider(undefined);
    expect(provider.available).toBe(false);
  });
});
