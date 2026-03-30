import { describe, it, expect, vi, beforeEach } from "vitest";

describe("Provider Timeouts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe("AnthropicProvider", () => {
    it("passes timeout signal to client.messages.stream", async () => {
      const mockFinalMessage = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
        model: "claude-sonnet-4-20250514",
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 20 },
      });
      const mockStream = vi.fn(() => ({
        on: vi.fn().mockReturnThis(),
        finalMessage: mockFinalMessage,
      }));

      vi.doMock("@anthropic-ai/sdk", () => ({
        default: class {
          messages = { stream: mockStream };
        },
      }));

      const { AnthropicProvider } = await import("../providers/anthropic.js");
      const provider = new AnthropicProvider("test-key");

      await provider.complete({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(mockStream).toHaveBeenCalledTimes(1);
      const [, options] = mockStream.mock.calls[0];
      expect(options).toBeDefined();
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("OpenAICompatibleProvider", () => {
    it("passes timeout signal to client.chat.completions.create", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        choices: [{
          message: { content: "ok", tool_calls: null },
          finish_reason: "stop",
        }],
        model: "test-model",
        usage: { prompt_tokens: 10, completion_tokens: 20 },
      });

      vi.doMock("openai", () => ({
        default: class {
          chat = { completions: { create: mockCreate } };
        },
      }));

      const { OpenAICompatibleProvider } = await import("../providers/openai-compatible.js");
      const provider = new OpenAICompatibleProvider("groq", "test-key", "test-model", "https://api.groq.com/openai/v1");

      await provider.complete({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const [, options] = mockCreate.mock.calls[0];
      expect(options).toBeDefined();
      expect(options.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("GeminiProvider", () => {
    it("races generateContent against a 120s timeout", async () => {
      const mockGenerateContent = vi.fn().mockResolvedValue({
        response: {
          candidates: [{
            content: { parts: [{ text: "ok" }] },
          }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        },
      });

      vi.doMock("@google/generative-ai", () => ({
        GoogleGenerativeAI: class {
          getGenerativeModel() {
            return { generateContent: mockGenerateContent };
          }
        },
        SchemaType: { STRING: "STRING", NUMBER: "NUMBER", INTEGER: "INTEGER", BOOLEAN: "BOOLEAN", ARRAY: "ARRAY", OBJECT: "OBJECT" },
      }));

      const { GeminiProvider } = await import("../providers/gemini.js");
      const provider = new GeminiProvider("test-key");

      await provider.complete({
        messages: [{ role: "user", content: "hello" }],
      });

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it("rejects when generateContent exceeds timeout", async () => {
      vi.useFakeTimers();

      const neverResolve = new Promise(() => {});
      const mockGenerateContent = vi.fn().mockReturnValue(neverResolve);

      vi.doMock("@google/generative-ai", () => ({
        GoogleGenerativeAI: class {
          getGenerativeModel() {
            return { generateContent: mockGenerateContent };
          }
        },
        SchemaType: { STRING: "STRING", NUMBER: "NUMBER", INTEGER: "INTEGER", BOOLEAN: "BOOLEAN", ARRAY: "ARRAY", OBJECT: "OBJECT" },
      }));

      const { GeminiProvider } = await import("../providers/gemini.js");
      const provider = new GeminiProvider("test-key");

      const promise = provider.complete({
        messages: [{ role: "user", content: "hello" }],
      });

      // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection
      const assertion = expect(promise).rejects.toThrow("Gemini request timeout");
      await vi.advanceTimersByTimeAsync(120_001);
      await assertion;

      vi.useRealTimers();
    });
  });
});
