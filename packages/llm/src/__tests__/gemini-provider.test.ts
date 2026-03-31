import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock the Gemini SDK ─────────────────────────────────────────────
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

vi.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
      getGenerativeModel: mockGetGenerativeModel,
    })),
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

import { GeminiProvider } from "../providers/gemini.js";
import type { LlmCompletionRequest } from "../types.js";

describe("GeminiProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────────

  it("sets name to 'gemini' and correct default model", () => {
    const provider = new GeminiProvider("test-key");
    expect(provider.name).toBe("gemini");
    expect(provider.defaultModel).toBe("gemini-2.5-flash");
  });

  it("allows overriding the default model", () => {
    const provider = new GeminiProvider("test-key", "gemini-2.5-pro");
    expect(provider.defaultModel).toBe("gemini-2.5-pro");
  });

  it("marks available=true when API key is provided", () => {
    const provider = new GeminiProvider("test-key");
    expect(provider.available).toBe(true);
  });

  it("marks available=false when API key is undefined", () => {
    const provider = new GeminiProvider(undefined);
    expect(provider.available).toBe(false);
  });

  // ── complete() — not configured ───────────────────────────────────

  it("throws when client is not configured", async () => {
    const provider = new GeminiProvider(undefined);
    await expect(
      provider.complete({ messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toThrow("Gemini provider not configured");
  });

  // ── complete() — simple text response ─────────────────────────────

  it("returns a text response correctly", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [{ text: "Hello from Gemini!" }],
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 8,
        },
      },
    });

    const result = await provider.complete({
      system: "Be helpful",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result.content).toEqual([{ type: "text", text: "Hello from Gemini!" }]);
    expect(result.model).toBe("gemini-2.5-flash");
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(12);
    expect(result.usage.outputTokens).toBe(8);

    // Verify system instruction was passed to getGenerativeModel
    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ systemInstruction: "Be helpful" }),
    );
  });

  // ── complete() — function call response ───────────────────────────

  it("returns a tool use response with correct stop_reason", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "search_web", args: { query: "vitest" } } },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      },
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "Search vitest" }],
      tools: [
        {
          name: "search_web",
          description: "Search the web",
          input_schema: {
            type: "object",
            properties: { query: { type: "string", description: "Query" } },
            required: ["query"],
          },
        },
      ],
    });

    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({
      type: "tool_use",
      name: "search_web",
      input: { query: "vitest" },
    });
    // ID should be generated with gemini- prefix
    expect((result.content[0] as { id: string }).id).toMatch(/^gemini-/);
  });

  // ── Message format conversion ─────────────────────────────────────

  it("converts messages with structured content blocks to Gemini format", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: "OK" }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
      },
    });

    const request: LlmCompletionRequest = {
      messages: [
        { role: "user", content: "Use a tool" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Calling tool." },
            { type: "tool_use", id: "t1", name: "search", input: { q: "test" } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "search", content: "result data" },
          ],
        },
      ],
    };

    await provider.complete(request);

    const contents = mockGenerateContent.mock.calls[0][0].contents;

    // First message: user with simple text
    expect(contents[0]).toEqual({ role: "user", parts: [{ text: "Use a tool" }] });

    // Second message: assistant (model) with text + functionCall
    expect(contents[1].role).toBe("model");
    expect(contents[1].parts).toEqual([
      { text: "Calling tool." },
      { functionCall: { name: "search", args: { q: "test" } } },
    ]);

    // Third message: user with functionResponse
    expect(contents[2].role).toBe("user");
    expect(contents[2].parts).toEqual([
      { functionResponse: { name: "search", response: { result: "result data" } } },
    ]);
  });

  // ── Tool schema conversion ────────────────────────────────────────

  it("converts tool schemas with nested properties and arrays", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: "Done" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      },
    });

    const request: LlmCompletionRequest = {
      messages: [{ role: "user", content: "test" }],
      tools: [
        {
          name: "complex_tool",
          description: "A complex tool",
          input_schema: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name" },
              count: { type: "integer", description: "Count" },
              tags: {
                type: "array",
                description: "Tags",
                items: { type: "string", description: "Tag" },
              },
              config: {
                type: "object",
                description: "Config",
                properties: {
                  enabled: { type: "boolean", description: "Enabled" },
                },
                required: ["enabled"],
              },
            },
            required: ["name"],
          },
        },
      ],
    };

    await provider.complete(request);

    const tools = mockGenerateContent.mock.calls[0][0].tools;
    const decl = tools[0].functionDeclarations[0];

    expect(decl.name).toBe("complex_tool");
    expect(decl.parameters.type).toBe("OBJECT");
    expect(decl.parameters.properties.name.type).toBe("STRING");
    expect(decl.parameters.properties.count.type).toBe("INTEGER");
    expect(decl.parameters.properties.tags.type).toBe("ARRAY");
    expect(decl.parameters.properties.tags.items.type).toBe("STRING");
    expect(decl.parameters.properties.config.type).toBe("OBJECT");
    expect(decl.parameters.properties.config.properties.enabled.type).toBe("BOOLEAN");
  });

  // ── Empty response ────────────────────────────────────────────────

  it("throws on empty response with no candidates", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 0 },
      },
    });

    await expect(
      provider.complete({ messages: [{ role: "user", content: "test" }] }),
    ).rejects.toThrow("Gemini: empty response");
  });

  // ── Usage metadata defaults to 0 when missing ────────────────────

  it("defaults usage to 0 when usageMetadata is missing", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: "Hi" }] } }],
      },
    });

    const result = await provider.complete({
      messages: [{ role: "user", content: "test" }],
    });

    expect(result.usage.inputTokens).toBe(0);
    expect(result.usage.outputTokens).toBe(0);
  });

  // ── Custom model ──────────────────────────────────────────────────

  it("uses request model override over default", async () => {
    const provider = new GeminiProvider("test-key");

    mockGenerateContent.mockResolvedValue({
      response: {
        candidates: [{ content: { parts: [{ text: "Hi" }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 },
      },
    });

    const result = await provider.complete({
      model: "gemini-2.5-pro",
      messages: [{ role: "user", content: "test" }],
    });

    expect(mockGetGenerativeModel).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-2.5-pro" }),
    );
    expect(result.model).toBe("gemini-2.5-pro");
  });
});
