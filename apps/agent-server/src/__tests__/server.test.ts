import { describe, it, expect, vi, beforeAll } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// Set env before any imports that read it
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// Mock the DB package so tests don't need a real Postgres connection
vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
}));

// Mock the LLM package with a fake registry
vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock orchestrator response" }],
    model: "claude-sonnet-4-20250514",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "anthropic",
  });

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
    AnthropicProvider: class {
      constructor() {}
    },
    GroqProvider: class {
      constructor() {}
    },
    OpenRouterProvider: class {
      constructor() {}
    },
    GeminiProvider: class {
      constructor() {}
    },
    OllamaProvider: class {
      constructor() {}
    },
    TogetherProvider: class {
      constructor() {}
    },
    CerebrasProvider: class {
      constructor() {}
    },
    HuggingFaceProvider: class {
      constructor() {}
    },
    createEmbeddingService: vi.fn(),
  };
});

// Dynamic import after mocks are set up
const { buildServer } = await import("../server.js");

describe("agent-server", () => {
  describe("GET /health", () => {
    it("returns status ok", async () => {
      const { app } = buildServer();
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe("ok");
      expect(body.timestamp).toBeDefined();
      expect(typeof body.uptime).toBe("number");
    });
  });

  describe("POST /api/agents/run", () => {
    it("returns orchestrator response", async () => {
      const { app } = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "Hello, AI Cofounder" },
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.agentRole).toBe("orchestrator");
      expect(body.conversationId).toBeDefined();
      expect(body.response).toBe("Mock orchestrator response");
      expect(body.model).toBeDefined();
      expect(body.usage).toBeDefined();
    });

    it("preserves conversationId when provided", async () => {
      const { app } = buildServer();
      const conversationId = "test-conv-123";
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "test", conversationId },
      });
      await app.close();

      const body = response.json();
      expect(body.conversationId).toBe(conversationId);
    });

    it("returns 400 when message is missing", async () => {
      const { app } = buildServer();
      const response = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: {},
      });
      await app.close();

      expect(response.statusCode).toBe(400);
    });
  });
});
