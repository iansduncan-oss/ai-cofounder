import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListPipelineTemplates = vi.fn().mockResolvedValue([]);
const mockGetPipelineTemplate = vi.fn().mockResolvedValue(null);
const mockGetPipelineTemplateByName = vi.fn().mockResolvedValue(null);
const mockCreatePipelineTemplate = vi.fn();
const mockUpdatePipelineTemplate = vi.fn();
const mockDeletePipelineTemplate = vi.fn();
const mockEnqueuePipeline = vi.fn().mockResolvedValue("job-123");

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listPipelineTemplates: (...args: unknown[]) => mockListPipelineTemplates(...args),
  getPipelineTemplate: (...args: unknown[]) => mockGetPipelineTemplate(...args),
  getPipelineTemplateByName: (...args: unknown[]) => mockGetPipelineTemplateByName(...args),
  createPipelineTemplate: (...args: unknown[]) => mockCreatePipelineTemplate(...args),
  updatePipelineTemplate: (...args: unknown[]) => mockUpdatePipelineTemplate(...args),
  deletePipelineTemplate: (...args: unknown[]) => mockDeletePipelineTemplate(...args),
}));

vi.mock("@ai-cofounder/queue", () => ({
  enqueuePipeline: (...args: unknown[]) => mockEnqueuePipeline(...args),
  getRedisConnection: vi.fn().mockReturnValue({}),
  createSubscriber: vi.fn().mockReturnValue({
    subscribe: vi.fn(),
    on: vi.fn(),
    quit: vi.fn(),
  }),
  RedisPubSub: class MockRedisPubSub {
    subscribe = vi.fn();
    publish = vi.fn();
    publishBroadcast = vi.fn();
    on = vi.fn();
    quit = vi.fn();
    close = vi.fn().mockResolvedValue(undefined);
    getAgentMessageHistory = vi.fn().mockResolvedValue([]);
  },
  startWorkers: vi.fn(),
  stopWorkers: vi.fn(),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn(),
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

const sampleTemplate = {
  id: UUID,
  name: "youtube-shorts",
  description: "YouTube Shorts pipeline",
  stages: [{ agent: "researcher", prompt: "Research trends", dependsOnPrevious: false }],
  defaultContext: { templateName: "youtube-shorts" },
  isActive: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockEnqueuePipeline.mockResolvedValue("job-123");
});

describe("pipeline templates CRUD", () => {
  it("GET /api/pipeline-templates — returns list of active templates", async () => {
    mockListPipelineTemplates.mockResolvedValueOnce([sampleTemplate]);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/pipeline-templates",
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("youtube-shorts");
    expect(mockListPipelineTemplates).toHaveBeenCalled();
  });

  it("GET /api/pipeline-templates/:id — returns single template", async () => {
    mockGetPipelineTemplate.mockResolvedValueOnce(sampleTemplate);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/pipeline-templates/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("youtube-shorts");
  });

  it("GET /api/pipeline-templates/:id — 404 when not found", async () => {
    mockGetPipelineTemplate.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/pipeline-templates/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("POST /api/pipeline-templates — creates new template", async () => {
    mockCreatePipelineTemplate.mockResolvedValueOnce(sampleTemplate);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/pipeline-templates",
      payload: {
        name: "youtube-shorts",
        stages: [{ agent: "researcher", prompt: "Research", dependsOnPrevious: false }],
      },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("youtube-shorts");
    expect(mockCreatePipelineTemplate).toHaveBeenCalled();
  });

  it("PATCH /api/pipeline-templates/:id — updates template", async () => {
    const updated = { ...sampleTemplate, description: "Updated description" };
    mockUpdatePipelineTemplate.mockResolvedValueOnce(updated);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/pipeline-templates/${UUID}`,
      payload: { description: "Updated description" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().description).toBe("Updated description");
  });

  it("PATCH /api/pipeline-templates/:id — 404 when not found", async () => {
    mockUpdatePipelineTemplate.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/pipeline-templates/${UUID}`,
      payload: { description: "ghost" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("DELETE /api/pipeline-templates/:id — deletes template", async () => {
    mockDeletePipelineTemplate.mockResolvedValueOnce(true);

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/pipeline-templates/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it("DELETE /api/pipeline-templates/:id — 404 when not found", async () => {
    mockDeletePipelineTemplate.mockResolvedValueOnce(false);

    const { app } = buildServer();
    const res = await app.inject({
      method: "DELETE",
      url: `/api/pipeline-templates/${UUID}`,
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

describe("pipeline template trigger", () => {
  it("POST /api/pipeline-templates/:name/trigger — enqueues pipeline and returns 202", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    mockGetPipelineTemplateByName.mockResolvedValueOnce(sampleTemplate);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/pipeline-templates/youtube-shorts/trigger",
      payload: { goalId: "goal-123" },
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    expect(body.template).toBe("youtube-shorts");
    expect(mockGetPipelineTemplateByName).toHaveBeenCalled();
    expect(mockEnqueuePipeline).toHaveBeenCalled();

    delete process.env.REDIS_URL;
  });

  it("POST /api/pipeline-templates/:name/trigger — 404 for unknown template", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    mockGetPipelineTemplateByName.mockResolvedValueOnce(null);

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/pipeline-templates/nonexistent/trigger",
      payload: {},
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);

    delete process.env.REDIS_URL;
  });

  it("POST /api/pipeline-templates/:name/trigger — 404 for inactive template", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    mockGetPipelineTemplateByName.mockResolvedValueOnce({ ...sampleTemplate, isActive: false });

    const { app } = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/pipeline-templates/youtube-shorts/trigger",
      payload: {},
      headers,
    });
    await app.close();

    expect(res.statusCode).toBe(404);

    delete process.env.REDIS_URL;
  });
});
