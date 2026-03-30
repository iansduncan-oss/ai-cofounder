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
  DailyCostResponse,
  BudgetStatusResponse,
  GoalCostSummary,
  TopExpensiveGoal,
  StreamEvent,
  StreamEventType,
  PaginationParams,
  PaginatedResponse,
  Conversation,
  ConversationMessage,
  DashboardSummary,
  BriefingResponse,
  MonitoringReport,
  QueueStatus,
  ToolStat,
  Persona,
  UpsertPersonaInput,
  PipelineRun,
  PipelineDetail,
  SubmitPipelineInput,
  SubmitPipelineResponse,
  CancelPipelineResponse,
  RetryPipelineResponse,
  SubagentRun,
  SubagentRunStatus,
  SpawnSubagentInput,
  SpawnSubagentResponse,
  AgentMessageItem,
  AgentRoleInfo,
  AgentCapability,
  UserPattern,
  PatternAnalytics,
  ToolTierConfig,
  AutonomyTier,
  DeadLetterEntry,
  GoalBacklogItem,
  AutonomousRunResponse,
  WorkSession,
  Deployment,
  JournalEntry,
  StandupResponse,
  RegisteredProject,
  ProjectDependency,
  CreateProjectInput,
  UpdateProjectInput,
  CreateProjectDependencyInput,
  AppSettings,
  UpdateBudgetInput,
  GmailMessageSummary,
  GmailMessage,
  GmailThread,
  SendEmailInput,
  CalendarEventSummary,
  CalendarEvent,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  FreeBusyResponse,
  MeetingPrepResponse,
  TodayBriefingResponse,
  FollowUp,
  FollowUpStatus,
  CreateFollowUpInput,
  UpdateFollowUpInput,
  GlobalSearchResults,
  DeployCircuitBreakerStatus,
} from "./types.js";

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string | null;
  stages: unknown[];
  defaultContext: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "success" | "error" | "waiting" | "canceled";
  finished: boolean;
  mode: string;
  startedAt: string;
  stoppedAt: string | null;
}

export interface TriggerTemplateResponse {
  jobId: string;
  template: string;
}

export interface ClientOptions {
  baseUrl: string;
  /** Static API secret for bot clients (Discord/Slack). Mutually exclusive with getToken. */
  apiSecret?: string;
  /** Dynamic token getter for dashboard clients using in-memory JWT storage. */
  getToken?: () => string | null;
  /** Called on 401 response — attempt silent token refresh. Return new token or null. */
  onUnauthorized?: () => Promise<string | null>;
}

