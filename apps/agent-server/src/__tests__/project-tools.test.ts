import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// Mock standard packages before importing the module under test
vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
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
  }
  return { LlmRegistry: MockLlmRegistry };
});

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("../services/notifications.js", () => ({
  notifyApprovalCreated: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@ai-cofounder/queue", () => ({
  enqueueRagIngestion: vi.fn().mockResolvedValue(undefined),
}));

import {
  createRegisteredProject,
  getRegisteredProjectByName,
  updateConversationMetadata,
  listProjectDependencies,
  getRegisteredProjectById,
} from "@ai-cofounder/db";
import { executeSharedTool, type ToolExecutorServices, type ToolExecutorContext } from "../agents/tool-executor.js";

describe("project tools", () => {
  const mockDb = {} as ReturnType<typeof import("@ai-cofounder/db").createDb>;

  const mockProjectRegistryService = {
    validateProjectPath: vi.fn().mockReturnValue(true),
    registerProject: vi.fn().mockResolvedValue(undefined),
    listProjects: vi.fn().mockReturnValue([]),
    getActiveProject: vi.fn().mockReturnValue(undefined),
    getWorkspace: vi.fn().mockReturnValue(undefined),
    loadFromDb: vi.fn().mockResolvedValue(undefined),
  };

  const mockMonitoringService = {
    checkVPSHealth: vi.fn().mockResolvedValue({
      diskUsagePercent: 45.2,
      memoryUsagePercent: 62.5,
      cpuLoadAvg: [0.5, 0.6, 0.7],
      uptime: "up 3 days",
      containers: [
        { name: "ai-cofounder", status: "Up 2 hours (healthy)", health: "healthy", uptime: "Up 2 hours" },
        { name: "postgres", status: "Up 3 days (healthy)", health: "healthy", uptime: "Up 3 days", cpuPercent: 1.2, memUsage: "256MiB / 1GiB", memPercent: 25.0 },
      ],
    }),
    isVPSConfigured: vi.fn().mockReturnValue(true),
    checkGitHubCI: vi.fn().mockResolvedValue([]),
    checkGitHubPRs: vi.fn().mockResolvedValue([]),
    runFullCheck: vi.fn().mockResolvedValue({ timestamp: new Date().toISOString(), alerts: [] }),
  };

  const baseServices: ToolExecutorServices = {
    db: mockDb,
    projectRegistryService: mockProjectRegistryService as unknown as ToolExecutorServices["projectRegistryService"],
    monitoringService: mockMonitoringService as unknown as ToolExecutorServices["monitoringService"],
  };

  const baseContext: ToolExecutorContext = {
    conversationId: "conv-123",
    userId: "user-1",
    agentRole: "orchestrator",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mocks to defaults
    mockProjectRegistryService.validateProjectPath.mockReturnValue(true);
    mockProjectRegistryService.listProjects.mockReturnValue([]);
    vi.mocked(createRegisteredProject).mockResolvedValue({
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
    });
    vi.mocked(getRegisteredProjectByName).mockResolvedValue(null);
    vi.mocked(updateConversationMetadata).mockResolvedValue({ id: "conv-123" } as ReturnType<typeof import("@ai-cofounder/db").createConversation> extends Promise<infer T> ? T : never);
    vi.mocked(listProjectDependencies).mockResolvedValue([]);
    vi.mocked(getRegisteredProjectById).mockResolvedValue(null);
  });

  // ── register_project tests ──

  describe("register_project", () => {
    it("creates a DB record and registers with ProjectRegistryService", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t1",
          name: "register_project",
          input: {
            name: "Test Project",
            workspace_path: "/tmp/test-project",
            language: "typescript",
          },
        },
        baseServices,
        baseContext,
      );

      expect(createRegisteredProject).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({
          name: "Test Project",
          slug: "test-project",
          workspacePath: "/tmp/test-project",
          language: "typescript",
        }),
      );
      expect(mockProjectRegistryService.registerProject).toHaveBeenCalledWith(
        expect.objectContaining({ id: "proj-1", name: "Test Project" }),
      );
      const r = result as Record<string, unknown>;
      expect(r.projectId).toBe("proj-1");
      expect(r.slug).toBe("test-project");
    });

    it("rejects paths outside allowed base directories", async () => {
      mockProjectRegistryService.validateProjectPath.mockReturnValue(false);

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t2",
          name: "register_project",
          input: {
            name: "Bad Project",
            workspace_path: "/etc/passwd",
          },
        },
        baseServices,
        baseContext,
      );

      const r = result as Record<string, unknown>;
      expect(r.error).toContain("outside allowed base directories");
      expect(createRegisteredProject).not.toHaveBeenCalled();
    });
  });

  // ── switch_project tests ──

  describe("switch_project", () => {
    it("updates conversation metadata with activeProjectId on success", async () => {
      vi.mocked(getRegisteredProjectByName).mockResolvedValue({
        id: "proj-1",
        name: "AI Cofounder",
        slug: "ai-cofounder",
        workspacePath: "/opt/ai-cofounder",
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
      });

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t3",
          name: "switch_project",
          input: { project_name: "AI Cofounder" },
        },
        baseServices,
        baseContext,
      );

      expect(getRegisteredProjectByName).toHaveBeenCalledWith(mockDb, "AI Cofounder");
      expect(updateConversationMetadata).toHaveBeenCalledWith(
        mockDb,
        "conv-123",
        { activeProjectId: "proj-1" },
      );
      const r = result as Record<string, unknown>;
      expect(r.switched).toBe(true);
      expect(r.projectId).toBe("proj-1");
    });

    it("returns error when project is not found", async () => {
      vi.mocked(getRegisteredProjectByName).mockResolvedValue(null);
      mockProjectRegistryService.listProjects.mockReturnValue([
        { id: "p2", name: "Other Project", slug: "other", language: "python", workspacePath: "/tmp/other" },
      ]);

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t4",
          name: "switch_project",
          input: { project_name: "Non Existent" },
        },
        baseServices,
        baseContext,
      );

      const r = result as Record<string, unknown>;
      expect(r.error).toContain("Non Existent");
      expect(updateConversationMetadata).not.toHaveBeenCalled();
    });
  });

  // ── list_projects tests ──

  describe("list_projects", () => {
    it("returns formatted project list from registry", async () => {
      mockProjectRegistryService.listProjects.mockReturnValue([
        {
          id: "proj-1",
          name: "AI Cofounder",
          slug: "ai-cofounder",
          language: "typescript",
          workspacePath: "/opt/ai-cofounder",
          description: "Main monorepo",
          defaultBranch: "main",
        },
        {
          id: "proj-2",
          name: "Clip Automation",
          slug: "clip-automation",
          language: "python",
          workspacePath: "/opt/clip",
          description: "Clip tool",
          defaultBranch: "main",
        },
      ]);

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t5",
          name: "list_projects",
          input: {},
        },
        baseServices,
        baseContext,
      );

      const r = result as { count: number; projects: unknown[] };
      expect(r.count).toBe(2);
      expect(r.projects).toHaveLength(2);
      expect((r.projects[0] as Record<string, unknown>).name).toBe("AI Cofounder");
    });
  });

  // ── analyze_cross_project_impact tests ──

  describe("analyze_cross_project_impact", () => {
    it("returns dependency map for the specified project", async () => {
      vi.mocked(getRegisteredProjectByName).mockResolvedValue({
        id: "proj-1",
        name: "AI Cofounder",
        slug: "ai-cofounder",
        workspacePath: "/opt/ai-cofounder",
        repoUrl: null,
        description: "Main system",
        language: "typescript",
        defaultBranch: "main",
        testCommand: null,
        isActive: true,
        config: null,
        lastIngestedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      vi.mocked(listProjectDependencies).mockResolvedValue([
        {
          id: "dep-1",
          sourceProjectId: "proj-2",
          targetProjectId: "proj-1",
          dependencyType: "api_client",
          description: "Uses REST API",
          createdAt: new Date(),
        },
      ]);
      vi.mocked(getRegisteredProjectById).mockResolvedValue({
        id: "proj-2",
        name: "Discord Bot",
        slug: "discord-bot",
        workspacePath: "/opt/discord-bot",
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
      });

      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t6",
          name: "analyze_cross_project_impact",
          input: {
            project_name: "AI Cofounder",
            change_description: "Breaking change to /api/agents/run",
          },
        },
        baseServices,
        baseContext,
      );

      const r = result as Record<string, unknown>;
      expect(r.dependency_count).toBe(1);
      expect((r.project as Record<string, unknown>).name).toBe("AI Cofounder");
      const deps = r.dependencies as Array<Record<string, unknown>>;
      expect(deps[0].targetProjectName).toBe("Discord Bot");
      expect(deps[0].dependencyType).toBe("api_client");
    });
  });

  // ── query_vps tests ──

  describe("query_vps", () => {
    it("returns VPS health data including container stats", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t7",
          name: "query_vps",
          input: { include_stats: true },
        },
        baseServices,
        baseContext,
      );

      expect(mockMonitoringService.checkVPSHealth).toHaveBeenCalled();
      const r = result as Record<string, unknown>;
      expect(r.diskUsagePercent).toBe(45.2);
      const containers = r.containers as Array<Record<string, unknown>>;
      expect(containers.length).toBeGreaterThan(0);
      expect(containers[1].cpuPercent).toBe(1.2);
      expect(containers[1].memPercent).toBe(25.0);
    });

    it("returns error when monitoring service not available", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "t8",
          name: "query_vps",
          input: {},
        },
        { ...baseServices, monitoringService: undefined },
        baseContext,
      );

      const r = result as Record<string, unknown>;
      expect(r.error).toContain("Monitoring service not available");
    });
  });
});
