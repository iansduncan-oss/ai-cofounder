import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ApiClient } from "@ai-cofounder/api-client";
import type { CommandContext } from "../types.js";
import {
  handleAsk,
  handleStatus,
  handleGoals,
  handleTasks,
  handleMemory,
  handleClear,
  handleExecute,
  handleApprove,
  handleReject,
  handleListApprovals,
  handleHelp,
  handleScheduleList,
  handleScheduleCreate,
  truncate,
  STATUS_ICON,
} from "../handlers.js";

function mockClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    health: vi.fn(),
    providerHealth: vi.fn(),
    runAgent: vi.fn(),
    createGoal: vi.fn(),
    getGoal: vi.fn(),
    listGoals: vi.fn(),
    updateGoalStatus: vi.fn(),
    createTask: vi.fn(),
    getTask: vi.fn(),
    listTasks: vi.fn(),
    listPendingTasks: vi.fn(),
    assignTask: vi.fn(),
    startTask: vi.fn(),
    completeTask: vi.fn(),
    failTask: vi.fn(),
    executeGoal: vi.fn(),
    getProgress: vi.fn(),
    createApproval: vi.fn(),
    getApproval: vi.fn(),
    listPendingApprovals: vi.fn(),
    resolveApproval: vi.fn(),
    listMemories: vi.fn(),
    deleteMemory: vi.fn(),
    getChannelConversation: vi.fn(),
    setChannelConversation: vi.fn(),
    deleteChannelConversation: vi.fn(),
    getUserByPlatform: vi.fn(),
    getUsage: vi.fn(),
    createSchedule: vi.fn(),
    listSchedules: vi.fn(),
    deleteSchedule: vi.fn(),
    toggleSchedule: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

const ctx: CommandContext = {
  channelId: "test-channel",
  userId: "user-1",
  userName: "TestUser",
  platform: "discord",
};

describe("truncate", () => {
  it("returns text as-is when under max", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and adds ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });
});

describe("STATUS_ICON", () => {
  it("has icons for standard statuses", () => {
    expect(STATUS_ICON.completed).toBe("✅");
    expect(STATUS_ICON.active).toBe("🔵");
    expect(STATUS_ICON.failed).toBe("❌");
  });
});

describe("handleAsk", () => {
  it("runs agent and returns result", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
      runAgent: vi.fn().mockResolvedValue({
        response: "Hello!",
        agentRole: "orchestrator",
        model: "claude-3",
        usage: { inputTokens: 10, outputTokens: 20 },
        conversationId: "conv-1",
      }),
      setChannelConversation: vi.fn().mockResolvedValue({}),
    });

    const result = await handleAsk(client, ctx, "hi");
    expect(result).toEqual({
      type: "ask",
      data: {
        response: "Hello!",
        agentRole: "orchestrator",
        model: "claude-3",
        usage: { inputTokens: 10, outputTokens: 20 },
        conversationId: "conv-1",
      },
    });
    expect(client.runAgent).toHaveBeenCalledWith({
      message: "hi",
      userId: "user-1",
      platform: "discord",
      conversationId: "conv-1",
    });
  });

  it("works without existing conversation", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockRejectedValue(new Error("Not found")),
      runAgent: vi.fn().mockResolvedValue({
        response: "Hi!",
        agentRole: "orchestrator",
        model: "claude-3",
        conversationId: "conv-new",
      }),
      setChannelConversation: vi.fn().mockResolvedValue({}),
    });

    const result = await handleAsk(client, ctx, "hello");
    expect(result.type).toBe("ask");
    expect(client.runAgent).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: undefined }),
    );
  });

  it("returns error on agent failure", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockRejectedValue(new Error("nope")),
      runAgent: vi.fn().mockRejectedValue(new Error("server down")),
    });

    const result = await handleAsk(client, ctx, "hi");
    expect(result.type).toBe("error");
  });
});

describe("handleStatus", () => {
  it("returns status and uptime", async () => {
    const client = mockClient({
      health: vi.fn().mockResolvedValue({ status: "ok", uptime: 3600, timestamp: "now" }),
    });

    const result = await handleStatus(client);
    expect(result).toEqual({
      type: "status",
      data: { status: "ok", uptimeMinutes: 60 },
    });
  });

  it("returns error when unreachable", async () => {
    const client = mockClient({
      health: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });

    const result = await handleStatus(client);
    expect(result.type).toBe("error");
  });
});

