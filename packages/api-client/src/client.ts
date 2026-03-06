import type {
  Goal,
  GoalStatus,
  GoalPriority,
  Task,
  AgentRole,
  Approval,
  Memory,
  HealthResponse,
  ProviderHealth,
  AgentRunResult,
  ExecutionProgress,
  UsageSummary,
} from "./types.js";

export interface ClientOptions {
  baseUrl: string;
  apiSecret?: string;
}

export class ApiClient {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (options.apiSecret) {
      this.headers["Authorization"] = `Bearer ${options.apiSecret}`;
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (errorBody as { error?: string }).error ?? res.statusText);
    }

    return res.json() as Promise<T>;
  }

  /* ── Health ── */

  health() {
    return this.request<HealthResponse>("GET", "/health");
  }

  providerHealth() {
    return this.request<{ status: string; timestamp: string; providers: ProviderHealth[] }>(
      "GET",
      "/health/providers",
    );
  }

  /* ── Agent ── */

  runAgent(data: {
    message: string;
    conversationId?: string;
    userId?: string;
    platform?: string;
    history?: Array<{ role: "user" | "agent" | "system"; content: string }>;
  }) {
    return this.request<AgentRunResult>("POST", "/api/agents/run", data);
  }

  /* ── Goals ── */

  createGoal(data: {
    conversationId: string;
    title: string;
    description?: string;
    priority?: GoalPriority;
    createdBy?: string;
  }) {
    return this.request<Goal>("POST", "/api/goals", data);
  }

  getGoal(id: string) {
    return this.request<Goal>("GET", `/api/goals/${id}`);
  }

  listGoals(conversationId: string) {
    return this.request<Goal[]>("GET", `/api/goals?conversationId=${conversationId}`);
  }

  updateGoalStatus(id: string, status: GoalStatus) {
    return this.request<Goal>("PATCH", `/api/goals/${id}/status`, { status });
  }

  /* ── Tasks ── */

  createTask(data: {
    goalId: string;
    title: string;
    description?: string;
    assignedAgent?: AgentRole;
    orderIndex?: number;
  }) {
    return this.request<Task>("POST", "/api/tasks", data);
  }

  getTask(id: string) {
    return this.request<Task>("GET", `/api/tasks/${id}`);
  }

  listTasks(goalId: string) {
    return this.request<Task[]>("GET", `/api/tasks?goalId=${goalId}`);
  }

  listPendingTasks(limit = 50) {
    return this.request<Task[]>("GET", `/api/tasks/pending?limit=${limit}`);
  }

  assignTask(id: string, agent: AgentRole) {
    return this.request<Task>("PATCH", `/api/tasks/${id}/assign`, { agent });
  }

  startTask(id: string) {
    return this.request<Task>("PATCH", `/api/tasks/${id}/start`, {});
  }

  completeTask(id: string, result: string) {
    return this.request<Task>("PATCH", `/api/tasks/${id}/complete`, { result });
  }

  failTask(id: string, error: string) {
    return this.request<Task>("PATCH", `/api/tasks/${id}/fail`, { error });
  }

  /* ── Execution ── */

  executeGoal(goalId: string, data?: { userId?: string; webhookUrl?: string }) {
    return this.request<ExecutionProgress>("POST", `/api/goals/${goalId}/execute`, data ?? {});
  }

  getProgress(goalId: string) {
    return this.request<ExecutionProgress>("GET", `/api/goals/${goalId}/progress`);
  }

  /* ── Approvals ── */

  createApproval(data: { taskId: string; requestedBy: AgentRole; reason: string }) {
    return this.request<Approval>("POST", "/api/approvals", data);
  }

  getApproval(id: string) {
    return this.request<Approval>("GET", `/api/approvals/${id}`);
  }

  listPendingApprovals(limit = 50) {
    return this.request<Approval[]>("GET", `/api/approvals/pending?limit=${limit}`);
  }

  resolveApproval(id: string, data: { status: "approved" | "rejected"; decision: string; decidedBy?: string }) {
    return this.request<Approval>("PATCH", `/api/approvals/${id}/resolve`, data);
  }

  /* ── Memories ── */

  listMemories(userId: string) {
    return this.request<Memory[]>("GET", `/api/memories?userId=${userId}`);
  }

  deleteMemory(id: string) {
    return this.request<{ deleted: boolean; id: string }>("DELETE", `/api/memories/${id}`);
  }

  /* ── Channels ── */

  getChannelConversation(channelId: string) {
    return this.request<{ conversationId: string }>("GET", `/api/channels/${channelId}/conversation`);
  }

  setChannelConversation(channelId: string, conversationId: string, platform: string) {
    return this.request<{ conversationId: string }>(
      "PUT",
      `/api/channels/${channelId}/conversation`,
      { conversationId, platform },
    );
  }

  deleteChannelConversation(channelId: string) {
    return this.request<{ deleted: boolean }>("DELETE", `/api/channels/${channelId}/conversation`);
  }

  /* ── Users ── */

  getUserByPlatform(platform: string, platformId: string) {
    return this.request<{ id: string; displayName?: string }>(
      "GET",
      `/api/users/by-platform/${platform}/${platformId}`,
    );
  }

  /* ── Usage ── */

  getUsage(period: "today" | "week" | "month" | "all" = "today") {
    return this.request<UsageSummary>("GET", `/api/usage?period=${period}`);
  }
}

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
