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

/** Structured result from help command */
export interface HelpResult {
  commands: Array<{ name: string; description: string }>;
}

/** Structured result from schedule list command */
export interface ScheduleListResult {
  schedules: Array<{
    id: string;
    cronExpression: string;
    description?: string;
    enabled: boolean;
    nextRunAt: string;
  }>;
  totalCount: number;
}

/** Structured result from schedule create command */
export interface ScheduleCreateResult {
  id: string;
  cronExpression: string;
  description?: string;
}

/** Structured result from gmail inbox command */
export interface GmailInboxResult {
  messages: Array<{ from: string; subject: string; date: string; isUnread: boolean }>;
  unreadCount: number;
}

/** Structured result from gmail send command */
export interface GmailSendResult {
  to: string;
  subject: string;
}

/** Structured result from register command */
export interface RegisterResult {
  userId: string;
  displayName?: string;
  isNew: boolean;
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
  | { type: "help"; data: HelpResult }
  | { type: "schedule_list"; data: ScheduleListResult }
  | { type: "schedule_create"; data: ScheduleCreateResult }
  | { type: "gmail_inbox"; data: GmailInboxResult }
  | { type: "gmail_send"; data: GmailSendResult }
  | { type: "register"; data: RegisterResult }
  | { type: "info"; message: string }
  | { type: "error"; message: string };

export type { ApiClient };
