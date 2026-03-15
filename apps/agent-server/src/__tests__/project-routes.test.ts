import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockListRegisteredProjects = vi.fn();
const mockCreateRegisteredProject = vi.fn();
const mockGetRegisteredProjectById = vi.fn();
const mockUpdateRegisteredProject = vi.fn();
const mockDeleteRegisteredProject = vi.fn();
const mockCreateProjectDependency = vi.fn();
const mockListProjectDependencies = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  listRegisteredProjects: (...args: unknown[]) => mockListRegisteredProjects(...args),
  createRegisteredProject: (...args: unknown[]) => mockCreateRegisteredProject(...args),
  getRegisteredProjectById: (...args: unknown[]) => mockGetRegisteredProjectById(...args),
  updateRegisteredProject: (...args: unknown[]) => mockUpdateRegisteredProject(...args),
  deleteRegisteredProject: (...args: unknown[]) => mockDeleteRegisteredProject(...args),
  createProjectDependency: (...args: unknown[]) => mockCreateProjectDependency(...args),
  listProjectDependencies: (...args: unknown[]) => mockListProjectDependencies(...args),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "Mock response" }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 20 },
    provider: "test",
  });
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
    onCompletion: unknown = undefined;
    getStatsSnapshots = vi.fn().mockReturnValue([]);
    seedStats = vi.fn();
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn().mockReturnValue(undefined),
  };
});

vi.mock("@ai-cofounder/queue", () => ({
  enqueueSubagentTask: vi.fn().mockResolvedValue("job-1"),
  getAllQueueStatus: vi.fn().mockResolvedValue([]),
  getJobStatus: vi.fn().mockResolvedValue(null),
  pingRedis: vi.fn().mockResolvedValue(true),
  createPublisher: vi.fn().mockReturnValue({ publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), quit: vi.fn() }),
  RedisPubSub: vi.fn().mockImplementation(() => ({ publish: vi.fn(), subscribe: vi.fn(), quit: vi.fn() })),
  enqueueRagIngestion: vi.fn().mockResolvedValue(undefined),
  getQueueWorker: vi.fn(),
  startScheduledJobs: vi.fn(),
}));

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
  Chunker: vi.fn(),
  Ingester: vi.fn(),
}));

vi.mock("@ai-cofounder/sandbox", () => ({
  createSandboxService: vi.fn().mockReturnValue({ available: false }),
}));

vi.mock("../services/workspace.js", () => ({
  createWorkspaceService: vi.fn().mockReturnValue({}),
  WorkspaceService: vi.fn(),
}));

vi.mock("../services/notifications.js", () => ({
  createNotificationService: vi.fn().mockReturnValue({ sendBriefing: vi.fn(), sendAlert: vi.fn() }),
  notifyApprovalCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/monitoring.js", () => ({
  createMonitoringService: vi.fn().mockReturnValue({ checkVPSHealth: vi.fn().mockResolvedValue(null), isVPSConfigured: vi.fn().mockReturnValue(false), isGitHubConfigured: vi.fn().mockReturnValue(false), runFullCheck: vi.fn().mockResolvedValue({ alerts: [], timestamp: new Date().toISOString() }), checkGitHubCI: vi.fn().mockResolvedValue([]), checkGitHubPRs: vi.fn().mockResolvedValue([]) }),
}));

vi.mock("../services/tts.js", () => ({
  createTTSService: vi.fn().mockReturnValue({ synthesize: vi.fn(), stream: vi.fn() }),
}));

vi.mock("../services/n8n.js", () => ({
  createN8nService: vi.fn().mockReturnValue({ trigger: vi.fn() }),
}));

vi.mock("../plugins/project-registry.js", () => ({
  projectRegistryPlugin: vi.fn().mockImplementation(async (app: { decorate: (name: string, val: unknown) => void }) => {
    app.decorate("projectRegistry", {
      listProjects: vi.fn().mockReturnValue([]),
      getActiveProject: vi.fn().mockReturnValue(undefined),
      validateProjectPath: vi.fn().mockReturnValue(true),
      registerProject: vi.fn().mockResolvedValue(undefined),
      loadFromDb: vi.fn().mockResolvedValue(undefined),
    });
  }),
}));

