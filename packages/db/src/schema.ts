import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  integer,
  boolean,
  customType,
} from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});

export const agentRoleEnum = pgEnum("agent_role", [
  "orchestrator",
  "researcher",
  "coder",
  "reviewer",
  "planner",
  "debugger",
  "doc_writer",
  "verifier",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull().unique(),
  platform: text("platform").notNull(), // "discord", "web", etc.
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").notNull(), // "user" | "agent" | "system"
  agentRole: agentRoleEnum("agent_role"),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Channel ↔ Conversation mapping (Discord bot persistence) ── */

export const channelConversations = pgTable("channel_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: text("channel_id").notNull().unique(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  platform: text("platform").notNull().default("discord"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Goal / Task / Approval enums ── */

export const goalStatusEnum = pgEnum("goal_status", ["draft", "active", "completed", "cancelled", "needs_review"]);

export const goalPriorityEnum = pgEnum("goal_priority", ["low", "medium", "high", "critical"]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "assigned",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const approvalStatusEnum = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const workflowDirectionEnum = pgEnum("workflow_direction", ["inbound", "outbound", "both"]);

export const milestoneStatusEnum = pgEnum("milestone_status", [
  "planned",
  "in_progress",
  "completed",
  "cancelled",
]);

/* ── Milestones (multi-step planning) ── */

export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  title: text("title").notNull(),
  description: text("description"),
  status: milestoneStatusEnum("status").notNull().default("planned"),
  orderIndex: integer("order_index").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Goals ── */

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  milestoneId: uuid("milestone_id").references(() => milestones.id),
  title: text("title").notNull(),
  description: text("description"),
  status: goalStatusEnum("status").notNull().default("draft"),
  priority: goalPriorityEnum("priority").notNull().default("medium"),
  createdBy: uuid("created_by").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Tasks (children of goals) ── */

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  assignedAgent: agentRoleEnum("assigned_agent"),
  orderIndex: integer("order_index").notNull().default(0),
  input: text("input"),
  output: text("output"),
  error: text("error"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Memories (long-term facts about users) ── */

export const memoryCategoryEnum = pgEnum("memory_category", [
  "user_info",
  "preferences",
  "projects",
  "decisions",
  "goals",
  "technical",
  "business",
  "other",
]);

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  category: memoryCategoryEnum("category").notNull().default("other"),
  key: text("key").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  importance: integer("importance").notNull().default(50), // 0-100 score
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  source: text("source"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Prompts (versioned system prompts for agents) ── */

export const prompts = pgTable("prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  version: integer("version").notNull().default(1),
  content: text("content").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Approvals (gate tasks that need human sign-off) ── */

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  requestedBy: agentRoleEnum("requested_by").notNull(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  reason: text("reason").notNull(),
  decision: text("decision"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Code Executions (sandbox results) ── */

export const codeExecutions = pgTable("code_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id),
  language: text("language").notNull(), // "typescript" | "javascript" | "python" | "bash"
  codeHash: text("code_hash").notNull(),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  exitCode: integer("exit_code").notNull(),
  durationMs: integer("duration_ms").notNull(),
  timedOut: boolean("timed_out").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── LLM Usage Tracking ── */

export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  taskCategory: text("task_category").notNull(), // planning, conversation, simple, research, code
  agentRole: agentRoleEnum("agent_role"),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  estimatedCostUsd: integer("estimated_cost_usd_micros").notNull().default(0), // cost in microdollars ($0.000001)
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Schedules (natural language cron) ── */

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  cronExpression: text("cron_expression").notNull(),
  actionPrompt: text("action_prompt").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Events (inbound triggers) ── */

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  source: text("source").notNull(), // "github", "n8n", "cron", "manual"
  type: text("type").notNull(), // "push", "pr_opened", "workflow_complete", etc.
  payload: jsonb("payload").notNull(),
  processed: boolean("processed").notNull().default(false),
  result: text("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Work Sessions (autonomous execution logs) ── */

export const workSessions = pgTable("work_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  trigger: text("trigger").notNull(), // "schedule", "event", "manual"
  scheduleId: uuid("schedule_id").references(() => schedules.id),
  eventId: uuid("event_id").references(() => events.id),
  context: jsonb("context"),
  tokensUsed: integer("tokens_used").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  actionsTaken: jsonb("actions_taken"), // array of {action, result}
  status: text("status").notNull().default("running"), // "running", "completed", "failed"
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* ── Conversation Summaries (context window management) ── */

export const conversationSummaries = pgTable("conversation_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  summary: text("summary").notNull(),
  messageCount: integer("message_count").notNull().default(0),
  fromMessageCreatedAt: timestamp("from_message_created_at", { withTimezone: true }),
  toMessageCreatedAt: timestamp("to_message_created_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Provider Health (persisted LLM provider stats) ── */

export const providerHealth = pgTable("provider_health", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerName: text("provider_name").notNull().unique(),
  modelId: text("model_id"),
  requestCount: integer("request_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  avgLatencyMs: integer("avg_latency_ms").notNull().default(0),
  lastErrorMessage: text("last_error_message"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Tool Execution Stats (per-tool timing) ── */

export const toolExecutions = pgTable("tool_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolName: text("tool_name").notNull(),
  durationMs: integer("duration_ms").notNull(),
  success: boolean("success").notNull(),
  errorMessage: text("error_message"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── n8n Workflow Registry ── */

export const n8nWorkflows = pgTable("n8n_workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  webhookUrl: text("webhook_url").notNull(),
  direction: workflowDirectionEnum("direction").notNull().default("outbound"),
  eventType: text("event_type"),
  inputSchema: jsonb("input_schema"),
  isActive: boolean("is_active").notNull().default(true),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
