import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, ApiError } from "../client.js";

describe("ApiClient", () => {
  const originalFetch = globalThis.fetch;
  let client: ApiClient;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    client = new ApiClient({ baseUrl: "http://localhost:3100" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(response: { ok?: boolean; status?: number; body?: unknown }) {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: () => Promise.resolve(response.body ?? {}),
    });
  }

  function lastFetchCall() {
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    return { url: calls[calls.length - 1][0] as string, init: calls[calls.length - 1][1] as RequestInit };
  }

  describe("constructor", () => {
    it("strips trailing slash from baseUrl", () => {
      const c = new ApiClient({ baseUrl: "http://localhost:3100/" });
      mockFetch({ body: { status: "ok" } });
      c.health();
      expect(lastFetchCall().url).toBe("http://localhost:3100/health");
    });

    it("includes auth header when apiSecret provided", () => {
      const c = new ApiClient({ baseUrl: "http://localhost:3100", apiSecret: "s3cret" });
      mockFetch({ body: { status: "ok" } });
      c.health();
      expect(lastFetchCall().init.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer s3cret" }),
      );
    });
  });

  describe("error handling", () => {
    it("throws ApiError on non-ok response", async () => {
      mockFetch({ ok: false, status: 404, body: { error: "Not found" } });

      await expect(client.health()).rejects.toThrow(ApiError);
      await mockFetch({ ok: false, status: 404, body: { error: "Not found" } });
      try {
        await client.health();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).statusCode).toBe(404);
        expect((err as ApiError).message).toBe("Not found");
      }
    });

    it("falls back to statusText when response body has no error field", async () => {
      (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.reject(new Error("parse error")),
      });

      try {
        await client.health();
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).message).toBe("Internal Server Error");
      }
    });
  });

  describe("health", () => {
    it("calls GET /health", async () => {
      mockFetch({ body: { status: "ok", timestamp: "now", uptime: 3600 } });

      const result = await client.health();

      expect(lastFetchCall().url).toBe("http://localhost:3100/health");
      expect(lastFetchCall().init.method).toBe("GET");
      expect(result).toEqual({ status: "ok", timestamp: "now", uptime: 3600 });
    });
  });

  describe("providerHealth", () => {
    it("calls GET /health/providers", async () => {
      mockFetch({ body: { status: "ok", providers: [] } });
      await client.providerHealth();
      expect(lastFetchCall().url).toBe("http://localhost:3100/health/providers");
    });
  });

  describe("runAgent", () => {
    it("calls POST /api/agents/run with body", async () => {
      mockFetch({
        body: {
          conversationId: "c1",
          agentRole: "orchestrator",
          response: "Hi",
          model: "claude-sonnet",
        },
      });

      const result = await client.runAgent({ message: "hello", userId: "u1" });

      expect(lastFetchCall().url).toBe("http://localhost:3100/api/agents/run");
      expect(lastFetchCall().init.method).toBe("POST");
      expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
        message: "hello",
        userId: "u1",
      });
      expect(result.response).toBe("Hi");
    });
  });

  describe("goals", () => {
    it("creates a goal", async () => {
      mockFetch({ body: { id: "g1", title: "Build MVP" } });
      await client.createGoal({ conversationId: "c1", title: "Build MVP" });
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/goals");
      expect(lastFetchCall().init.method).toBe("POST");
    });

    it("gets a goal", async () => {
      mockFetch({ body: { id: "g1", title: "Build MVP" } });
      await client.getGoal("g1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/goals/g1");
    });

    it("lists goals by conversation", async () => {
      mockFetch({ body: [{ id: "g1" }] });
      await client.listGoals("c1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/goals?conversationId=c1");
    });

    it("updates goal status", async () => {
      mockFetch({ body: { id: "g1", status: "completed" } });
      await client.updateGoalStatus("g1", "completed");
      expect(lastFetchCall().init.method).toBe("PATCH");
      expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({ status: "completed" });
    });
  });

  describe("tasks", () => {
    it("creates a task", async () => {
      mockFetch({ body: { id: "t1" } });
      await client.createTask({ goalId: "g1", title: "Research" });
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/tasks");
      expect(lastFetchCall().init.method).toBe("POST");
    });

    it("lists pending tasks with default limit", async () => {
      mockFetch({ body: [] });
      await client.listPendingTasks();
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/tasks/pending?limit=50");
    });

    it("lists pending tasks with custom limit", async () => {
      mockFetch({ body: [] });
      await client.listPendingTasks(10);
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/tasks/pending?limit=10");
    });

    it("assigns a task", async () => {
      mockFetch({ body: { id: "t1" } });
      await client.assignTask("t1", "researcher");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/tasks/t1/assign");
      expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({ agent: "researcher" });
    });

    it("completes a task", async () => {
      mockFetch({ body: { id: "t1" } });
      await client.completeTask("t1", "Done");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/tasks/t1/complete");
    });

    it("fails a task", async () => {
      mockFetch({ body: { id: "t1" } });
      await client.failTask("t1", "Something broke");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/tasks/t1/fail");
    });
  });

  describe("execution", () => {
    it("executes a goal", async () => {
      mockFetch({ body: { goalId: "g1", status: "completed" } });
      await client.executeGoal("g1", { userId: "u1" });
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/goals/g1/execute");
      expect(lastFetchCall().init.method).toBe("POST");
    });

    it("gets progress", async () => {
      mockFetch({ body: { goalId: "g1", status: "in_progress" } });
      await client.getProgress("g1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/goals/g1/progress");
    });
  });

  describe("approvals", () => {
    it("creates an approval", async () => {
      mockFetch({ body: { id: "a1" } });
      await client.createApproval({ taskId: "t1", requestedBy: "orchestrator", reason: "Deploy" });
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/approvals");
      expect(lastFetchCall().init.method).toBe("POST");
    });

    it("gets an approval", async () => {
      mockFetch({ body: { id: "a1" } });
      await client.getApproval("a1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/approvals/a1");
    });

    it("lists pending approvals", async () => {
      mockFetch({ body: [] });
      await client.listPendingApprovals();
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/approvals/pending?limit=50");
    });

    it("resolves an approval", async () => {
      mockFetch({ body: { id: "a1", status: "approved" } });
      await client.resolveApproval("a1", { status: "approved", decision: "LGTM" });
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/approvals/a1/resolve");
      expect(lastFetchCall().init.method).toBe("PATCH");
      expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
        status: "approved",
        decision: "LGTM",
      });
    });
  });

  describe("memories", () => {
    it("lists memories", async () => {
      mockFetch({ body: [] });
      await client.listMemories("u1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/memories?userId=u1");
    });

    it("deletes a memory", async () => {
      mockFetch({ body: { deleted: true, id: "m1" } });
      await client.deleteMemory("m1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/memories/m1");
      expect(lastFetchCall().init.method).toBe("DELETE");
    });
  });

  describe("channels", () => {
    it("gets channel conversation", async () => {
      mockFetch({ body: { conversationId: "c1" } });
      await client.getChannelConversation("ch1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/channels/ch1/conversation");
    });

    it("sets channel conversation", async () => {
      mockFetch({ body: { conversationId: "c1" } });
      await client.setChannelConversation("ch1", "c1", "slack");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/channels/ch1/conversation");
      expect(lastFetchCall().init.method).toBe("PUT");
    });

    it("deletes channel conversation", async () => {
      mockFetch({ body: { deleted: true } });
      await client.deleteChannelConversation("ch1");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/channels/ch1/conversation");
      expect(lastFetchCall().init.method).toBe("DELETE");
    });
  });

  describe("users", () => {
    it("gets user by platform", async () => {
      mockFetch({ body: { id: "u1", displayName: "Test" } });
      await client.getUserByPlatform("slack", "U123");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/users/by-platform/slack/U123");
    });
  });

  describe("usage", () => {
    it("gets usage with default period", async () => {
      mockFetch({ body: { period: "today" } });
      await client.getUsage();
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/usage?period=today");
    });

    it("gets usage with custom period", async () => {
      mockFetch({ body: { period: "month" } });
      await client.getUsage("month");
      expect(lastFetchCall().url).toBe("http://localhost:3100/api/usage?period=month");
    });
  });
});

describe("ApiError", () => {
  it("has correct name and properties", () => {
    const err = new ApiError(404, "Not found");
    expect(err.name).toBe("ApiError");
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe("Not found");
    expect(err).toBeInstanceOf(Error);
  });
});
