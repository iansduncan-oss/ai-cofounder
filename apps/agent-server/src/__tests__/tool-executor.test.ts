import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

const mockSaveMemory = vi.fn().mockResolvedValue({ key: "test", category: "projects" });
const mockRecallMemories = vi.fn().mockResolvedValue([]);
const mockSearchMemoriesByVector = vi.fn().mockResolvedValue([]);
const mockTouchMemory = vi.fn().mockResolvedValue(undefined);
const mockCreateSchedule = vi.fn().mockResolvedValue({ id: "s-1", cronExpression: "0 9 * * *" });
const mockListSchedules = vi.fn().mockResolvedValue([]);
const mockDeleteSchedule = vi.fn().mockResolvedValue({ id: "s-1" });
const mockGetN8nWorkflowByName = vi.fn().mockResolvedValue(null);
const mockListN8nWorkflows = vi.fn().mockResolvedValue([]);
const mockSaveCodeExecution = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/db", () => new Proxy({
  saveMemory: (...args: unknown[]) => mockSaveMemory(...args),
  recallMemories: (...args: unknown[]) => mockRecallMemories(...args),
  searchMemoriesByVector: (...args: unknown[]) => mockSearchMemoriesByVector(...args),
  touchMemory: (...args: unknown[]) => mockTouchMemory(...args),
  createSchedule: (...args: unknown[]) => mockCreateSchedule(...args),
  listSchedules: (...args: unknown[]) => mockListSchedules(...args),
  deleteSchedule: (...args: unknown[]) => mockDeleteSchedule(...args),
  getN8nWorkflowByName: (...args: unknown[]) => mockGetN8nWorkflowByName(...args),
  listN8nWorkflows: (...args: unknown[]) => mockListN8nWorkflows(...args),
  saveCodeExecution: (...args: unknown[]) => mockSaveCodeExecution(...args),
  createGoal: vi.fn(),
  createTask: vi.fn(),
  updateGoalStatus: vi.fn(),
  createApproval: vi.fn(),
  createMilestone: vi.fn(),
}, {
    get(target: Record<string, unknown>, prop: string | symbol, receiver: unknown) {
      if (typeof prop === "string" && !(prop in target)) {
        const fn = vi.fn().mockResolvedValue(null);
        target[prop] = fn;
        return fn;
      }
      return Reflect.get(target, prop, receiver);
    },
    has() { return true; },
  }));

vi.mock("@ai-cofounder/llm", () => ({
  LlmRegistry: class {},
}));

vi.mock("@ai-cofounder/rag", () => ({
  retrieve: vi.fn().mockResolvedValue([]),
  formatContext: vi.fn().mockReturnValue(""),
}));

vi.mock("@ai-cofounder/sandbox", () => ({
  hashCode: vi.fn().mockReturnValue("hash"),
}));

vi.mock("../services/notifications.js", () => ({
  notifyApprovalCreated: vi.fn(),
}));

vi.mock("../agents/tools/github-tools.js", () => ({
  CREATE_PR_TOOL: { name: "create_pr", description: "Create PR", input_schema: { type: "object", properties: {}, required: [] } },
  executeCreatePr: vi.fn().mockResolvedValue({ success: true }),
}));

const { buildSharedToolList, executeSharedTool } = await import("../agents/tool-executor.js");

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── buildSharedToolList ────────────────────────────────────────────────────

describe("buildSharedToolList", () => {
  it("returns web search tools with no services", () => {
    const tools = buildSharedToolList({});
    const names = tools.map((t) => t.name);

    expect(names).toContain("search_web");
    expect(names).toContain("browse_web");
    // Should NOT include DB-dependent tools
    expect(names).not.toContain("save_memory");
    expect(names).not.toContain("create_schedule");
  });

  it("includes memory tools when db is provided", () => {
    const tools = buildSharedToolList({ db: {} as any });
    const names = tools.map((t) => t.name);

    expect(names).toContain("save_memory");
    expect(names).toContain("recall_memories");
    expect(names).toContain("create_schedule");
    expect(names).toContain("list_schedules");
    expect(names).toContain("delete_schedule");
  });

  it("includes workspace tools when workspaceService is provided", () => {
    const tools = buildSharedToolList({ workspaceService: {} as any });
    const names = tools.map((t) => t.name);

    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("list_directory");
    expect(names).toContain("git_clone");
    expect(names).toContain("git_status");
    expect(names).toContain("git_commit");
    expect(names).toContain("run_tests");
    expect(names).toContain("create_pr");
  });

  it("includes execute_code when sandbox is available", () => {
    const tools = buildSharedToolList({ sandboxService: { available: true } as any });
    const names = tools.map((t) => t.name);

    expect(names).toContain("execute_code");
  });

  it("excludes execute_code when sandbox is unavailable", () => {
    const tools = buildSharedToolList({ sandboxService: { available: false } as any });
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("execute_code");
  });

  it("respects the exclude set", () => {
    const exclude = new Set(["search_web", "browse_web"]);
    const tools = buildSharedToolList({}, exclude);
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("search_web");
    expect(names).not.toContain("browse_web");
  });

  it("includes n8n tools when both db and n8nService are provided", () => {
    const tools = buildSharedToolList({ db: {} as any, n8nService: {} as any });
    const names = tools.map((t) => t.name);

    expect(names).toContain("trigger_workflow");
    expect(names).toContain("list_workflows");
  });

  it("excludes n8n tools when n8nService is missing", () => {
    const tools = buildSharedToolList({ db: {} as any });
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("trigger_workflow");
    expect(names).not.toContain("list_workflows");
  });
});

