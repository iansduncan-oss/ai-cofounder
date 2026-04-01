import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiClient } from "@ai-cofounder/api-client";
import { registerTools } from "../tools.js";

function createMockClient(): ApiClient {
  return {
    runAgent: vi.fn(),
    getDashboardSummary: vi.fn(),
    getMonitoringStatus: vi.fn(),
    getQueueStatus: vi.fn(),
    listGoals: vi.fn(),
    createGoal: vi.fn(),
    executeGoal: vi.fn(),
    getBriefing: vi.fn(),
    listPipelines: vi.fn(),
    submitGoalPipeline: vi.fn(),
    listMemories: vi.fn(),
    providerHealth: vi.fn(),
    deleteGoal: vi.fn(),
    cancelGoal: vi.fn(),
    deleteConversation: vi.fn(),
    spawnSubagent: vi.fn(),
    getSubagentRun: vi.fn(),
    listSubagentRuns: vi.fn(),
    getGoal: vi.fn(),
    listPendingApprovals: vi.fn(),
    resolveApproval: vi.fn(),
    getBudgetStatus: vi.fn(),
    getErrorSummary: vi.fn(),
    getStandup: vi.fn(),
    listConversations: vi.fn(),
    globalSearch: vi.fn(),
    listFollowUps: vi.fn(),
    getGoalAnalytics: vi.fn(),
  } as unknown as ApiClient;
}