export class ApiClient {
  private baseUrl: string;
  private headers: Record<string, string>;
  private getToken?: () => string | null;
  private onUnauthorized?: () => Promise<string | null>;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = { "Content-Type": "application/json" };
    if (options.apiSecret) {
      this.headers["Authorization"] = `Bearer ${options.apiSecret}`;
    }
    this.getToken = options.getToken;
    this.onUnauthorized = options.onUnauthorized;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Build request-specific headers — include dynamic token if available
    const requestHeaders: Record<string, string> = { ...this.headers };
    const dynamicToken = this.getToken?.();
    if (dynamicToken) {
      requestHeaders["Authorization"] = `Bearer ${dynamicToken}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });

    // On 401 with onUnauthorized handler: attempt silent refresh and retry once
    if (res.status === 401 && this.onUnauthorized) {
      const newToken = await this.onUnauthorized();
      if (newToken) {
        const retryHeaders: Record<string, string> = { ...this.headers };
        retryHeaders["Authorization"] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: retryHeaders,
          credentials: "include",
          body: body ? JSON.stringify(body) : undefined,
        });
        if (!retryRes.ok) {
          const errorBody = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
          throw new ApiError(retryRes.status, (errorBody as { error?: string }).error ?? retryRes.statusText);
        }
        return retryRes.json() as Promise<T>;
      }
      throw new ApiError(401, "Session expired");
    }

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (errorBody as { error?: string }).error ?? res.statusText);
    }

    return res.json() as Promise<T>;
  }

  private async requestBlob(method: string, path: string): Promise<Blob> {
    const requestHeaders: Record<string, string> = { ...this.headers };
    const dynamicToken = this.getToken?.();
    if (dynamicToken) {
      requestHeaders["Authorization"] = `Bearer ${dynamicToken}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      credentials: "include",
    });

    if (res.status === 401 && this.onUnauthorized) {
      const newToken = await this.onUnauthorized();
      if (newToken) {
        const retryHeaders: Record<string, string> = { ...this.headers };
        retryHeaders["Authorization"] = `Bearer ${newToken}`;
        const retryRes = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: retryHeaders,
          credentials: "include",
        });
        if (!retryRes.ok) {
          throw new ApiError(retryRes.status, retryRes.statusText);
        }
        return retryRes.blob();
      }
      throw new ApiError(401, "Session expired");
    }

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, (errorBody as { error?: string }).error ?? res.statusText);
    }

    return res.blob();
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

  /* ── Agent Info ── */

  listAgentRoles() {
    return this.request<{ roles: AgentRoleInfo[] }>("GET", "/api/agents/roles");
  }

  listAgentCapabilities() {
    return this.request<{ agents: AgentCapability[] }>("GET", "/api/agents/capabilities");
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

  bulkUpdateGoalStatus(updates: Array<{ id: string; status: GoalStatus }>) {
    return this.request<{ updated: number }>("PATCH", "/api/goals/bulk-status", { updates });
  }

  cloneGoal(id: string) {
    return this.request<Goal>("POST", `/api/goals/${id}/clone`);
  }

  approveGoal(id: string) {
    return this.request<Goal>("POST", `/api/goals/${id}/approve`);
  }

  rejectGoal(id: string, reason?: string) {
    return this.request<Goal>("POST", `/api/goals/${id}/reject`, reason ? { reason } : undefined);
  }

  deleteGoal(id: string) {
    return this.request<{ deleted: boolean; id: string }>("DELETE", `/api/goals/${id}`);
  }

  cancelGoal(id: string) {
    return this.request<Goal>("PATCH", `/api/goals/${id}/cancel`);
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

  registerUser(platform: string, externalId: string, displayName?: string) {
    return this.request<{ id: string; externalId: string; platform: string; displayName?: string }>(
      "POST",
      "/api/users/register",
      { platform, externalId, displayName },
    );
  }

  /* ── Events ── */

  listEvents(opts?: PaginationParams & { source?: string; type?: string; processed?: boolean }) {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    if (opts?.source) params.set("source", opts.source);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.processed != null) params.set("processed", String(opts.processed));
    const qs = params.toString();
    return this.request<PaginatedResponse<Event>>("GET", `/api/events${qs ? `?${qs}` : ""}`);
  }

  reprocessEvent(id: string) {
    return this.request<{ eventId: string; status: string }>("POST", `/api/events/${id}/reprocess`);
  }

  /* ── Usage ── */

  getUsage(period: "today" | "week" | "month" | "all" = "today") {
    return this.request<UsageSummary>("GET", `/api/usage?period=${period}`);
  }

  getDailyCost(days = 30) {
    return this.request<DailyCostResponse>("GET", `/api/usage/daily?days=${days}`);
  }

  getBudgetStatus() {
    return this.request<BudgetStatusResponse>("GET", `/api/usage/budget`);
  }

  getCostByGoal(goalId: string) {
    return this.request<GoalCostSummary>("GET", `/api/usage/by-goal/${goalId}`);
  }

  getTopExpensiveGoals(params?: { limit?: number; since?: string }) {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.since) qs.set("since", params.since);
    const query = qs.toString();
    return this.request<TopExpensiveGoal[]>("GET", `/api/usage/top-goals${query ? `?${query}` : ""}`);
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

  getBriefingAudio(): Promise<Blob> {
    return this.requestBlob("GET", "/api/briefing/audio");
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

  deleteConversation(id: string) {
    return this.request<{ deleted: boolean; id: string }>("DELETE", `/api/conversations/${id}`);
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

  exportConversation(id: string) {
    return this.request<Record<string, unknown>>("GET", `/api/conversations/${id}/export`);
  }

  searchConversations(q: string, options?: { conversationId?: string; role?: string } & PaginationParams) {
    const params = new URLSearchParams({ q });
    if (options?.conversationId) params.set("conversationId", options.conversationId);
    if (options?.role) params.set("role", options.role);
    if (options?.limit != null) params.set("limit", String(options.limit));
    if (options?.offset != null) params.set("offset", String(options.offset));
    return this.request<PaginatedResponse<ConversationMessage>>("GET", `/api/conversations/search?${params}`);
  }

  /* ── Monitoring ── */

  getMonitoringStatus() {
    return this.request<MonitoringReport>("GET", "/api/monitoring/status");
  }

  /* ── Queue ── */

  getQueueStatus() {
    return this.request<{ queues: QueueStatus[] }>("GET", "/api/queue/status");
  }

  /* ── Dead Letter Queue ── */

  listDlqJobs(opts?: { limit?: number; offset?: number }) {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<{ jobs: DeadLetterEntry[]; count: number }>(
      "GET",
      `/api/queue/dlq${qs ? `?${qs}` : ""}`,
    );
  }

  retryDlqJob(dlqJobId: string) {
    return this.request<{ requeued: boolean; originalQueue: string }>(
      "POST",
      `/api/queue/dlq/${encodeURIComponent(dlqJobId)}/retry`,
    );
  }

  deleteDlqJob(dlqJobId: string) {
    return this.request<void>("DELETE", `/api/queue/dlq/${encodeURIComponent(dlqJobId)}`);
  }

  /* ── Tool Stats ── */

  getToolStats() {
    return this.request<{ timestamp: string; tools: ToolStat[] }>("GET", "/api/tools/stats");
  }

  /* ── Error Analytics ── */

  getErrorSummary(hours = 24) {
    return this.request<{
      timestamp: string;
      hours: number;
      totalErrors: number;
      errors: Array<{ toolName: string; errorMessage: string | null; count: number; lastSeen: string }>;
    }>("GET", `/api/errors/summary?hours=${hours}`);
  }

  /* ── Provider Health History ── */

  getProviderHealthHistory(provider?: string) {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    return this.request<{ timestamp: string; records: Record<string, unknown>[] }>(
      "GET",
      `/health/providers/history${query}`,
    );
  }

  /* ── Persona ── */

  getActivePersona() {
    return this.request<{ persona: Persona | null }>("GET", "/api/persona");
  }

  listPersonas() {
    return this.request<{ personas: Persona[] }>("GET", "/api/persona/all");
  }

  upsertPersona(data: UpsertPersonaInput) {
    return this.request<{ persona: Persona }>("PUT", "/api/persona", data);
  }

  deletePersona(id: string) {
    return this.request<{ deleted: boolean }>("DELETE", `/api/persona/${id}`);
  }

  /* ── Pipelines ── */

  listPipelines() {
    return this.request<{ runs: PipelineRun[] }>("GET", "/api/pipelines");
  }

  getPipeline(jobId: string) {
    return this.request<PipelineDetail>("GET", `/api/pipelines/${jobId}`);
  }

  submitPipeline(data: SubmitPipelineInput) {
    return this.request<SubmitPipelineResponse>("POST", "/api/pipelines", data);
  }

  submitGoalPipeline(goalId: string, context?: Record<string, unknown>) {
    return this.request<SubmitPipelineResponse>("POST", `/api/pipelines/goal/${goalId}`, { context });
  }

  cancelPipeline(jobId: string) {
    return this.request<CancelPipelineResponse>("DELETE", `/api/pipelines/${jobId}`);
  }

  retryPipeline(jobId: string) {
    return this.request<RetryPipelineResponse>("POST", `/api/pipelines/${jobId}/retry`);
  }

  /* ── Pipeline Templates ── */

  listPipelineTemplates() {
    return this.request<PipelineTemplate[]>("GET", "/api/pipeline-templates");
  }

  getPipelineTemplate(id: string) {
    return this.request<PipelineTemplate>("GET", `/api/pipeline-templates/${id}`);
  }

  triggerPipelineTemplate(name: string, opts?: { goalId?: string; context?: Record<string, unknown> }) {
    return this.request<TriggerTemplateResponse>("POST", `/api/pipeline-templates/${encodeURIComponent(name)}/trigger`, opts);
  }

  /* ── N8n Executions ── */

  listN8nExecutions(opts?: { workflowId?: string; status?: string; limit?: number }) {
    const params = new URLSearchParams();
    if (opts?.workflowId) params.set("workflowId", opts.workflowId);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return this.request<{ data: N8nExecution[] }>("GET", `/api/n8n/executions${qs ? `?${qs}` : ""}`);
  }

  listN8nWorkflows() {
    return this.request<Array<{ id: string; name: string; description?: string; webhookUrl: string; isActive: boolean; direction: string }>>(
      "GET", "/api/n8n/workflows",
    );
  }

  /* ── Subagents ── */

  spawnSubagent(data: SpawnSubagentInput) {
    return this.request<SpawnSubagentResponse>("POST", "/api/subagents", data);
  }

  getSubagentRun(id: string) {
    return this.request<SubagentRun>("GET", `/api/subagents/${id}`);
  }

  listSubagentRuns(opts?: {
    goalId?: string;
    status?: SubagentRunStatus;
    parentRequestId?: string;
  } & PaginationParams) {
    const params = new URLSearchParams();
    if (opts?.goalId) params.set("goalId", opts.goalId);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.parentRequestId) params.set("parentRequestId", opts.parentRequestId);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<{ data: SubagentRun[]; total: number }>(
      "GET",
      `/api/subagents${qs ? `?${qs}` : ""}`,
    );
  }

  cancelSubagentRun(id: string) {
    return this.request<{ subagentRunId: string; status: string }>(
      "POST",
      `/api/subagents/${id}/cancel`,
    );
  }

  /* ── RAG ── */

  ragSearch(query: string, opts?: { limit?: number; sourceType?: string; minScore?: number }) {
    return this.request<{ results: Array<Record<string, unknown>>; query: string }>(
      "POST",
      "/api/rag/search",
      { query, ...opts },
    );
  }

  ragStatus() {
    return this.request<{ totalChunks: number; sources: Array<Record<string, unknown>> }>(
      "GET",
      "/api/rag/status",
    );
  }

  ragIngest(action: string, sourceId: string, opts?: { cursor?: string; content?: string }) {
    return this.request<{ jobId: string | undefined; action: string; sourceId: string }>(
      "POST",
      "/api/rag/ingest",
      { action, sourceId, ...opts },
    );
  }

  ragChunkCount(sourceType?: string) {
    const query = sourceType ? `?sourceType=${encodeURIComponent(sourceType)}` : "";
    return this.request<{ count: number; sourceType: string }>(
      "GET",
      `/api/rag/chunks/count${query}`,
    );
  }

  ragDeleteSource(sourceType: string, sourceId: string) {
    return this.request<{ deleted: boolean; sourceType: string; sourceId: string }>(
      "DELETE",
      `/api/rag/sources/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`,
    );
  }

  /* ── Agent Messages ── */

  listAgentMessages(opts?: {
    goalId?: string;
    role?: string;
    type?: string;
    status?: string;
  } & PaginationParams) {
    const params = new URLSearchParams();
    if (opts?.goalId) params.set("goalId", opts.goalId);
    if (opts?.role) params.set("role", opts.role);
    if (opts?.type) params.set("type", opts.type);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<{ data: AgentMessageItem[]; total: number }>(
      "GET",
      `/api/agent-messages${qs ? `?${qs}` : ""}`,
    );
  }

  getAgentMessage(id: string) {
    return this.request<AgentMessageItem>("GET", `/api/agent-messages/${id}`);
  }

  getMessageThread(correlationId: string) {
    return this.request<AgentMessageItem[]>("GET", `/api/agent-messages/thread/${correlationId}`);
  }

  getGoalMessages(goalId: string, opts?: PaginationParams) {
    const params = new URLSearchParams();
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<{ data: AgentMessageItem[]; total: number }>(
      "GET",
      `/api/agent-messages/goal/${goalId}${qs ? `?${qs}` : ""}`,
    );
  }

  /* ── Patterns ── */

  listPatterns(userId?: string, includeInactive?: boolean) {
    const params = new URLSearchParams();
    if (userId) params.set("userId", userId);
    if (includeInactive) params.set("includeInactive", "true");
    const qs = params.toString();
    return this.request<{ data: UserPattern[]; total: number }>(
      "GET",
      `/api/patterns${qs ? `?${qs}` : ""}`,
    );
  }

  togglePattern(id: string, isActive: boolean) {
    return this.request<UserPattern>(
      "PATCH",
      `/api/patterns/${id}/toggle`,
      { isActive },
    );
  }

  createPattern(data: {
    patternType: string;
    description: string;
    suggestedAction: string;
    userId?: string;
    triggerCondition?: Record<string, unknown>;
    confidence?: number;
  }) {
    return this.request<UserPattern>("POST", "/api/patterns", data);
  }

  updatePattern(id: string, data: {
    description?: string;
    suggestedAction?: string;
    triggerCondition?: Record<string, unknown>;
    confidence?: number;
    isActive?: boolean;
  }) {
    return this.request<UserPattern>("PATCH", `/api/patterns/${id}`, data);
  }

  deletePattern(id: string) {
    return this.request<{ deleted: boolean }>("DELETE", `/api/patterns/${id}`);
  }

  getPatternAnalytics(userId?: string) {
    const params = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.request<PatternAnalytics>("GET", `/api/patterns/analytics${params}`);
  }

  acceptSuggestion(data: { suggestion: string; userId?: string; patternId?: string }) {
    return this.request<{ ok: boolean }>(
      "POST",
      "/api/agents/accept-suggestion",
      data,
    );
  }

  /* ── Autonomy Tiers ── */

  listToolTierConfig() {
    return this.request<ToolTierConfig[]>("GET", "/api/autonomy/tiers");
  }

  updateToolTier(toolName: string, data: { tier: AutonomyTier; timeoutMs?: number }) {
    return this.request<ToolTierConfig>("PUT", `/api/autonomy/tiers/${encodeURIComponent(toolName)}`, data);
  }

  /* ── Autonomous Execution ── */

  listGoalBacklog(limit?: number) {
    const query = limit != null ? `?limit=${limit}` : "";
    return this.request<{ data: GoalBacklogItem[]; count: number }>(
      "GET",
      `/api/autonomous${query}`,
    );
  }

  listAutonomousSessions(limit?: number) {
    const query = limit != null ? `?limit=${limit}` : "";
    return this.request<{ data: WorkSession[]; count: number }>(
      "GET",
      `/api/autonomous/sessions${query}`,
    );
  }

  triggerAutonomousRun(goalId: string, opts?: { userId?: string; createPr?: boolean }) {
    return this.request<AutonomousRunResponse>(
      "POST",
      `/api/autonomous/${encodeURIComponent(goalId)}/run`,
      opts ?? {},
    );
  }

  /* ── Work Sessions ── */

  listWorkSessions(params?: { limit?: number; offset?: number; goalId?: string }) {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set("limit", String(params.limit));
    if (params?.offset != null) qs.set("offset", String(params.offset));
    if (params?.goalId) qs.set("goalId", params.goalId);
    const query = qs.toString();
    return this.request<{ data: WorkSession[]; total: number }>(
      "GET",
      `/api/work-sessions${query ? `?${query}` : ""}`,
    );
  }

  getWorkSession(id: string) {
    return this.request<WorkSession>("GET", `/api/work-sessions/${encodeURIComponent(id)}`);
  }

  cancelWorkSession(id: string) {
    return this.request<WorkSession>("PATCH", `/api/work-sessions/${encodeURIComponent(id)}/cancel`);
  }

  /* ── Journal ── */

  listJournalEntries(params?: {
    since?: string;
    until?: string;
    goalId?: string;
    entryType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.since) qs.set("since", params.since);
    if (params?.until) qs.set("until", params.until);
    if (params?.goalId) qs.set("goalId", params.goalId);
    if (params?.entryType) qs.set("entryType", params.entryType);
    if (params?.search) qs.set("search", params.search);
    if (params?.limit) qs.set("limit", String(params.limit));
    if (params?.offset) qs.set("offset", String(params.offset));
    const query = qs.toString();
    return this.request<{ data: JournalEntry[]; total: number }>(
      "GET",
      `/api/journal${query ? `?${query}` : ""}`,
    );
  }

  getJournalEntry(id: string) {
    return this.request<JournalEntry>("GET", `/api/journal/${encodeURIComponent(id)}`);
  }

  getStandup(date?: string) {
    const qs = date ? `?date=${encodeURIComponent(date)}` : "";
    return this.request<StandupResponse>("GET", `/api/journal/standup${qs}`);
  }

  /* ── Deployments ── */

  listDeployments(limit = 20) {
    return this.request<{ data: Deployment[]; total: number }>(
      "GET",
      `/api/deploys?limit=${limit}`,
    );
  }

  getLatestDeployment() {
    return this.request<{ data: Deployment | null }>("GET", "/api/deploys/latest");
  }

  getCircuitBreakerStatus() {
    return this.request<DeployCircuitBreakerStatus>("GET", "/api/deploys/circuit-breaker");
  }

  resumeCircuitBreaker(resumedBy?: string) {
    return this.request<{ status: string }>("POST", "/api/deploys/circuit-breaker/resume", { resumedBy });
  }

  rollbackDeployment(id: string, previousSha: string) {
    return this.request<{ status: string; rollbackSha: string }>("POST", `/api/deploys/${id}/rollback`, { previousSha });
  }

  remediateDeploy(id: string, action: "restart_containers" | "clear_cache" = "restart_containers") {
    return this.request<{ action: string; result: string; timestamp: string }>("POST", `/api/deploys/${id}/remediate`, { action });
  }

  /* ── Context ── */

  getCurrentContext(userId?: string) {
    const q = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.request<{ data: string | null }>("GET", `/api/context/current${q}`);
  }

  getEngagement(userId: string) {
    return this.request<{ data: string | null }>("GET", `/api/context/engagement?userId=${encodeURIComponent(userId)}`);
  }

  setTimezone(userId: string, timezone: string) {
    return this.request<{ status: string; timezone: string }>("PUT", "/api/context/timezone", { userId, timezone });
  }

  /* ── Streaming ── */

  async *streamExecute(
    goalId: string,
    opts?: { userId?: string; signal?: AbortSignal },
  ): AsyncGenerator<StreamEvent> {
    const params = opts?.userId ? `?userId=${encodeURIComponent(opts.userId)}` : "";
    const url = `${this.baseUrl}/api/goals/${goalId}/execute/stream${params}`;

    const doFetch = async (token?: string | null) => {
      const h: Record<string, string> = { ...this.headers };
      const t = token ?? this.getToken?.();
      if (t) h["Authorization"] = `Bearer ${t}`;
      return fetch(url, { method: "GET", headers: h, credentials: "include", signal: opts?.signal });
    };

    let res = await doFetch();

    if (res.status === 401 && this.onUnauthorized) {
      const newToken = await this.onUnauthorized();
      if (newToken) {
        res = await doFetch(newToken);
      }
      if (!res.ok) {
        throw new ApiError(res.status, "Session expired");
      }
    } else if (!res.ok) {
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
    const streamHeaders: Record<string, string> = { ...this.headers };
    const dynamicToken = this.getToken?.();
    if (dynamicToken) streamHeaders["Authorization"] = `Bearer ${dynamicToken}`;
    const res = await fetch(`${this.baseUrl}/api/agents/run/stream`, {
      method: "POST",
      headers: streamHeaders,
      credentials: "include",
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

  /* ── Registered Projects ── */

  async listProjects(): Promise<RegisteredProject[]> {
    return this.request<RegisteredProject[]>("GET", "/api/projects");
  }

  async createProject(data: CreateProjectInput): Promise<RegisteredProject> {
    return this.request<RegisteredProject>("POST", "/api/projects", data);
  }

  async getProject(id: string): Promise<RegisteredProject> {
    return this.request<RegisteredProject>("GET", `/api/projects/${id}`);
  }

  async updateProject(id: string, data: UpdateProjectInput): Promise<RegisteredProject> {
    return this.request<RegisteredProject>("PUT", `/api/projects/${id}`, data);
  }

  async deleteProject(id: string): Promise<void> {
    await this.request<unknown>("DELETE", `/api/projects/${id}`);
  }

  async listProjectDependencies(id: string): Promise<ProjectDependency[]> {
    return this.request<ProjectDependency[]>("GET", `/api/projects/${id}/dependencies`);
  }

  async createProjectDependency(projectId: string, data: CreateProjectDependencyInput): Promise<ProjectDependency> {
    return this.request<ProjectDependency>("POST", `/api/projects/${projectId}/dependencies`, data);
  }

  /* ── Settings ── */

  async getSettings(): Promise<AppSettings> {
    return this.request<AppSettings>("GET", "/api/settings");
  }

  async updateBudgetThresholds(data: UpdateBudgetInput): Promise<void> {
    await this.request<void>("PUT", "/api/settings/budget", data);
  }

  /* ── Gmail ── */

  listGmailMessages(params?: { maxResults?: number }) {
    const qs = new URLSearchParams();
    if (params?.maxResults != null) qs.set("maxResults", String(params.maxResults));
    const query = qs.toString();
    return this.request<{ messages: GmailMessageSummary[] }>(
      "GET",
      `/api/gmail/messages${query ? `?${query}` : ""}`,
    );
  }

  getGmailMessage(messageId: string) {
    return this.request<GmailMessage>("GET", `/api/gmail/messages/${messageId}`);
  }

  getGmailThread(threadId: string) {
    return this.request<GmailThread>("GET", `/api/gmail/threads/${threadId}`);
  }

  searchGmail(query: string, maxResults?: number) {
    const qs = new URLSearchParams({ q: query });
    if (maxResults != null) qs.set("maxResults", String(maxResults));
    return this.request<{ messages: GmailMessageSummary[] }>(
      "GET",
      `/api/gmail/search?${qs}`,
    );
  }

  getGmailUnreadCount() {
    return this.request<{ unreadCount: number }>("GET", "/api/gmail/unread-count");
  }

  createGmailDraft(input: SendEmailInput) {
    return this.request<{ id: string; messageId: string }>("POST", "/api/gmail/drafts", input);
  }

  sendGmailMessage(input: SendEmailInput) {
    return this.request<{ id: string; threadId: string }>("POST", "/api/gmail/send", input);
  }

  sendGmailDraft(draftId: string) {
    return this.request<{ id: string; threadId: string }>(
      "POST",
      `/api/gmail/drafts/${draftId}/send`,
    );
  }

  markGmailRead(messageId: string) {
    return this.request<{ success: boolean }>(
      "POST",
      `/api/gmail/messages/${messageId}/read`,
    );
  }

  /* ── Calendar ── */

  listCalendarEvents(params?: { timeMin?: string; timeMax?: string; maxResults?: number }) {
    const qs = new URLSearchParams();
    if (params?.timeMin) qs.set("timeMin", params.timeMin);
    if (params?.timeMax) qs.set("timeMax", params.timeMax);
    if (params?.maxResults != null) qs.set("maxResults", String(params.maxResults));
    const query = qs.toString();
    return this.request<{ events: CalendarEventSummary[] }>(
      "GET",
      `/api/calendar/events${query ? `?${query}` : ""}`,
    );
  }

  getCalendarEvent(eventId: string) {
    return this.request<CalendarEvent>("GET", `/api/calendar/events/${eventId}`);
  }

  searchCalendarEvents(query: string, maxResults?: number) {
    const qs = new URLSearchParams({ q: query });
    if (maxResults != null) qs.set("maxResults", String(maxResults));
    return this.request<{ events: CalendarEventSummary[] }>(
      "GET",
      `/api/calendar/events/search?${qs}`,
    );
  }

  createCalendarEvent(input: CreateCalendarEventInput) {
    return this.request<CalendarEvent>("POST", "/api/calendar/events", input);
  }

  updateCalendarEvent(eventId: string, input: UpdateCalendarEventInput) {
    return this.request<CalendarEvent>("PATCH", `/api/calendar/events/${eventId}`, input);
  }

  deleteCalendarEvent(eventId: string) {
    return this.request<{ success: boolean }>("DELETE", `/api/calendar/events/${eventId}`);
  }

  respondToCalendarEvent(eventId: string, responseStatus: "accepted" | "declined" | "tentative") {
    return this.request<{ success: boolean; eventId: string }>(
      "POST",
      `/api/calendar/events/${eventId}/respond`,
      { responseStatus },
    );
  }

  getFreeBusy(timeMin: string, timeMax: string) {
    return this.request<FreeBusyResponse>("POST", "/api/calendar/free-busy", { timeMin, timeMax });
  }

  getMeetingPrep(eventId: string, refresh = false) {
    const qs = refresh ? "?refresh=true" : "";
    return this.request<MeetingPrepResponse>("GET", `/api/calendar/events/${eventId}/prep${qs}`);
  }

  /* ── Briefings ── */

  getTodayBriefing(refresh = false) {
    const qs = refresh ? "?refresh=true" : "";
    return this.request<TodayBriefingResponse>("GET", `/api/briefings/today${qs}`);
  }

  /* ── Follow-Ups ── */

  listFollowUps(opts?: { status?: FollowUpStatus; limit?: number; offset?: number }) {
    const qs = new URLSearchParams();
    if (opts?.status) qs.set("status", opts.status);
    if (opts?.limit != null) qs.set("limit", String(opts.limit));
    if (opts?.offset != null) qs.set("offset", String(opts.offset));
    const q = qs.toString();
    return this.request<{ data: FollowUp[]; total: number }>("GET", `/api/follow-ups${q ? `?${q}` : ""}`);
  }

  getFollowUp(id: string) {
    return this.request<FollowUp>("GET", `/api/follow-ups/${id}`);
  }

  createFollowUp(data: CreateFollowUpInput) {
    return this.request<FollowUp>("POST", "/api/follow-ups", data);
  }

  updateFollowUp(id: string, data: UpdateFollowUpInput) {
    return this.request<FollowUp>("PATCH", `/api/follow-ups/${id}`, data);
  }

  deleteFollowUp(id: string) {
    return this.request<{ deleted: boolean; id: string }>("DELETE", `/api/follow-ups/${id}`);
  }

  /* ── Decisions ── */

  listDecisions(userId: string, opts?: { q?: string; limit?: number; offset?: number }) {
    const params = new URLSearchParams({ userId });
    if (opts?.q) params.set("q", opts.q);
    if (opts?.limit != null) params.set("limit", String(opts.limit));
    if (opts?.offset != null) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request<PaginatedResponse<Memory>>("GET", `/api/decisions?${qs}`);
  }

  /* ── Global Search ── */

  globalSearch(q: string) {
    return this.request<GlobalSearchResults>("GET", `/api/search?q=${encodeURIComponent(q)}`);
  }

  /* ── Quick Actions ── */

  getQuickActions() {
    return this.request<{ data: Array<{ label: string; icon: string }> }>("GET", "/api/context/quick-actions");
  }

  /* ── Database ── */

  async queryDatabase(sqlQuery: string) {
    const params = new URLSearchParams({ sql: sqlQuery });
    return this.request<{
      rows: Record<string, unknown>[];
      rowCount: number;
      truncated: boolean;
    }>("GET", `/api/database/query?${params}`);
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