describe("handleGoals", () => {
  it("returns goals with icons", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
      listGoals: vi.fn().mockResolvedValue({
        data: [
          { title: "Build MVP", status: "active", priority: "high" },
          { title: "Write tests", status: "completed", priority: "medium" },
        ],
        total: 2, limit: 50, offset: 0,
      }),
    });

    const result = await handleGoals(client, ctx);
    expect(result).toEqual({
      type: "goals",
      data: {
        goals: [
          { title: "Build MVP", status: "active", priority: "high", icon: "🔵" },
          { title: "Write tests", status: "completed", priority: "medium", icon: "✅" },
        ],
      },
    });
  });

  it("returns info when no conversation", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockRejectedValue(new Error("not found")),
    });

    const result = await handleGoals(client, ctx);
    expect(result.type).toBe("info");
  });

  it("returns info when no goals", async () => {
    const client = mockClient({
      getChannelConversation: vi.fn().mockResolvedValue({ conversationId: "conv-1" }),
      listGoals: vi.fn().mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 }),
    });

    const result = await handleGoals(client, ctx);
    expect(result.type).toBe("info");
  });
});

describe("handleTasks", () => {
  it("returns pending tasks", async () => {
    const client = mockClient({
      listPendingTasks: vi.fn().mockResolvedValue([
        { title: "Research", assignedAgent: "researcher" },
        { title: "Code it", assignedAgent: null },
      ]),
    });

    const result = await handleTasks(client);
    expect(result).toEqual({
      type: "tasks",
      data: {
        tasks: [
          { title: "Research", assignedAgent: "researcher" },
          { title: "Code it", assignedAgent: "unassigned" },
        ],
        totalCount: 2,
      },
    });
  });

  it("returns info when no tasks", async () => {
    const client = mockClient({
      listPendingTasks: vi.fn().mockResolvedValue([]),
    });

    const result = await handleTasks(client);
    expect(result.type).toBe("info");
  });

  it("caps at 15 tasks", async () => {
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      title: `Task ${i}`,
      assignedAgent: "coder",
    }));
    const client = mockClient({
      listPendingTasks: vi.fn().mockResolvedValue(tasks),
    });

    const result = await handleTasks(client);
    if (result.type === "tasks") {
      expect(result.data.tasks).toHaveLength(15);
      expect(result.data.totalCount).toBe(20);
    }
  });
});

describe("handleMemory", () => {
  it("returns grouped memories", async () => {
    const client = mockClient({
      getUserByPlatform: vi.fn().mockResolvedValue({ id: "db-user-1" }),
      listMemories: vi.fn().mockResolvedValue({
        data: [
          { category: "preferences", key: "language", content: "TypeScript" },
          { category: "preferences", key: "editor", content: "VS Code" },
          { category: "company", key: "name", content: "Acme Corp" },
        ],
        total: 3, limit: 50, offset: 0,
      }),
    });

    const result = await handleMemory(client, ctx);
    expect(result).toEqual({
      type: "memory",
      data: {
        sections: [
          {
            category: "preferences",
            items: [
              { key: "language", content: "TypeScript" },
              { key: "editor", content: "VS Code" },
            ],
          },
          {
            category: "company",
            items: [{ key: "name", content: "Acme Corp" }],
          },
        ],
        totalCount: 3,
      },
    });
  });

  it("returns info when user not found", async () => {
    const client = mockClient({
      getUserByPlatform: vi.fn().mockRejectedValue(new Error("not found")),
    });

    const result = await handleMemory(client, ctx);
    expect(result.type).toBe("info");
  });

  it("returns info when no memories", async () => {
    const client = mockClient({
      getUserByPlatform: vi.fn().mockResolvedValue({ id: "db-user-1" }),
      listMemories: vi.fn().mockResolvedValue({ data: [], total: 0, limit: 50, offset: 0 }),
    });

    const result = await handleMemory(client, ctx);
    expect(result.type).toBe("info");
  });
});

