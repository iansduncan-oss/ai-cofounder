import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// ── Mock @ai-cofounder/shared ──────────────────────────────────────────────────

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ── Mock @ai-cofounder/db ──────────────────────────────────────────────────────

const mockListRegisteredProjects = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listRegisteredProjects: (...args: unknown[]) => mockListRegisteredProjects(...args),
}));

// ── Mock node:fs/promises (WorkspaceService.init calls mkdir) ─────────────────

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(""),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
    rm: vi.fn().mockResolvedValue(undefined),
    rmdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
    stat: vi.fn().mockResolvedValue({ size: 0 }),
  };
});

// ── Import after mocks ─────────────────────────────────────────────────────────

const { ProjectRegistryService } = await import("../services/project-registry.js");

beforeEach(() => {
  vi.clearAllMocks();
  mockListRegisteredProjects.mockResolvedValue([]);
});

describe("ProjectRegistryService", () => {
  const allowedBase = "/tmp/ai-cofounder-workspace";

  describe("validateProjectPath", () => {
    it("returns true for paths under allowed base dir", async () => {
      const registry = new ProjectRegistryService();
      expect(registry.validateProjectPath(`${allowedBase}/my-project`)).toBe(true);
    });

    it("returns false for paths outside allowed base dir", async () => {
      const registry = new ProjectRegistryService();
      expect(registry.validateProjectPath("/etc/secrets")).toBe(false);
    });

    it("returns false for path traversal attempts", async () => {
      const registry = new ProjectRegistryService();
      expect(registry.validateProjectPath(`${allowedBase}/../../../etc/passwd`)).toBe(false);
    });
  });

  describe("registerProject", () => {
    it("stores workspace and project data for valid path", async () => {
      const registry = new ProjectRegistryService();
      const project = {
        id: "proj-1",
        name: "test-project",
        slug: "test-project",
        workspacePath: `${allowedBase}/test-project`,
        language: "typescript",
        defaultBranch: "main",
      };

      await registry.registerProject(project);

      expect(registry.getWorkspace("proj-1")).toBeDefined();
      expect(registry.getActiveProject("proj-1")).toEqual(project);
    });

    it("throws for paths outside allowed base dir", async () => {
      const registry = new ProjectRegistryService();
      const project = {
        id: "proj-bad",
        name: "evil-project",
        slug: "evil-project",
        workspacePath: "/etc/secrets/evil",
        language: "typescript",
        defaultBranch: "main",
      };

      await expect(registry.registerProject(project)).rejects.toThrow();
    });
  });

  describe("getWorkspace", () => {
    it("returns correct WorkspaceService for registered project", async () => {
      const registry = new ProjectRegistryService();
      await registry.registerProject({
        id: "proj-2",
        name: "my-project",
        slug: "my-project",
        workspacePath: `${allowedBase}/my-project`,
        language: "typescript",
        defaultBranch: "main",
      });

      const ws = registry.getWorkspace("proj-2");
      expect(ws).toBeDefined();
      expect(ws!.rootDir).toBe(`${allowedBase}/my-project`);
    });

    it("returns undefined for unknown project ID", async () => {
      const registry = new ProjectRegistryService();
      expect(registry.getWorkspace("unknown-id")).toBeUndefined();
    });
  });

  describe("listProjects", () => {
    it("returns all registered projects", async () => {
      const registry = new ProjectRegistryService();

      await registry.registerProject({
        id: "proj-a",
        name: "project-a",
        slug: "project-a",
        workspacePath: `${allowedBase}/project-a`,
        language: "typescript",
        defaultBranch: "main",
      });
      await registry.registerProject({
        id: "proj-b",
        name: "project-b",
        slug: "project-b",
        workspacePath: `${allowedBase}/project-b`,
        language: "python",
        defaultBranch: "main",
      });

      const projects = registry.listProjects();
      expect(projects).toHaveLength(2);
      expect(projects.map((p) => p.id)).toContain("proj-a");
      expect(projects.map((p) => p.id)).toContain("proj-b");
    });
  });

  describe("loadFromDb", () => {
    it("registers all active projects from DB", async () => {
      const registry = new ProjectRegistryService();
      mockListRegisteredProjects.mockResolvedValue([
        {
          id: "db-proj-1",
          name: "db-project-1",
          slug: "db-project-1",
          workspacePath: `${allowedBase}/db-project-1`,
          language: "typescript",
          defaultBranch: "main",
          isActive: true,
        },
        {
          id: "db-proj-2",
          name: "db-project-2",
          slug: "db-project-2",
          workspacePath: `${allowedBase}/db-project-2`,
          language: "python",
          defaultBranch: "develop",
          isActive: true,
        },
      ]);

      const mockDb = {} as Parameters<typeof registry.loadFromDb>[0];
      await registry.loadFromDb(mockDb);

      expect(registry.listProjects()).toHaveLength(2);
      expect(registry.getWorkspace("db-proj-1")).toBeDefined();
      expect(registry.getWorkspace("db-proj-2")).toBeDefined();
    });

    it("skips projects with invalid paths and continues loading rest", async () => {
      const registry = new ProjectRegistryService();
      mockListRegisteredProjects.mockResolvedValue([
        {
          id: "good-proj",
          name: "good-project",
          slug: "good-project",
          workspacePath: `${allowedBase}/good-project`,
          language: "typescript",
          defaultBranch: "main",
          isActive: true,
        },
        {
          id: "bad-proj",
          name: "bad-project",
          slug: "bad-project",
          workspacePath: "/etc/evil-path",
          language: "typescript",
          defaultBranch: "main",
          isActive: true,
        },
      ]);

      const mockDb = {} as Parameters<typeof registry.loadFromDb>[0];
      await registry.loadFromDb(mockDb);

      // Only the good project should be registered
      expect(registry.listProjects()).toHaveLength(1);
      expect(registry.getWorkspace("good-proj")).toBeDefined();
      expect(registry.getWorkspace("bad-proj")).toBeUndefined();
    });
  });
});
