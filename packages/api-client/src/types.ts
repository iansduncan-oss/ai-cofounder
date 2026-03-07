/* ── API response types ── */

export type AgentRole = "orchestrator" | "researcher" | "coder" | "reviewer" | "planner";
export type GoalStatus = "draft" | "active" | "completed" | "cancelled";
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

export type StreamEventType = "thinking" | "tool_call" | "tool_result" | "text_delta" | "done" | "error";

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
