/** Roles an agent can assume in the multi-agent system */
export type AgentRole = "orchestrator" | "researcher" | "coder" | "reviewer" | "planner";

/** A message passed between agents or between user and agent */
export interface AgentMessage {
  id: string;
  conversationId: string;
  role: "user" | "agent" | "system";
  agentRole?: AgentRole;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

/** Conversation between a user and the agent system */
export interface Conversation {
  id: string;
  userId: string;
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

/* ── Goal / Task / Approval types ── */

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
  createdAt: Date;
  updatedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

export interface Approval {
  id: string;
  taskId: string;
  requestedBy: AgentRole;
  status: ApprovalStatus;
  reason: string;
  decision?: string;
  decidedBy?: string;
  decidedAt?: Date;
  createdAt: Date;
}
