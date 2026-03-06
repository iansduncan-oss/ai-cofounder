import { vi } from "vitest";

/**
 * Mock LlmRegistry class for use in vi.mock("@ai-cofounder/llm").
 * Accepts an optional mockComplete fn to control LLM responses in tests.
 */
export function createMockLlmRegistryClass(mockComplete = vi.fn()) {
  return class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  };
}

/** Pre-built MockLlmRegistry class with a default no-op complete fn */
export const MockLlmRegistry = createMockLlmRegistryClass();

/**
 * Returns the factory object for vi.mock("@ai-cofounder/llm").
 * Usage: `vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete))`
 */
export function mockLlmModule(mockComplete = vi.fn()) {
  return {
    LlmRegistry: createMockLlmRegistryClass(mockComplete),
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
  };
}

/** Build a text response from the LLM */
export function textResponse(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    model: "test-model",
    stop_reason: "end_turn" as const,
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  };
}

/** Build a tool_use response from the LLM */
export function toolUseResponse(name: string, input: Record<string, unknown>, id = "tu-1") {
  return {
    content: [{ type: "tool_use" as const, id, name, input }],
    model: "test-model",
    stop_reason: "tool_use" as const,
    usage: { inputTokens: 10, outputTokens: 10 },
    provider: "test",
  };
}
