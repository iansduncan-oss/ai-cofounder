import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { mockSharedModule } from "@ai-cofounder/test-utils";
import { mockDbModule } from "@ai-cofounder/test-utils";

vi.mock("@ai-cofounder/shared", () => mockSharedModule());

const mockCreateFollowUp = vi.fn().mockResolvedValue({ id: "fu-1", title: "Test", status: "pending", createdAt: new Date().toISOString() });
const mockGetFollowUp = vi.fn().mockResolvedValue(null);
const mockListFollowUps = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockUpdateFollowUp = vi.fn().mockResolvedValue(null);
const mockDeleteFollowUp = vi.fn().mockResolvedValue(null);
const mockListDueFollowUps = vi.fn().mockResolvedValue([]);
const mockMarkFollowUpReminderSent = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createFollowUp: (...args: unknown[]) => mockCreateFollowUp(...args),
  getFollowUp: (...args: unknown[]) => mockGetFollowUp(...args),
  listFollowUps: (...args: unknown[]) => mockListFollowUps(...args),
  updateFollowUp: (...args: unknown[]) => mockUpdateFollowUp(...args),
  deleteFollowUp: (...args: unknown[]) => mockDeleteFollowUp(...args),
  listDueFollowUps: (...args: unknown[]) => mockListDueFollowUps(...args),
  markFollowUpReminderSent: (...args: unknown[]) => mockMarkFollowUpReminderSent(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn();
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    getStatsSnapshots = vi.fn().mockReturnValue([]);
  }
  return { LlmRegistry: MockLlmRegistry, AnthropicProvider: class {}, GroqProvider: class {}, OpenRouterProvider: class {}, GeminiProvider: class {},
    OllamaProvider: class {},
    TogetherProvider: class {},
    CerebrasProvider: class {},
    HuggingFaceProvider: class {}, createEmbeddingService: vi.fn() };
});

vi.mock("@ai-cofounder/queue", () => ({
  RedisPubSub: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(),
    publish: vi.fn(),
    close: vi.fn(),
  })),
  setupRecurringJobs: vi.fn(),
  getMonitoringQueue: vi.fn().mockReturnValue({ add: vi.fn(), upsertJobScheduler: vi.fn() }),
  getNotificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getAgentTaskQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getBriefingQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getPipelineQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getRagIngestionQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getReflectionQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getSubagentTaskQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getDeployVerificationQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getDeadLetterQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getAutonomousSessionQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  getMeetingPrepQueue: vi.fn().mockReturnValue({ add: vi.fn() }),
  closeAllQueues: vi.fn(),
  listDeadLetterJobs: vi.fn().mockResolvedValue([]),
  enqueueRagIngestion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@ai-cofounder/sandbox", () => ({
  createSandboxService: vi.fn().mockReturnValue({ available: false }),
  hashCode: vi.fn().mockReturnValue("hash"),
}));

import { beforeAll } from "vitest";

const { buildServer } = await import("../server.js");

let app: Awaited<ReturnType<typeof buildServer>>["app"];

beforeAll(async () => {
  const server = await buildServer();
  app = server.app;
  await app.ready();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(async () => {
  if (app) await app.close();
});

describe("Follow-up Routes", () => {

  it("POST /api/follow-ups creates a follow-up", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/follow-ups",
      payload: { title: "Review PR", description: "Check #42", dueDate: "2025-01-20T09:00:00Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockCreateFollowUp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Review PR", description: "Check #42" }),
    );
  });

  it("GET /api/follow-ups lists follow-ups", async () => {
    mockListFollowUps.mockResolvedValueOnce({ data: [{ id: "fu-1", title: "Test" }], total: 1 });
    const res = await app.inject({ method: "GET", url: "/api/follow-ups?status=pending" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(mockListFollowUps).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "pending" }));
  });

  it("GET /api/follow-ups/:id returns a follow-up", async () => {
    mockGetFollowUp.mockResolvedValueOnce({ id: "fu-1", title: "Test", status: "pending" });
    const res = await app.inject({ method: "GET", url: "/api/follow-ups/fu-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Test");
  });

  it("GET /api/follow-ups/:id returns 404 when not found", async () => {
    mockGetFollowUp.mockResolvedValueOnce(null);
    const res = await app.inject({ method: "GET", url: "/api/follow-ups/missing" });
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /api/follow-ups/:id updates a follow-up", async () => {
    mockUpdateFollowUp.mockResolvedValueOnce({ id: "fu-1", title: "Updated", status: "done" });
    const res = await app.inject({
      method: "PATCH",
      url: "/api/follow-ups/fu-1",
      payload: { status: "done" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockUpdateFollowUp).toHaveBeenCalledWith(expect.anything(), "fu-1", expect.objectContaining({ status: "done" }));
  });

  it("PATCH /api/follow-ups/:id returns 404 when not found", async () => {
    mockUpdateFollowUp.mockResolvedValueOnce(null);
    const res = await app.inject({
      method: "PATCH",
      url: "/api/follow-ups/missing",
      payload: { status: "done" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/follow-ups/:id deletes a follow-up", async () => {
    mockDeleteFollowUp.mockResolvedValueOnce({ id: "fu-1" });
    const res = await app.inject({ method: "DELETE", url: "/api/follow-ups/fu-1" });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("DELETE /api/follow-ups/:id returns 404 when not found", async () => {
    mockDeleteFollowUp.mockResolvedValueOnce(null);
    const res = await app.inject({ method: "DELETE", url: "/api/follow-ups/missing" });
    expect(res.statusCode).toBe(404);
  });
});

describe("Follow-up Tool", () => {
  it("CREATE_FOLLOW_UP_TOOL has correct schema", async () => {
    const { CREATE_FOLLOW_UP_TOOL } = await import("../agents/tools/follow-up-tools.js");
    expect(CREATE_FOLLOW_UP_TOOL.name).toBe("create_follow_up");
    expect(CREATE_FOLLOW_UP_TOOL.input_schema.required).toEqual(["title"]);
    expect(CREATE_FOLLOW_UP_TOOL.input_schema.properties).toHaveProperty("title");
    expect(CREATE_FOLLOW_UP_TOOL.input_schema.properties).toHaveProperty("due_date");
  });

  it("buildSharedToolList includes create_follow_up when db available", async () => {
    const { buildSharedToolList } = await import("../agents/tool-executor.js");
    const tools = buildSharedToolList({ db: {} as never });
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_follow_up");
  });

  it("executeSharedTool handles create_follow_up", async () => {
    const { executeSharedTool } = await import("../agents/tool-executor.js");
    const result = await executeSharedTool(
      { type: "tool_use", id: "t1", name: "create_follow_up", input: { title: "Test FU" } },
      { db: {} as never },
      { conversationId: "conv-1" },
    );
    expect(result).toHaveProperty("created", true);
    expect(mockCreateFollowUp).toHaveBeenCalled();
  });
});

describe("Follow-up Reminders", () => {
  it("listDueFollowUps + markFollowUpReminderSent are exported from db mock", async () => {
    const db = await import("@ai-cofounder/db");
    expect(typeof (db as Record<string, unknown>).listDueFollowUps).toBe("function");
    expect(typeof (db as Record<string, unknown>).markFollowUpReminderSent).toBe("function");
  });
});
