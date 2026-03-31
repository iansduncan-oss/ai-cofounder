import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LlmCompletionRequest } from "../types.js";

/* ────────────────────────────────────────────────────────────
 *  Mock external SDKs
 * ────────────────────────────────────────────────────────── */

const mockAnthropicFinalMessage = vi.fn();
const mockStreamOn = vi.fn().mockReturnThis();
const mockStreamObj = { on: mockStreamOn, finalMessage: mockAnthropicFinalMessage };
const mockAnthropicStream = vi.fn(() => mockStreamObj);

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { stream: mockAnthropicStream };
      constructor(_opts: unknown) {}
    },
  };
});

/* ────────────────────────────────────────────────────────────
 *  Imports (after mocks)
 * ────────────────────────────────────────────────────────── */
import { AnthropicProvider } from "../providers/anthropic.js";

/* ────────────────────────────────────────────────────────────
 *  Helpers
 * ────────────────────────────────────────────────────────── */

const simpleRequest: LlmCompletionRequest = {
  messages: [{ role: "user", content: "Hello" }],
};

const textResponse = (overrides = {}) => ({
  content: [{ type: "text", text: "Hi there!" }],
  model: "claude-sonnet-4-20250514",
  stop_reason: "end_turn",
  usage: { input_tokens: 5, output_tokens: 8 },
  ...overrides,
});

