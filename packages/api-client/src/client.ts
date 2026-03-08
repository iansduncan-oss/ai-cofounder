import type {
  Goal,
  GoalStatus,
  GoalPriority,
  Schedule,
  Task,
  AgentRole,
  Approval,
  Memory,
  Event,
  Milestone,
  MilestoneStatus,
  MilestoneProgress,
  DirectoryListing,
  HealthResponse,
  ProviderHealth,
  AgentRunResult,
  ExecutionProgress,
  UsageSummary,
  StreamEvent,
  StreamEventType,
  PaginationParams,
  PaginatedResponse,
  Conversation,
  ConversationMessage,
  DashboardSummary,
  BriefingResponse,
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

  listGoals(conversationId: string, pagination?: PaginationParams) {
    const params = new URLSearchParams({ conversationId });
    if (pagination?.limit != null) params.set("limit", String(pagination.limit));
    if (pagination?.offset != null) params.set("offset", String(pagination.offset));
    return this.request<PaginatedResponse<Goal>>("GET", `/api/goals?${params}`);
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

  listTasks(goalId: string, pagination?: PaginationParams) {
    const params = new URLSearchParams({ goalId });
    if (pagination?.limit != null) params.set("limit", String(pagination.limit));
    if (pagination?.offset != null) params.set("offset", String(pagination.offset));
    return this.request<PaginatedResponse<Task>>("GET", `/api/tasks?${params}`);
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

  listMemories(userId: string, pagination?: PaginationParams) {
    const params = new URLSearchParams({ userId });
    if (pagination?.limit != null) params.set("limit", String(pagination.limit));
    if (pagination?.offset != null) params.set("offset", String(pagination.offset));
    return this.request<PaginatedResponse<Memory>>("GET", `/api/memories?${params}`);
  }

  deleteMemory(id: string) {
    return this.request<{ deleted: boolean; id: string }>("DELETE", `/api/memories/${id}`);
  }

  /* ── Milestones ── */

  createMilestone(data: {
    conversationId: string;
    title: string;
    description?: string;
    orderIndex?: number;
    dueDate?: string;
    createdBy?: string;
  }) {
    return this.request<Milestone>("POST", "/api/milestones", data);
  }

  getMilestone(id: string) {
    return this.request<Milestone>("GET", `/api/milestones/${id}`);
  }

  listMilestones(conversationId: string) {
    return this.request<Milestone[]>("GET", `/api/milestones/conversation/${conversationId}`);
  }

  updateMilestoneStatus(id: string, status: MilestoneStatus) {
    return this.request<Milestone>("PATCH", `/api/milestones/${id}/status`, { status });
  }

  getMilestoneProgress(id: string) {
    return this.request<MilestoneProgress>("GET", `/api/milestones/${id}/progress`);
  }

  deleteMilestone(id: string) {
    return this.request<{ status: string; id: string }>("DELETE", `/api/milestones/${id}`);
  }

  /* ── Schedules ── */

  createSchedule(data: {
    cronExpression: string;
    actionPrompt: string;
    description?: string;
    userId?: string;
  }) {
    return this.request<Schedule>("POST", "/api/schedules", data);
  }

  listSchedules(userId?: string) {
    const query = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.request<Schedule[]>("GET", `/api/schedules${query}`);
  }

  deleteSchedule(id: string) {
    return this.request<{ deleted: boolean }>("DELETE", `/api/schedules/${id}`);
  }

  toggleSchedule(id: string, enabled: boolean) {
    return this.request<Schedule>("PATCH", `/api/schedules/${id}/toggle`, { enabled });
  }

  /* ── Workspace ── */

  listDirectory(path = ".") {
    return this.request<DirectoryListing>("GET", `/api/workspace/tree?path=${encodeURIComponent(path)}`);
  }

  readFile(path: string) {
    return this.request<{ path: string; content: string }>("POST", "/api/workspace/files/read", { path });
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

  /* ── Events ── */

  listEvents(pagination?: PaginationParams) {
    const params = new URLSearchParams();
    if (pagination?.limit != null) params.set("limit", String(pagination.limit));
    if (pagination?.offset != null) params.set("offset", String(pagination.offset));
    const qs = params.toString();
    return this.request<PaginatedResponse<Event>>("GET", `/api/events${qs ? `?${qs}` : ""}`);
  }

  /* ── Usage ── */

  getUsage(period: "today" | "week" | "month" | "all" = "today") {
    return this.request<UsageSummary>("GET", `/api/usage?period=${period}`);
  }

  /* ── Dashboard ── */

  getDashboardSummary() {
    return this.request<DashboardSummary>("GET", "/api/dashboard/summary");
  }

  /* ── Briefing ── */

  getBriefing(send = false) {
    const query = send ? "?send=true" : "";
    return this.request<BriefingResponse>("GET", `/api/briefing${query}`);
  }

  /* ── Conversations ── */

  listConversations(userId: string, pagination?: PaginationParams) {
    const params = new URLSearchParams({ userId });
    if (pagination?.limit != null) params.set("limit", String(pagination.limit));
    if (pagination?.offset != null) params.set("offset", String(pagination.offset));
    return this.request<PaginatedResponse<Conversation>>("GET", `/api/conversations?${params}`);
  }

  getConversation(id: string) {
    return this.request<Conversation>("GET", `/api/conversations/${id}`);
  }

  getConversationMessages(id: string, pagination?: PaginationParams) {
    const params = new URLSearchParams();
    if (pagination?.limit != null) params.set("limit", String(pagination.limit));
    if (pagination?.offset != null) params.set("offset", String(pagination.offset));
    const qs = params.toString();
    return this.request<{ data: ConversationMessage[]; limit: number; offset: number }>(
      "GET",
      `/api/conversations/${id}/messages${qs ? `?${qs}` : ""}`,
    );
  }

  searchConversations(q: string, options?: { conversationId?: string; role?: string } & PaginationParams) {
    const params = new URLSearchParams({ q });
    if (options?.conversationId) params.set("conversationId", options.conversationId);
    if (options?.role) params.set("role", options.role);
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.offset != null) params.set("offset", String(options.offset));
    return this.request<PaginatedResponse<ConversationMessage>>("GET", `/api/conversations/search?${params}`);
  }

  /* ── Streaming ── */

  async *streamExecute(goalId: string, userId?: string): AsyncGenerator<StreamEvent> {
    const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    const res = await fetch(`${this.baseUrl}/api/goals/${goalId}/execute/stream${params}`, {
      method: "GET",
      headers: this.headers,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (errorBody as { error?: string }).error ?? res.statusText);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new ApiError(0, "No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
            yield { type: currentEvent as StreamEventType, data };
            currentEvent = "";
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *streamChat(data: {
    message: string;
    conversationId?: string;
    userId?: string;
    platform?: string;
    history?: Array<{ role: "user" | "agent" | "system"; content: string }>;
  }): AsyncGenerator<StreamEvent> {
    const res = await fetch(`${this.baseUrl}/api/agents/run/stream`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (errorBody as { error?: string }).error ?? res.statusText);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new ApiError(0, "No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let currentEvent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ")) {
            const data = JSON.parse(line.slice(6)) as Record<string, unknown>;
            yield { type: currentEvent as StreamEventType, data };
            currentEvent = "";
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
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
