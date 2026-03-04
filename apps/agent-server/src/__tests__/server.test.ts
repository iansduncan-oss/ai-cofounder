import { describe, it, expect } from "vitest";
import { buildServer } from "../server.js";

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
    it("returns orchestrator stub response", async () => {
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
      expect(body.response).toContain("Hello, AI Cofounder");
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
  });
});