/* ════════════════════════════════════════════════════════════
 *  AnthropicProvider — focused tests
 * ════════════════════════════════════════════════════════════ */

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the stream mock to return fresh object each time
    mockStreamOn.mockReturnThis();
  });

  describe("constructor", () => {
    it("sets name to 'anthropic' and uses default model", () => {
      const provider = new AnthropicProvider("sk-test");
      expect(provider.name).toBe("anthropic");
      expect(provider.defaultModel).toBe("claude-sonnet-4-20250514");
      expect(provider.available).toBe(true);
    });

    it("marks unavailable when API key is undefined", () => {
      const provider = new AnthropicProvider(undefined);
      expect(provider.available).toBe(false);
    });

    it("accepts a custom default model", () => {
      const provider = new AnthropicProvider("sk-test", "claude-opus-4-20250514");
      expect(provider.defaultModel).toBe("claude-opus-4-20250514");
    });
  });

  describe("complete() — text response", () => {
    it("returns mapped content for a simple text response", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);

      expect(response.content).toEqual([{ type: "text", text: "Hi there!" }]);
      expect(response.model).toBe("claude-sonnet-4-20250514");
      expect(response.stop_reason).toBe("end_turn");
      expect(response.usage).toEqual({ inputTokens: 5, outputTokens: 8 });
    });

    it("throws when provider is not configured", async () => {
      const provider = new AnthropicProvider(undefined);
      await expect(provider.complete(simpleRequest)).rejects.toThrow(
        "Anthropic provider not configured",
      );
    });
  });

  describe("complete() — tool use response", () => {
    it("maps tool_use content blocks and stop_reason correctly", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(
        textResponse({
          content: [
            { type: "text", text: "Let me search." },
            { type: "tool_use", id: "toolu_abc", name: "search", input: { query: "cats" } },
          ],
          stop_reason: "tool_use",
        }),
      );

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete({
        ...simpleRequest,
        tools: [
          {
            name: "search",
            description: "Search",
            input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
          },
        ],
      });

      expect(response.stop_reason).toBe("tool_use");
      expect(response.content).toHaveLength(2);
      expect(response.content[1]).toEqual({
        type: "tool_use",
        id: "toolu_abc",
        name: "search",
        input: { query: "cats" },
      });
    });
  });

  describe("complete() — thinking / extended thinking", () => {
    it("passes thinking parameter to the API when enabled", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(
        textResponse({
          content: [
            { type: "thinking", thinking: "Let me think...", signature: "sig-1" },
            { type: "text", text: "The answer is 42." },
          ],
        }),
      );

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete({
        ...simpleRequest,
        thinking: { type: "enabled", budget_tokens: 10000 },
      });

      // Verify thinking parameter was sent
      const callArgs = mockAnthropicStream.mock.calls[0][0];
      expect(callArgs.thinking).toEqual({ type: "enabled", budget_tokens: 10000 });

      // Verify max_tokens is budget_tokens + 8192
      expect(callArgs.max_tokens).toBe(10000 + 8192);

      // Verify thinking block is mapped
      expect(response.content[0]).toEqual({
        type: "thinking",
        thinking: "Let me think...",
        signature: "sig-1",
      });
    });

    it("omits temperature when thinking is enabled", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({
        ...simpleRequest,
        thinking: { type: "enabled", budget_tokens: 5000 },
        temperature: 0.7,
      });

      const callArgs = mockAnthropicStream.mock.calls[0][0];
      expect(callArgs).not.toHaveProperty("temperature");
      expect(callArgs.thinking).toBeDefined();
    });

    it("uses 300s timeout when thinking is enabled", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({
        ...simpleRequest,
        thinking: { type: "enabled", budget_tokens: 5000 },
      });

      const streamOpts = mockAnthropicStream.mock.calls[0][1];
      // The signal should be an AbortSignal — we verify it exists
      expect(streamOpts).toHaveProperty("signal");
      expect(streamOpts.signal).toBeInstanceOf(AbortSignal);
    });

    it("uses 120s timeout when thinking is not enabled", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete(simpleRequest);

      const streamOpts = mockAnthropicStream.mock.calls[0][1];
      expect(streamOpts).toHaveProperty("signal");
      expect(streamOpts.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("streaming callback", () => {
    it("registers onTextDelta callback on the stream 'text' event", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const textChunks: string[] = [];
      const onTextDelta = (text: string) => textChunks.push(text);

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({ ...simpleRequest, onTextDelta });

      // Verify stream.on("text", ...) was called
      expect(mockStreamOn).toHaveBeenCalledWith("text", expect.any(Function));

      // Simulate the callback being invoked
      const registeredCallback = mockStreamOn.mock.calls.find((c) => c[0] === "text")?.[1];
      expect(registeredCallback).toBeDefined();
      registeredCallback!("chunk1");
      registeredCallback!("chunk2");
      expect(textChunks).toEqual(["chunk1", "chunk2"]);
    });

    it("does not register callback when onTextDelta is not provided", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete(simpleRequest);

      // stream.on should not be called for "text"
      const textCalls = mockStreamOn.mock.calls.filter((c) => c[0] === "text");
      expect(textCalls).toHaveLength(0);
    });
  });

  describe("prompt caching with cache_control", () => {
    it("wraps system prompt with cache_control ephemeral", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({
        ...simpleRequest,
        system: "You are a helpful assistant.",
      });

      const callArgs = mockAnthropicStream.mock.calls[0][0];
      expect(callArgs.system).toEqual([
        { type: "text", text: "You are a helpful assistant.", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("sets cache_control on the last tool definition", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const tools = [
        {
          name: "tool_a",
          description: "First tool",
          input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
        },
        {
          name: "tool_b",
          description: "Second tool",
          input_schema: { type: "object" as const, properties: {}, required: [] as string[] },
        },
      ];

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({ ...simpleRequest, tools });

      const callArgs = mockAnthropicStream.mock.calls[0][0];
      // First tool should NOT have cache_control
      expect(callArgs.tools[0]).not.toHaveProperty("cache_control");
      // Last tool SHOULD have cache_control
      expect(callArgs.tools[1].cache_control).toEqual({ type: "ephemeral" });
    });

    it("includes cache token usage in the response", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(
        textResponse({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 2000,
            cache_read_input_tokens: 1500,
          },
        }),
      );

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);

      expect(response.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        cacheCreationInputTokens: 2000,
        cacheReadInputTokens: 1500,
      });
    });
  });

  describe("error handling", () => {
    it("propagates rate limit errors", async () => {
      mockAnthropicFinalMessage.mockRejectedValueOnce(new Error("Rate limit exceeded"));

      const provider = new AnthropicProvider("sk-test");
      await expect(provider.complete(simpleRequest)).rejects.toThrow("Rate limit exceeded");
    });

    it("propagates authentication errors", async () => {
      mockAnthropicFinalMessage.mockRejectedValueOnce(new Error("Invalid API key"));

      const provider = new AnthropicProvider("sk-test");
      await expect(provider.complete(simpleRequest)).rejects.toThrow("Invalid API key");
    });

    it("maps unknown stop_reason to 'unknown'", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(
        textResponse({ stop_reason: "content_filter" }),
      );

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("unknown");
    });

    it("maps null stop_reason to 'unknown'", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(
        textResponse({ stop_reason: null }),
      );

      const provider = new AnthropicProvider("sk-test");
      const response = await provider.complete(simpleRequest);
      expect(response.stop_reason).toBe("unknown");
    });
  });

  describe("message conversion", () => {
    it("converts thinking content blocks in messages", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "hmm...", signature: "sig-abc" },
              { type: "text", text: "I think..." },
            ],
          },
          { role: "user", content: "Continue" },
        ],
      });

      const callArgs = mockAnthropicStream.mock.calls[0][0];
      expect(callArgs.messages[0].content[0]).toEqual({
        type: "thinking",
        thinking: "hmm...",
        signature: "sig-abc",
      });
    });

    it("uses empty string for missing thinking signature", async () => {
      mockAnthropicFinalMessage.mockResolvedValueOnce(textResponse());

      const provider = new AnthropicProvider("sk-test");
      await provider.complete({
        messages: [
          {
            role: "assistant",
            content: [{ type: "thinking", thinking: "hmm..." }],
          },
          { role: "user", content: "Continue" },
        ],
      });

      const callArgs = mockAnthropicStream.mock.calls[0][0];
      expect(callArgs.messages[0].content[0].signature).toBe("");
    });
  });
});
