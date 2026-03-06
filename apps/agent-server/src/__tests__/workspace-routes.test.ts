import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockListDirectory = vi.fn();
const mockGitClone = vi.fn();
const mockGitStatus = vi.fn();
const mockGitDiff = vi.fn();
const mockGitAdd = vi.fn();
const mockGitCommit = vi.fn();
const mockGitLog = vi.fn();

vi.mock("../services/workspace.js", () => ({
  createWorkspaceService: () => ({
    rootDir: "/tmp/test-workspace",
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    listDirectory: (...args: unknown[]) => mockListDirectory(...args),
    gitClone: (...args: unknown[]) => mockGitClone(...args),
    gitStatus: (...args: unknown[]) => mockGitStatus(...args),
    gitDiff: (...args: unknown[]) => mockGitDiff(...args),
    gitAdd: (...args: unknown[]) => mockGitAdd(...args),
    gitCommit: (...args: unknown[]) => mockGitCommit(...args),
    gitLog: (...args: unknown[]) => mockGitLog(...args),
  }),
  WorkspaceService: class {},
}));

vi.mock("@ai-cofounder/db", () => ({
  createDb: vi.fn().mockReturnValue({
    execute: vi.fn().mockResolvedValue([{ "?column?": 1 }]),
  }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
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
  getActivePrompt: vi.fn().mockResolvedValue(null),
  listPromptVersions: vi.fn().mockResolvedValue([]),
  createPromptVersion: vi.fn(),
  saveMemory: vi.fn(),
  recallMemories: vi.fn().mockResolvedValue([]),
  searchMemoriesByVector: vi.fn().mockResolvedValue([]),
  getConversation: vi.fn(),
  createN8nWorkflow: vi.fn(),
  updateN8nWorkflow: vi.fn(),
  getN8nWorkflow: vi.fn(),
  getN8nWorkflowByName: vi.fn(),
  listN8nWorkflows: vi.fn().mockResolvedValue([]),
  deleteN8nWorkflow: vi.fn(),
  findN8nWorkflowByEvent: vi.fn(),
  saveCodeExecution: vi.fn(),
  createSchedule: vi.fn(),
  listSchedules: vi.fn().mockResolvedValue([]),
  getSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  toggleSchedule: vi.fn(),
  createEvent: vi.fn().mockResolvedValue({ id: "evt-1" }),
  markEventProcessed: vi.fn(),
  listUnprocessedEvents: vi.fn().mockResolvedValue([]),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  listRecentWorkSessions: vi.fn().mockResolvedValue([]),
  listActiveGoals: vi.fn().mockResolvedValue([]),
  countTasksByStatus: vi.fn().mockResolvedValue({}),
  recordLlmUsage: vi.fn(),
  getUsageSummary: vi.fn(),
  listEnabledSchedules: vi.fn().mockResolvedValue([]),
  updateScheduleLastRun: vi.fn(),
  goals: {},
  channelConversations: {},
  prompts: {},
  n8nWorkflows: {},
  schedules: {},
  events: {},
  workSessions: {},
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Workspace routes", () => {
  describe("POST /api/workspace/files/read", () => {
    it("reads a file successfully", async () => {
      mockReadFile.mockResolvedValueOnce("file contents here");

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/files/read",
        payload: { path: "src/index.ts" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().content).toBe("file contents here");
      expect(mockReadFile).toHaveBeenCalledWith("src/index.ts");
    });

    it("returns 404 for non-existent file", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("ENOENT: no such file"));

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/files/read",
        payload: { path: "nope.txt" },
      });
      await app.close();

      expect(res.statusCode).toBe(404);
    });

    it("returns 403 for path traversal", async () => {
      mockReadFile.mockRejectedValueOnce(new Error("Path traversal denied: ../../etc/passwd"));

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/files/read",
        payload: { path: "../../etc/passwd" },
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/workspace/files/write", () => {
    it("writes a file successfully", async () => {
      mockWriteFile.mockResolvedValueOnce(undefined);

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/files/write",
        payload: { path: "output.txt", content: "hello" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().written).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith("output.txt", "hello");
    });

    it("returns 403 for path traversal", async () => {
      mockWriteFile.mockRejectedValueOnce(new Error("Path traversal denied"));

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/files/write",
        payload: { path: "../../evil.txt", content: "bad" },
      });
      await app.close();

      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /api/workspace/tree", () => {
    it("lists directory contents", async () => {
      mockListDirectory.mockResolvedValueOnce([
        { name: "file1.txt", type: "file" },
        { name: "src", type: "directory" },
      ]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspace/tree",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().entries).toHaveLength(2);
    });

    it("passes path query parameter", async () => {
      mockListDirectory.mockResolvedValueOnce([]);

      const { app } = buildServer();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspace/tree?path=src",
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockListDirectory).toHaveBeenCalledWith("src");
    });
  });

  describe("POST /api/workspace/git", () => {
    it("clones a repository", async () => {
      mockGitClone.mockResolvedValueOnce({ stdout: "Cloning...", stderr: "", exitCode: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "clone", repoUrl: "https://github.com/test/repo.git" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockGitClone).toHaveBeenCalledWith("https://github.com/test/repo.git", undefined);
    });

    it("returns 400 when clone missing repoUrl", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "clone" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("repoUrl");
    });

    it("stages files with git add", async () => {
      mockGitAdd.mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "add", repoDir: "my-repo", paths: ["src/index.ts", "README.md"] },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockGitAdd).toHaveBeenCalledWith("my-repo", ["src/index.ts", "README.md"]);
    });

    it("returns 400 when add missing paths", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "add", repoDir: "my-repo" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("paths");
    });

    it("gets git status", async () => {
      mockGitStatus.mockResolvedValueOnce({ stdout: "M file.ts\n", stderr: "", exitCode: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "status", repoDir: "my-repo" },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(res.json().stdout).toContain("M file.ts");
    });

    it("gets git log", async () => {
      mockGitLog.mockResolvedValueOnce({ stdout: "abc1234 Initial commit\n", stderr: "", exitCode: 0 });

      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "log", repoDir: "my-repo", maxCount: 5 },
      });
      await app.close();

      expect(res.statusCode).toBe(200);
      expect(mockGitLog).toHaveBeenCalledWith("my-repo", 5);
    });

    it("returns 400 when status missing repoDir", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "status" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("repoDir");
    });

    it("returns 400 when commit missing message", async () => {
      const { app } = buildServer();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspace/git",
        payload: { operation: "commit", repoDir: "my-repo" },
      });
      await app.close();

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain("message");
    });
  });
});
