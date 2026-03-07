import type { ApiClient } from "@ai-cofounder/api-client";

/** Platform-agnostic context for command execution */
export interface CommandContext {
  /** The channel where the command was issued */
  channelId: string;
  /** Platform user ID (e.g. Discord snowflake, Slack member ID) */
  userId: string;
  /** Display name of the user */
  userName: string;
  /** Platform name ("discord", "slack", etc.) */
  platform: string;
}

/** Structured result from ask command */
export interface AskResult {
  response: string;
  agentRole: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  conversationId: string;
}

/** Structured result from status command */
export interface StatusResult {
  status: string;
  uptimeMinutes: number;
}

/** Structured result from goals command */
export interface GoalsResult {
  goals: Array<{ title: string; status: string; priority: string; icon: string }>;
}

/** Structured result from tasks command */
export interface TasksResult {
  tasks: Array<{ title: string; assignedAgent: string }>;
  totalCount: number;
}

/** Structured result from memory command */
export interface MemoryResult {
  sections: Array<{ category: string; items: Array<{ key: string; content: string }> }>;
  totalCount: number;
}

/** Structured result from execute command */
export interface ExecuteResult {
  goalTitle: string;
  status: string;
  completedTasks: number;
  totalTasks: number;
  tasks: Array<{ title: string; agent: string; status: string; icon: string }>;
}

/** Structured result from approve command */
export interface ApproveResult {
  approvalId: string;
}

/** Structured result from reject command */
export interface RejectResult {
  approvalId: string;
}

/** Structured result from approvals list command */
export interface ApprovalsResult {
  approvals: Array<{
    id: string;
    taskId: string;
    requestedBy: string;
    reason: string;
    createdAt: string;
  }>;
  totalCount: number;
}

/** Streaming ask result with progressive chunk callback */
export interface StreamingAskResult {
  response: string;
  agentRole: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  conversationId: string;
}

/** All possible handler results */
export type HandlerResult =
  | { type: "ask"; data: AskResult }
  | { type: "ask_streaming"; data: StreamingAskResult }
  | { type: "status"; data: StatusResult }
  | { type: "goals"; data: GoalsResult }
  | { type: "tasks"; data: TasksResult }
  | { type: "memory"; data: MemoryResult }
  | { type: "clear" }
  | { type: "execute"; data: ExecuteResult }
  | { type: "approve"; data: ApproveResult }
  | { type: "reject"; data: RejectResult }
  | { type: "approvals"; data: ApprovalsResult }
  | { type: "info"; message: string }
  | { type: "error"; message: string };

export type { ApiClient };
