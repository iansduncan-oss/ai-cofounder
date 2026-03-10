/* ── API response types ── */

import type { AgentRole, GoalStatus } from "@ai-cofounder/shared";
export type { AgentRole, GoalStatus } from "@ai-cofounder/shared";
export type GoalPriority = "low" | "medium" | "high" | "critical";
export type TaskStatus = "pending" | "assigned" | "running" | "completed" | "failed" | "cancelled";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface Goal {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  status: GoalStatus;
  priority: GoalPriority;
  createdBy?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedAgent?: AgentRole;
  orderIndex: number;
  input?: string;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Approval {
  id: string;
  taskId: string;
  requestedBy: AgentRole;
  status: ApprovalStatus;
  reason: string;
  decision?: string;
  decidedBy?: string;
  decidedAt?: string;
  createdAt: string;
}

export interface Memory {
  id: string;
  userId: string;
  category: string;
  key: string;
  content: string;
  importance: number;
  accessCount: number;
  source?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  uptime: number;
  error?: string;
}

export interface ProviderHealth {
  provider: string;
  available: boolean;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  recentErrors: Array<{ time: string; message: string }>;
  lastSuccessAt?: string;
  lastErrorAt?: string;
}

export interface AgentRunResult {
  conversationId: string;
  agentRole: AgentRole;
  response: string;
  model: string;
  provider?: string;
  usage?: { inputTokens: number; outputTokens: number };
  plan?: {
    goalId: string;
    goalTitle: string;
    tasks: Array<{ id: string; title: string; assignedAgent: AgentRole; orderIndex: number }>;
  };
  suggestions?: string[];
}

export interface ExecutionProgress {
  goalId: string;
  goalTitle: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  currentTask?: { id: string; title: string; agent: string; status: string };
  tasks: Array<{ id: string; title: string; agent: string; status: string; output?: string }>;
}

/* ── Streaming ── */

export type StreamEventType =
  | "thinking" | "tool_call" | "tool_result" | "text_delta" | "done" | "error"
  | "started" | "progress" | "completed" | "suggestions";

export interface StreamEvent {
  type: StreamEventType;
  data: Record<string, unknown>;
}

export type MilestoneStatus = "planned" | "in_progress" | "completed" | "cancelled";

export interface Milestone {
  id: string;
  conversationId: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  orderIndex: number;
  dueDate?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneProgress {
  milestoneId: string;
  totalGoals: number;
  completedGoals: number;
  totalTasks: number;
  completedTasks: number;
  percentComplete: number;
}

export interface FileEntry {
  name: string;
  type: "file" | "directory";
  size?: number;
  permissions?: string;
}

export interface DirectoryListing {
  path: string;
  entries: FileEntry[];
}

export interface Schedule {
  id: string;
  cronExpression: string;
  actionPrompt: string;
  description?: string;
  userId?: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface UsageSummary {
  period: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  requestCount: number;
}

/* ── Pagination ── */

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

/* ── Events ── */

export interface Event {
  id: string;
  source: string;
  type: string;
  payload: unknown;
  processed: boolean;
  result?: string;
  createdAt: string;
}

/* ── Briefing ── */

export interface BriefingResponse {
  sent: boolean;
  briefing: string;
  data?: {
    activeGoals: Array<{ title: string; priority: string; progress: string }>;
    completedYesterday: Array<{ title: string }>;
    taskBreakdown: Record<string, number>;
    costsSinceYesterday: { totalCostUsd: number; requestCount: number };
    upcomingSchedules: Array<{ description: string; nextRunAt: string | null }>;
    recentSessions: Array<{ trigger: string; status: string; summary: string | null }>;
  };
}

/* ── Conversations ── */

export interface Conversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  role: "user" | "agent" | "system";
  agentRole?: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/* ── Dashboard ── */

export interface GoalSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
  completedTaskCount: number;
}

export interface DashboardSummary {
  goals: {
    activeCount: number;
    recent: GoalSummary[];
  };
  tasks: {
    pendingCount: number;
    runningCount: number;
    completedCount: number;
    failedCount: number;
  };
  providerHealth: ProviderHealth[];
  costs: {
    today: number;
    week: number;
    month: number;
  };
  recentEvents: Event[];
}

/* ── Monitoring ── */

export interface MonitoringReport {
  timestamp: string;
  github?: {
    ciStatus: GitHubCIStatus[];
    openPRs: GitHubPR[];
  };
  vps?: VPSHealthStatus;
  alerts: MonitoringAlert[];
}

export interface GitHubCIStatus {
  repo: string;
  branch: string;
  status: "success" | "failure" | "pending" | "error";
  conclusion: string | null;
  url: string;
  updatedAt: string;
}

export interface GitHubPR {
  repo: string;
  number: number;
  title: string;
  author: string;
  state: string;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface VPSHealthStatus {
  diskUsagePercent: number;
  memoryUsagePercent: number;
  cpuLoadAvg: number[];
  uptime: string;
  containers: ContainerStatus[];
}

export interface ContainerStatus {
  name: string;
  status: string;
  health?: string;
}

export interface MonitoringAlert {
  severity: "critical" | "warning" | "info";
  source: string;
  message: string;
}

/* ── Queue ── */

export interface QueueStatus {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

/* ── Tool Stats ── */

export interface ToolStat {
  toolName: string;
  totalExecutions: number;
  successCount: number;
  errorCount: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

/* ── Persona ── */

export interface Persona {
  id: string;
  name: string;
  voiceId: string | null;
  corePersonality: string;
  capabilities: string | null;
  behavioralGuidelines: string | null;
  isActive: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertPersonaInput {
  id?: string;
  name: string;
  voiceId?: string;
  corePersonality: string;
  capabilities?: string;
  behavioralGuidelines?: string;
  isActive?: boolean;
}

/* ── Pipelines ── */

export type PipelineRunState = "waiting" | "active" | "completed" | "failed" | "delayed";

export type PipelineAgentRole = "planner" | "coder" | "reviewer" | "debugger" | "researcher";

export interface PipelineStageDefinition {
  agent: PipelineAgentRole;
  prompt: string;
  dependsOnPrevious: boolean;
}

export interface PipelineStageResult {
  stageIndex: number;
  agent: string;
  status: "completed" | "failed" | "skipped";
  output?: string;
  error?: string;
}

export interface PipelineResult {
  pipelineId: string;
  goalId: string;
  status: "completed" | "failed" | "partial";
  stageResults: PipelineStageResult[];
}

export interface PipelineRun {
  jobId: string;
  pipelineId: string;
  goalId: string;
  stageCount: number;
  state: PipelineRunState;
  createdAt: string | null;
  finishedAt: string | null;
  failedReason: string | null;
  result: PipelineResult | null;
}

export interface PipelineDetail {
  jobId: string;
  pipelineId: string;
  goalId: string;
  stages: PipelineStageDefinition[];
  currentStage: number;
  context: Record<string, unknown>;
  state: PipelineRunState;
  createdAt: string | null;
  finishedAt: string | null;
  failedReason: string | null;
  result: PipelineResult | null;
}

export interface SubmitPipelineInput {
  goalId: string;
  stages: PipelineStageDefinition[];
  context?: Record<string, unknown>;
}

export interface SubmitPipelineResponse {
  jobId: string;
  status: string;
  stageCount: number;
}

export interface CancelPipelineResponse {
  cancelled: boolean;
}

export interface RetryPipelineResponse {
  jobId: string;
  status: string;
  stageCount: number;
}

/* ── Subagents ── */

export type SubagentRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface SubagentRun {
  id: string;
  parentRequestId: string | null;
  conversationId: string | null;
  goalId: string | null;
  title: string;
  instruction: string;
  status: SubagentRunStatus;
  output: string | null;
  error: string | null;
  toolRounds: number;
  toolsUsed: string[] | null;
  tokens: number;
  model: string | null;
  provider: string | null;
  durationMs: number | null;
  userId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpawnSubagentInput {
  title: string;
  instruction: string;
  conversationId?: string;
  goalId?: string;
  userId?: string;
  priority?: "critical" | "high" | "normal" | "low";
}

export interface SpawnSubagentResponse {
  subagentRunId: string;
  status: string;
  title: string;
}

/* ── Agent Messages ── */

export type AgentMessageType = "request" | "response" | "broadcast" | "notification" | "handoff";
export type AgentMessageStatus = "pending" | "delivered" | "read" | "expired";

/* ── Agent Info ── */

export interface AgentRoleInfo {
  role: AgentRole;
  description: string;
}

export interface AgentCapability {
  role: AgentRole;
  description: string;
  tools: string[];
  specialties: string[];
}

export interface UserPattern {
  id: string;
  userId: string | null;
  patternType: string;
  description: string;
  triggerCondition: Record<string, unknown>;
  suggestedAction: string;
  confidence: number;
  hitCount: number;
  acceptCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AutonomyTier = "green" | "yellow" | "red";

export interface ToolTierConfig {
  toolName: string;
  tier: AutonomyTier;
  timeoutMs: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface AgentMessageItem {
  id: string;
  senderRole: string;
  senderRunId: string | null;
  targetRole: string | null;
  targetRunId: string | null;
  channel: string | null;
  messageType: AgentMessageType;
  subject: string;
  body: string;
  correlationId: string | null;
  inReplyTo: string | null;
  goalId: string | null;
  taskId: string | null;
  conversationId: string | null;
  status: AgentMessageStatus;
  priority: string;
  expiresAt: string | null;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