describe("handleClear", () => {
  it("deletes channel conversation", async () => {
    const client = mockClient({
      deleteChannelConversation: vi.fn().mockResolvedValue({ deleted: true }),
    });

    const result = await handleClear(client, ctx);
    expect(result.type).toBe("clear");
    expect(client.deleteChannelConversation).toHaveBeenCalledWith("test-channel");
  });
});

describe("handleExecute", () => {
  it("returns execution progress", async () => {
    const client = mockClient({
      executeGoal: vi.fn().mockResolvedValue({
        goalTitle: "Build MVP",
        status: "completed",
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { title: "Research", agent: "researcher", status: "completed" },
          { title: "Code", agent: "coder", status: "completed" },
        ],
      }),
    });

    const result = await handleExecute(client, ctx, "goal-1");
    expect(result).toEqual({
      type: "execute",
      data: {
        goalTitle: "Build MVP",
        status: "completed",
        completedTasks: 2,
        totalTasks: 2,
        tasks: [
          { title: "Research", agent: "researcher", status: "completed", icon: "✅" },
          { title: "Code", agent: "coder", status: "completed", icon: "✅" },
        ],
      },
    });
  });
});

describe("handleApprove", () => {
  it("resolves approval", async () => {
    const client = mockClient({
      resolveApproval: vi.fn().mockResolvedValue({}),
    });

    const result = await handleApprove(client, ctx, "appr-1");
    expect(result).toEqual({ type: "approve", data: { approvalId: "appr-1" } });
    expect(client.resolveApproval).toHaveBeenCalledWith("appr-1", {
      status: "approved",
      decision: "Approved by TestUser via discord",
    });
  });

  it("returns error on failure", async () => {
    const client = mockClient({
      resolveApproval: vi.fn().mockRejectedValue(new Error("Already resolved")),
    });

    const result = await handleApprove(client, ctx, "appr-1");
    expect(result.type).toBe("error");
  });
});

describe("handleReject", () => {
  it("rejects approval", async () => {
    const client = mockClient({
      resolveApproval: vi.fn().mockResolvedValue({}),
    });

    const result = await handleReject(client, ctx, "appr-1");
    expect(result).toEqual({ type: "reject", data: { approvalId: "appr-1" } });
    expect(client.resolveApproval).toHaveBeenCalledWith("appr-1", {
      status: "rejected",
      decision: "Rejected by TestUser via discord",
    });
  });

  it("returns error on failure", async () => {
    const client = mockClient({
      resolveApproval: vi.fn().mockRejectedValue(new Error("Already resolved")),
    });

    const result = await handleReject(client, ctx, "appr-1");
    expect(result.type).toBe("error");
  });
});

describe("handleListApprovals", () => {
  it("returns pending approvals", async () => {
    const client = mockClient({
      listPendingApprovals: vi.fn().mockResolvedValue([
        {
          id: "a1",
          taskId: "t1",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Deploy to prod",
          createdAt: "2026-03-05T10:00:00Z",
        },
        {
          id: "a2",
          taskId: "t2",
          requestedBy: "coder",
          status: "pending",
          reason: "Delete user data",
          createdAt: "2026-03-05T11:00:00Z",
        },
      ]),
    });

    const result = await handleListApprovals(client);
    expect(result).toEqual({
      type: "approvals",
      data: {
        approvals: [
          { id: "a1", taskId: "t1", requestedBy: "orchestrator", reason: "Deploy to prod", createdAt: "2026-03-05T10:00:00Z" },
          { id: "a2", taskId: "t2", requestedBy: "coder", reason: "Delete user data", createdAt: "2026-03-05T11:00:00Z" },
        ],
        totalCount: 2,
      },
    });
  });

  it("returns info when no pending approvals", async () => {
    const client = mockClient({
      listPendingApprovals: vi.fn().mockResolvedValue([]),
    });

    const result = await handleListApprovals(client);
    expect(result).toEqual({ type: "info", message: "No pending approvals." });
  });

  it("returns error on failure", async () => {
    const client = mockClient({
      listPendingApprovals: vi.fn().mockRejectedValue(new Error("Server error")),
    });

    const result = await handleListApprovals(client);
    expect(result.type).toBe("error");
  });
});

