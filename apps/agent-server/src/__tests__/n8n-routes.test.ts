import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.N8N_SHARED_SECRET = "test-secret";
});

const mockCreateN8nWorkflow = vi.fn();
const mockUpdateN8nWorkflow = vi.fn();
const mockGetN8nWorkflow = vi.fn();
const mockGetN8nWorkflowByName = vi.fn();
const mockListN8nWorkflows = vi.fn().mockResolvedValue([]);
const mockDeleteN8nWorkflow = vi.fn();
const mockFindN8nWorkflowByEvent = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1", externalId: "ext-1" }),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  getConversationMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  getGoal: vi.fn(),
  createGoal: vi.fn(),
  listGoalsByConversation: vi.fn().mockResolvedValue([]),
  updateGoalStatus: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  listTasksByGoal: vi.fn().mockResolvedValue([]),
  listPendingTasks: vi.fn().mockResolvedValue([]),
  assignTask: vi.fn(),
  startTask: vi.fn(),
  completeTask: vi.fn(),
  failTask: vi.fn(),
  createApproval: vi.fn(),
  getApproval: vi.fn(),
  listPendingApprovals: vi.fn().mockResolvedValue([]),
  listApprovalsByTask: vi.fn().mockResolvedValue([]),
  resolveApproval: vi.fn(),
  listMemoriesByUser: vi.fn().mockResolvedValue([]),
  deleteMemory: vi.fn(),
  getChannelConversation: vi.fn(),
  upsertChannelConversation: vi.fn(),
  findUserByPlatform: vi.fn(),
  getActivePrompt: vi.fn(),
  getActivePersona: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn().mockResolvedValue({ key: "test", category: "other" }),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  createN8nWorkflow: mockCreateN8nWorkflow,
  updateN8nWorkflow: mockUpdateN8nWorkflow,
  getN8nWorkflow: mockGetN8nWorkflow,
  getN8nWorkflowByName: mockGetN8nWorkflowByName,
  listN8nWorkflows: mockListN8nWorkflows,
  deleteN8nWorkflow: mockDeleteN8nWorkflow,
  findN8nWorkflowByEvent: mockFindN8nWorkflowByEvent,
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock response" }],
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
    seedStats = vi.fn();
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    onCompletion: unknown = undefined;
  }

  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

const { buildServer } = await import("../server.js");

const UUID = "00000000-0000-0000-0000-000000000001";
const headers = { "x-forwarded-for": "10.0.1.1" };

beforeEach(() => {
  vi.clearAllMocks();
});

/* ──────────────────── Workflow CRUD ──────────────────── */

describe("n8n workflow CRUD", () => {
  it("POST /api/n8n/workflows — creates workflow", async () => {
    const workflow = {
      id: UUID,
      name: "send-email",
      webhookUrl: "http://n8n:5678/webhook/email",
      direction: "outbound",
    };
    mockCreateN8nWorkflow.mockResolvedValueOnce(workflow);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/n8n/workflows",
      payload: { name: "send-email", webhookUrl: "http://n8n:5678/webhook/email" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("send-email");
    expect(mockCreateN8nWorkflow).toHaveBeenCalled();
  });

  it("POST /api/n8n/workflows — 400 without name", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/n8n/workflows",
      payload: { webhookUrl: "http://n8n:5678/webhook/email" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("GET /api/n8n/workflows — lists workflows", async () => {
    mockListN8nWorkflows.mockResolvedValueOnce([
      { id: UUID, name: "send-email", direction: "outbound" },
    ]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/n8n/workflows",
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("GET /api/n8n/workflows/:id — returns workflow", async () => {
    mockGetN8nWorkflow.mockResolvedValueOnce({
      id: UUID,
      name: "send-email",
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/n8n/workflows/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("send-email");
  });

  it("GET /api/n8n/workflows/:id — 404 when not found", async () => {
    mockGetN8nWorkflow.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/n8n/workflows/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("PATCH /api/n8n/workflows/:id — updates workflow", async () => {
    mockUpdateN8nWorkflow.mockResolvedValueOnce({
      id: UUID,
      name: "send-email-v2",
    });

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/n8n/workflows/${UUID}`,
      payload: { name: "send-email-v2" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("send-email-v2");
  });

  it("PATCH /api/n8n/workflows/:id — 404 when not found", async () => {
    mockUpdateN8nWorkflow.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/n8n/workflows/${UUID}`,
      payload: { name: "ghost" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/n8n/workflows/:id — deletes workflow", async () => {
    mockDeleteN8nWorkflow.mockResolvedValueOnce({ id: UUID });

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/n8n/workflows/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("DELETE /api/n8n/workflows/:id — 404 when not found", async () => {
    mockDeleteN8nWorkflow.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/n8n/workflows/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

/* ──────────────────── Inbound Webhook ──────────────────── */

describe("n8n inbound webhook", () => {
  it("POST /api/n8n/webhook — rejects without secret", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/n8n/webhook",
      payload: { message: "test" },
      headers: { ...headers, "x-n8n-secret": "wrong" },
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("POST /api/n8n/webhook — 400 without message", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/n8n/webhook",
      payload: {},
      headers: { ...headers, "x-n8n-secret": "test-secret" },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("POST /api/n8n/webhook — returns 202 in async mode", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/n8n/webhook",
      payload: { message: "New order received", event_type: "shopify.order" },
      headers: { ...headers, "x-n8n-secret": "test-secret" },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /api/n8n/webhook?sync=true — returns orchestrator result", async () => {
    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/n8n/webhook?sync=true",
      payload: { message: "What's our revenue?" },
      headers: { ...headers, "x-n8n-secret": "test-secret" },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().response).toBe("Mock response");
  });
});
