import { describe, it, expect, vi, beforeAll } from "vitest";

// Set env before any imports that read it
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// Mock the DB package so tests don't need a real Postgres connection
vi.mock("@ai-cofounder/db", () => {
  return {
    createDb: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
    }),
  };
});

// Mock the Anthropic SDK so tests don't make real API calls
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "Mock orchestrator response" }],
          model: "claude-sonnet-4-20250514",
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      };
    },
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
    it("returns orchestrator response from Claude", async () => {
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