describe("MCP tools registration", () => {
  let server: McpServer;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "0.0.1" });
    client = createMockClient();
    registerTools(server, client);
  });

  it("registers 28 tools", () => {
    const tools = getRegisteredTools(server);
    expect(tools.size).toBe(28);
  });

  it("ask_agent calls runAgent and formats response", async () => {
    (client.runAgent as ReturnType<typeof vi.fn>).mockResolvedValue({
      agentRole: "orchestrator",
      model: "claude-sonnet-4-20250514",
      response: "Hello! How can I help?",
      conversationId: "conv-123",
    });

    // Access the registered tool handler via the server internals
    const tools = getRegisteredTools(server);
    const askAgent = tools.get("ask_agent");
    expect(askAgent).toBeDefined();

    const result = await askAgent!.handler({ message: "Hello" });
    expect(client.runAgent).toHaveBeenCalledWith({ message: "Hello", conversationId: undefined, userId: undefined });
    expect(result.content[0].text).toContain("orchestrator");
    expect(result.content[0].text).toContain("Hello! How can I help?");
  });

  it("get_dashboard calls getDashboardSummary", async () => {
    (client.getDashboardSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      goals: { activeCount: 3, recent: [] },
      tasks: { pendingCount: 1, runningCount: 0, completedCount: 5, failedCount: 0 },
      providerHealth: [],
      costs: { today: 0.05, week: 0.25, month: 1.0 },
      recentEvents: [],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_dashboard")!.handler({});
    expect(client.getDashboardSummary).toHaveBeenCalled();
    expect(result.content[0].text).toContain("3 active");
  });

  it("get_monitoring calls getMonitoringStatus", async () => {
    (client.getMonitoringStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      timestamp: new Date().toISOString(),
      alerts: [{ severity: "warning", source: "vps", message: "High memory" }],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_monitoring")!.handler({});
    expect(result.content[0].text).toContain("High memory");
  });

  it("get_queue_status calls getQueueStatus", async () => {
    (client.getQueueStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      queues: [{ name: "agent-tasks", waiting: 2, active: 1, completed: 50, failed: 0, delayed: 0 }],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_queue_status")!.handler({});
    expect(result.content[0].text).toContain("agent-tasks");
    expect(result.content[0].text).toContain("Waiting: 2");
  });

  it("list_goals calls listGoals with conversationId", async () => {
    (client.listGoals as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: "g-1", title: "Test Goal", status: "active", priority: "high" }],
      total: 1,
      limit: 20,
      offset: 0,
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("list_goals")!.handler({ conversationId: "conv-1" });
    expect(client.listGoals).toHaveBeenCalledWith("conv-1", { limit: 20 });
    expect(result.content[0].text).toContain("Test Goal");
  });

  it("create_goal calls createGoal", async () => {
    (client.createGoal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "g-new",
      title: "New Goal",
      status: "draft",
      priority: "medium",
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("create_goal")!.handler({
      conversationId: "conv-1",
      title: "New Goal",
    });
    expect(result.content[0].text).toContain("New Goal");
    expect(result.content[0].text).toContain("g-new");
  });

  it("get_briefing calls getBriefing", async () => {
    (client.getBriefing as ReturnType<typeof vi.fn>).mockResolvedValue({
      sent: false,
      briefing: "Good morning! Here is your briefing.",
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_briefing")!.handler({});
    expect(result.content[0].text).toContain("Good morning");
  });

  it("list_pipelines calls listPipelines", async () => {
    (client.listPipelines as ReturnType<typeof vi.fn>).mockResolvedValue({
      runs: [{ jobId: "j-1", pipelineId: "p-1", goalId: "g-1", stageCount: 3, state: "completed" }],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("list_pipelines")!.handler({});
    expect(result.content[0].text).toContain("p-1");
    expect(result.content[0].text).toContain("3 stages");
  });

  it("get_provider_health calls providerHealth", async () => {
    (client.providerHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "ok",
      timestamp: new Date().toISOString(),
      providers: [{
        provider: "anthropic",
        available: true,
        totalRequests: 100,
        successCount: 98,
        errorCount: 2,
        avgLatencyMs: 1500,
        recentErrors: [],
      }],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_provider_health")!.handler({});
    expect(result.content[0].text).toContain("anthropic");
    expect(result.content[0].text).toContain("98.0%");
  });

  it("delete_goal calls deleteGoal", async () => {
    (client.deleteGoal as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "g-1" });

    const tools = getRegisteredTools(server);
    const result = await tools.get("delete_goal")!.handler({ id: "g-1" });
    expect(client.deleteGoal).toHaveBeenCalledWith("g-1");
    expect(result.content[0].text).toContain("g-1 deleted");
  });

  it("cancel_goal calls cancelGoal", async () => {
    (client.cancelGoal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "g-1",
      title: "My Goal",
      status: "cancelled",
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("cancel_goal")!.handler({ id: "g-1" });
    expect(client.cancelGoal).toHaveBeenCalledWith("g-1");
    expect(result.content[0].text).toContain("My Goal");
    expect(result.content[0].text).toContain("cancelled");
  });

  it("delete_conversation calls deleteConversation", async () => {
    (client.deleteConversation as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "conv-1" });

    const tools = getRegisteredTools(server);
    const result = await tools.get("delete_conversation")!.handler({ id: "conv-1" });
    expect(client.deleteConversation).toHaveBeenCalledWith("conv-1");
    expect(result.content[0].text).toContain("conv-1 deleted");
  });

  it("get_goal calls getGoal and formats response", async () => {
    (client.getGoal as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "g-1", title: "Deploy v2", status: "active", priority: "high",
      conversationId: "conv-1", createdAt: "2026-03-31", updatedAt: "2026-03-31",
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_goal")!.handler({ id: "g-1" });
    expect(client.getGoal).toHaveBeenCalledWith("g-1");
    expect(result.content[0].text).toContain("Deploy v2");
    expect(result.content[0].text).toContain("active");
  });

  it("list_pending_approvals calls listPendingApprovals", async () => {
    (client.listPendingApprovals as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "apr-1", taskId: "t-1", requestedBy: "orchestrator", status: "pending", reason: "Needs review", createdAt: "2026-03-31" },
    ]);

    const tools = getRegisteredTools(server);
    const result = await tools.get("list_pending_approvals")!.handler({});
    expect(client.listPendingApprovals).toHaveBeenCalledWith(50);
    expect(result.content[0].text).toContain("apr-1");
    expect(result.content[0].text).toContain("Needs review");
  });

  it("resolve_approval calls resolveApproval", async () => {
    (client.resolveApproval as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "apr-1", status: "approved", decision: "Looks good", taskId: "t-1",
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("resolve_approval")!.handler({
      id: "apr-1", status: "approved", decision: "Looks good",
    });
    expect(client.resolveApproval).toHaveBeenCalledWith("apr-1", { status: "approved", decision: "Looks good", decidedBy: undefined });
    expect(result.content[0].text).toContain("approved");
  });

  it("get_budget_status calls getBudgetStatus", async () => {
    (client.getBudgetStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      daily: { spentUsd: 0.5, limitUsd: 5.0, percentUsed: 10 },
      weekly: { spentUsd: 2.0, limitUsd: 25.0, percentUsed: 8 },
      optimizationSuggestions: [],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_budget_status")!.handler({});
    expect(client.getBudgetStatus).toHaveBeenCalled();
    expect(result.content[0].text).toContain("$0.5000");
    expect(result.content[0].text).toContain("$5.0000");
  });

  it("get_error_summary calls getErrorSummary", async () => {
    (client.getErrorSummary as ReturnType<typeof vi.fn>).mockResolvedValue({
      timestamp: "2026-03-31T00:00:00Z", hours: 24, totalErrors: 3,
      errors: [{ toolName: "search_web", errorMessage: "timeout", count: 3, lastSeen: "2026-03-31" }],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_error_summary")!.handler({ hours: 24 });
    expect(client.getErrorSummary).toHaveBeenCalledWith(24);
    expect(result.content[0].text).toContain("search_web");
    expect(result.content[0].text).toContain("timeout");
  });

  it("get_standup calls getStandup", async () => {
    (client.getStandup as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: "2026-03-31", narrative: "Yesterday we shipped MCP tools.",
      data: { date: "2026-03-31", entryCounts: {}, highlights: [], totalEntries: 5, costUsd: 0.12 },
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_standup")!.handler({ date: "2026-03-31" });
    expect(client.getStandup).toHaveBeenCalledWith("2026-03-31");
    expect(result.content[0].text).toContain("shipped MCP tools");
  });

  it("list_conversations calls listConversations", async () => {
    (client.listConversations as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: "conv-1", userId: "u-1", title: "Planning session", createdAt: "2026-03-31", updatedAt: "2026-03-31" }],
      total: 1, limit: 20, offset: 0,
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("list_conversations")!.handler({ userId: "u-1" });
    expect(client.listConversations).toHaveBeenCalledWith("u-1", { limit: 20, offset: undefined });
    expect(result.content[0].text).toContain("Planning session");
  });

  it("global_search calls globalSearch", async () => {
    (client.globalSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      goals: [{ id: "g-1", title: "Deploy", description: null, status: "active", createdAt: "2026-03-31" }],
      tasks: [], conversations: [], memories: [],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("global_search")!.handler({ q: "deploy" });
    expect(client.globalSearch).toHaveBeenCalledWith("deploy");
    expect(result.content[0].text).toContain("Deploy");
    expect(result.content[0].text).toContain("Goals");
  });

  it("list_follow_ups calls listFollowUps", async () => {
    (client.listFollowUps as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [{ id: "fu-1", title: "Review PR #42", status: "pending", reminderSent: false, createdAt: "2026-03-31", updatedAt: "2026-03-31" }],
      total: 1,
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("list_follow_ups")!.handler({ status: "pending" });
    expect(client.listFollowUps).toHaveBeenCalledWith({ status: "pending", limit: 20, offset: undefined });
    expect(result.content[0].text).toContain("Review PR #42");
  });

  it("get_goal_analytics calls getGoalAnalytics", async () => {
    (client.getGoalAnalytics as ReturnType<typeof vi.fn>).mockResolvedValue({
      byStatus: { active: 5, completed: 10 }, byPriority: { high: 3, medium: 12 },
      completionRate: 73.3, avgCompletionHours: 4.5, totalGoals: 15,
      trend: [], taskSuccessRate: 85.0, totalTasks: 42, tasksByAgent: [],
    });

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_goal_analytics")!.handler({});
    expect(client.getGoalAnalytics).toHaveBeenCalled();
    expect(result.content[0].text).toContain("73.3");
    expect(result.content[0].text).toContain("15");
  });

  it("handles errors gracefully", async () => {
    (client.getDashboardSummary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Connection refused"));

    const tools = getRegisteredTools(server);
    const result = await tools.get("get_dashboard")!.handler({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Connection refused");
  });
});

// Helper to extract registered tools from McpServer internals
function getRegisteredTools(server: McpServer): Map<string, { handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }> {
  // McpServer stores tools in a private map. We access them via the internal structure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const serverAny = server as any;
  const toolHandlers = serverAny._registeredTools ?? serverAny._tools;

  if (!toolHandlers) {
    throw new Error("Cannot access registered tools from McpServer");
  }

  const result = new Map<string, { handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> }>();

  for (const [name, entry] of Object.entries(toolHandlers)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const e = entry as any;
    result.set(name, {
      handler: async (args: Record<string, unknown>) => {
        const cb = e.callback ?? e.handler ?? e;
        return cb(args);
      },
    });
  }

  return result;
}