describe("handleHelp", () => {
  it("returns list of commands", () => {
    const result = handleHelp();
    expect(result.type).toBe("help");
    if (result.type === "help") {
      expect(result.data.commands.length).toBeGreaterThan(0);
      expect(result.data.commands[0]).toHaveProperty("name");
      expect(result.data.commands[0]).toHaveProperty("description");
    }
  });

  it("includes /ask and /help in command list", () => {
    const result = handleHelp();
    if (result.type === "help") {
      const names = result.data.commands.map((c) => c.name);
      expect(names).toContain("/ask");
      expect(names).toContain("/help");
      expect(names).toContain("/schedule");
    }
  });
});

describe("handleScheduleList", () => {
  it("returns schedules", async () => {
    const client = mockClient({
      listSchedules: vi.fn().mockResolvedValue([
        {
          id: "sched-1",
          cronExpression: "0 9 * * 1-5",
          actionPrompt: "Daily standup",
          description: "Run daily standup",
          enabled: true,
          nextRunAt: "2026-03-07T09:00:00Z",
          createdAt: "2026-03-05T10:00:00Z",
          updatedAt: "2026-03-05T10:00:00Z",
        },
      ]),
    });

    const result = await handleScheduleList(client);
    expect(result).toEqual({
      type: "schedule_list",
      data: {
        schedules: [
          {
            id: "sched-1",
            cronExpression: "0 9 * * 1-5",
            description: "Run daily standup",
            enabled: true,
            nextRunAt: "2026-03-07T09:00:00Z",
          },
        ],
        totalCount: 1,
      },
    });
  });

  it("uses actionPrompt as fallback description", async () => {
    const client = mockClient({
      listSchedules: vi.fn().mockResolvedValue([
        {
          id: "sched-1",
          cronExpression: "0 9 * * *",
          actionPrompt: "Check emails",
          enabled: true,
          nextRunAt: "2026-03-07T09:00:00Z",
          createdAt: "2026-03-05T10:00:00Z",
          updatedAt: "2026-03-05T10:00:00Z",
        },
      ]),
    });

    const result = await handleScheduleList(client);
    if (result.type === "schedule_list") {
      expect(result.data.schedules[0].description).toBe("Check emails");
    }
  });

  it("returns info when no schedules", async () => {
    const client = mockClient({
      listSchedules: vi.fn().mockResolvedValue([]),
    });

    const result = await handleScheduleList(client);
    expect(result.type).toBe("info");
  });

  it("returns error on failure", async () => {
    const client = mockClient({
      listSchedules: vi.fn().mockRejectedValue(new Error("Server error")),
    });

    const result = await handleScheduleList(client);
    expect(result.type).toBe("error");
  });
});

describe("handleScheduleCreate", () => {
  it("creates a schedule", async () => {
    const client = mockClient({
      createSchedule: vi.fn().mockResolvedValue({
        id: "sched-new",
        cronExpression: "0 9 * * 1-5",
        actionPrompt: "Review PRs",
        description: "Review PRs",
        enabled: true,
        nextRunAt: "2026-03-07T09:00:00Z",
        createdAt: "2026-03-06T10:00:00Z",
        updatedAt: "2026-03-06T10:00:00Z",
      }),
    });

    const result = await handleScheduleCreate(client, "0 9 * * 1-5", "Review PRs", "user-1");
    expect(result).toEqual({
      type: "schedule_create",
      data: {
        id: "sched-new",
        cronExpression: "0 9 * * 1-5",
        description: "Review PRs",
      },
    });
    expect(client.createSchedule).toHaveBeenCalledWith({
      cronExpression: "0 9 * * 1-5",
      actionPrompt: "Review PRs",
      description: "Review PRs",
      userId: "user-1",
    });
  });

  it("returns error on failure", async () => {
    const client = mockClient({
      createSchedule: vi.fn().mockRejectedValue(new Error("Invalid cron")),
    });

    const result = await handleScheduleCreate(client, "bad", "test");
    expect(result.type).toBe("error");
  });
});