const { buildServer } = await import("../server.js");

const testProject = {
  id: "proj-1",
  name: "Test Project",
  slug: "test-project",
  workspacePath: "/tmp/test-project",
  repoUrl: null,
  description: null,
  language: "typescript",
  defaultBranch: "main",
  testCommand: null,
  isActive: true,
  config: null,
  lastIngestedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("project routes", () => {
  let app: Awaited<ReturnType<typeof buildServer>>["app"];

  beforeAll(async () => {
    const server = buildServer();
    app = server.app;
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockListRegisteredProjects.mockResolvedValue([]);
    mockCreateRegisteredProject.mockResolvedValue(testProject);
    mockGetRegisteredProjectById.mockResolvedValue(null);
    mockUpdateRegisteredProject.mockResolvedValue(testProject);
    mockDeleteRegisteredProject.mockResolvedValue(testProject);
    mockCreateProjectDependency.mockResolvedValue({ id: "dep-1", sourceProjectId: "proj-1", targetProjectId: "proj-2", dependencyType: "api_client", description: null, createdAt: new Date() });
    mockListProjectDependencies.mockResolvedValue([]);
  });

  // ── GET /api/projects ──

  it("GET /api/projects returns 200 with array", async () => {
    mockListRegisteredProjects.mockResolvedValue([testProject]);

    const res = await app.inject({
      method: "GET",
      url: "/api/projects",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  // ── POST /api/projects ──

  it("POST /api/projects creates project and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        name: "Test Project",
        workspacePath: "/tmp/test-project",
        language: "typescript",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; name: string };
    expect(body.id).toBe("proj-1");
    expect(body.name).toBe("Test Project");
    expect(mockCreateRegisteredProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Test Project", slug: "test-project" }),
    );
  });

  it("POST /api/projects with missing name returns 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects",
      payload: {
        workspacePath: "/tmp/test",
        // name missing
      },
    });

    expect(res.statusCode).toBe(400);
  });

  // ── GET /api/projects/:id ──

  it("GET /api/projects/:id returns project when found", async () => {
    mockGetRegisteredProjectById.mockResolvedValue(testProject);

    const res = await app.inject({
      method: "GET",
      url: "/api/projects/proj-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { id: string };
    expect(body.id).toBe("proj-1");
  });

  it("GET /api/projects/:id returns 404 when not found", async () => {
    mockGetRegisteredProjectById.mockResolvedValue(null);

    const res = await app.inject({
      method: "GET",
      url: "/api/projects/nonexistent",
    });

    expect(res.statusCode).toBe(404);
  });

  // ── PUT /api/projects/:id ──

  it("PUT /api/projects/:id updates project", async () => {
    mockUpdateRegisteredProject.mockResolvedValue({ ...testProject, description: "Updated" });

    const res = await app.inject({
      method: "PUT",
      url: "/api/projects/proj-1",
      payload: { description: "Updated" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { description: string };
    expect(body.description).toBe("Updated");
  });

  // ── DELETE /api/projects/:id ──

  it("DELETE /api/projects/:id returns 200", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/api/projects/proj-1",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  // ── POST /api/projects/:id/dependencies ──

  it("POST /api/projects/:id/dependencies creates dependency and returns 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/projects/proj-1/dependencies",
      payload: {
        targetProjectId: "proj-2",
        dependencyType: "api_client",
        description: "Uses REST API",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { id: string; dependencyType: string };
    expect(body.dependencyType).toBe("api_client");
    expect(mockCreateProjectDependency).toHaveBeenCalled();
  });

  // ── GET /api/projects/:id/dependencies ──

  it("GET /api/projects/:id/dependencies returns array", async () => {
    mockListProjectDependencies.mockResolvedValue([
      { id: "dep-1", sourceProjectId: "proj-1", targetProjectId: "proj-2", dependencyType: "api_client", description: null, createdAt: new Date() },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/projects/proj-1/dependencies",
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });
});