// ─── executeSharedTool ──────────────────────────────────────────────────────

describe("executeSharedTool", () => {
  const db = {} as any;
  const context = { conversationId: "conv-1", userId: "user-1" };

  it("returns null for unknown tools", async () => {
    const result = await executeSharedTool(
      { type: "tool_use", id: "tu-1", name: "nonexistent_tool", input: {} },
      { db },
      context,
    );

    expect(result).toBeNull();
  });

  describe("save_memory", () => {
    it("saves a memory with the correct params", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "save_memory",
          input: { category: "projects", key: "main_project", content: "Building an AI app" },
        },
        { db },
        context,
      );

      expect(mockSaveMemory).toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          userId: "user-1",
          category: "projects",
          key: "main_project",
          content: "Building an AI app",
          source: "conv-1",
        }),
      );
      expect(result).toEqual({ saved: true, key: "test", category: "projects" });
    });

    it("returns error when userId is missing", async () => {
      const result = await executeSharedTool(
        {
          type: "tool_use",
          id: "tu-1",
          name: "save_memory",
          input: { category: "projects", key: "test", content: "test" },
        },
        { db },
        { conversationId: "conv-1" },
      );

      expect(result).toEqual({ error: "No user context available" });
    });
  });

  describe("recall_memories", () => {
    it("recalls memories for user", async () => {
      mockRecallMemories.mockResolvedValueOnce([
        { id: "m-1", key: "k", category: "projects", content: "c", updatedAt: "2024-01-01" },
      ]);

      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "recall_memories", input: {} },
        { db },
        context,
      );

      expect(mockRecallMemories).toHaveBeenCalledWith(db, "user-1", {});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("read_file", () => {
    it("reads a file via workspace service", async () => {
      const workspaceService = { readFile: vi.fn().mockResolvedValue("file contents") } as any;
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "README.md" } },
        { workspaceService },
        context,
      );

      expect(workspaceService.readFile).toHaveBeenCalledWith("README.md");
      expect(result).toEqual({ path: "README.md", content: "file contents" });
    });

    it("returns error when workspace is unavailable", async () => {
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "x" } },
        {},
        context,
      );

      expect(result).toEqual({ error: "Workspace not available" });
    });

    it("returns error on file read failure", async () => {
      const workspaceService = { readFile: vi.fn().mockRejectedValue(new Error("ENOENT")) } as any;
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "read_file", input: { path: "missing.txt" } },
        { workspaceService },
        context,
      );

      expect(result).toEqual({ error: "ENOENT" });
    });
  });

  describe("write_file", () => {
    it("writes a file via workspace service", async () => {
      const workspaceService = { writeFile: vi.fn().mockResolvedValue(undefined) } as any;
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "write_file", input: { path: "test.txt", content: "hello" } },
        { workspaceService },
        context,
      );

      expect(workspaceService.writeFile).toHaveBeenCalledWith("test.txt", "hello");
      expect(result).toEqual({ written: true, path: "test.txt" });
    });
  });

  describe("list_directory", () => {
    it("lists directory contents", async () => {
      const entries = [{ name: "src", type: "directory" }];
      const workspaceService = { listDirectory: vi.fn().mockResolvedValue(entries) } as any;
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "list_directory", input: { path: "." } },
        { workspaceService },
        context,
      );

      expect(result).toEqual({ path: ".", entries });
    });
  });

  describe("delete_schedule", () => {
    it("deletes a schedule", async () => {
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "delete_schedule", input: { schedule_id: "s-1" } },
        { db },
        context,
      );

      expect(mockDeleteSchedule).toHaveBeenCalledWith(db, "s-1");
      expect(result).toEqual({ deleted: true, scheduleId: "s-1" });
    });

    it("returns error when schedule not found", async () => {
      mockDeleteSchedule.mockResolvedValueOnce(null);
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "delete_schedule", input: { schedule_id: "missing" } },
        { db },
        context,
      );

      expect(result).toEqual({ error: "Schedule not found" });
    });
  });

  describe("git tools", () => {
    it("git_status calls workspaceService.gitStatus", async () => {
      const ws = { gitStatus: vi.fn().mockResolvedValue({ branch: "main", clean: true }) } as any;
      const result = await executeSharedTool(
        { type: "tool_use", id: "tu-1", name: "git_status", input: { repo_dir: "." } },
        { workspaceService: ws },
        context,
      );

      expect(ws.gitStatus).toHaveBeenCalledWith(".");
      expect(result).toEqual({ branch: "main", clean: true });
    });
  });
});
