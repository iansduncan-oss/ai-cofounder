import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  integer,
  bigint,
  boolean,
  real,
  customType,
  index,
  uniqueIndex,
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
  "subagent",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull().unique(),
  platform: text("platform").notNull(), // "discord", "web", etc.
  displayName: text("display_name"),
  timezone: text("timezone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title"),
  metadata: jsonb("metadata"),
  parentConversationId: uuid("parent_conversation_id"),
  branchPointMessageId: uuid("branch_point_message_id"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "agent" | "system"
  agentRole: agentRoleEnum("agent_role"),
  content: text("content").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_messages_conversation_created").on(table.conversationId, table.createdAt),
]);

/* ── Channel ↔ Conversation mapping (Discord bot persistence) ── */

export const channelConversations = pgTable("channel_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: text("channel_id").notNull().unique(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  platform: text("platform").notNull().default("discord"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Autonomy tier enum + tool tier config ── */

export const autonomyTierEnum = pgEnum("autonomy_tier", ["green", "yellow", "red"]);

export const toolTierConfig = pgTable("tool_tier_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolName: text("tool_name").notNull().unique(),
  tier: autonomyTierEnum("tier").notNull().default("green"),
  timeoutMs: integer("timeout_ms").notNull().default(300000),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Goal / Task / Approval enums ── */

export const goalStatusEnum = pgEnum("goal_status", ["draft", "proposed", "active", "completed", "cancelled", "needs_review"]);

export const goalPriorityEnum = pgEnum("goal_priority", ["low", "medium", "high", "critical"]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "assigned",
  "running",
  "completed",
  "failed",
  "cancelled",
  "blocked",
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
    .references(() => conversations.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: milestoneStatusEnum("status").notNull().default("planned"),
  orderIndex: integer("order_index").notNull().default(0),
  dueDate: timestamp("due_date", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Goals ── */

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  milestoneId: uuid("milestone_id").references(() => milestones.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: goalStatusEnum("status").notNull().default("draft"),
  priority: goalPriorityEnum("priority").notNull().default("medium"),
  scope: text("scope"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Tasks (children of goals) ── */

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  assignedAgent: agentRoleEnum("assigned_agent"),
  orderIndex: integer("order_index").notNull().default(0),
  parallelGroup: integer("parallel_group"),
  dependsOn: jsonb("depends_on").$type<string[]>(),
  input: text("input"),
  output: text("output"),
  error: text("error"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_tasks_goal_status").on(table.goalId, table.status),
]);

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
    .references(() => users.id, { onDelete: "cascade" }),
  category: memoryCategoryEnum("category").notNull().default("other"),
  key: text("key").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  importance: integer("importance").notNull().default(50), // 0-100 score
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  source: text("source"),
  agentRole: agentRoleEnum("agent_role"),
  metadata: jsonb("metadata"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_memories_user_category").on(table.userId, table.category),
]);

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
    .references(() => tasks.id, { onDelete: "cascade" }),
  requestedBy: agentRoleEnum("requested_by").notNull(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  reason: text("reason").notNull(),
  decision: text("decision"),
  decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Code Executions (sandbox results) ── */

export const codeExecutions = pgTable("code_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
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
  userId: uuid("user_id"),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_llm_usage_created_user").on(table.createdAt, table.userId),
]);

/* ── Schedules (natural language cron) ── */

export const schedules = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
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
  scheduleId: uuid("schedule_id").references(() => schedules.id, { onDelete: "set null" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
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
    .references(() => conversations.id, { onDelete: "cascade" }),
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
  requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
  successCount: bigint("success_count", { mode: "number" }).notNull().default(0),
  errorCount: bigint("error_count", { mode: "number" }).notNull().default(0),
  avgLatencyMs: bigint("avg_latency_ms", { mode: "number" }).notNull().default(0),
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

/* ── Reflections (post-goal learning) ── */

export const reflectionTypeEnum = pgEnum("reflection_type", [
  "goal_completion",
  "failure_analysis",
  "pattern_extraction",
  "weekly_summary",
]);

export const reflections = pgTable("reflections", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  reflectionType: reflectionTypeEnum("reflection_type").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding"),
  lessons: jsonb("lessons"), // [{lesson, category, confidence}]
  agentPerformance: jsonb("agent_performance"), // {role: {success, fail, insights}}
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── RAG Document Chunks ── */

export const sourceTypeEnum = pgEnum("source_type", [
  "git",
  "conversation",
  "slack",
  "memory",
  "reflection",
  "markdown",
  "document",
]);

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceId: text("source_id").notNull(), // repo path, conversation ID, etc.
  content: text("content").notNull(),
  embedding: vector("embedding"),
  metadata: jsonb("metadata"), // file path, language, line range, author, timestamp
  chunkIndex: integer("chunk_index").notNull(),
  tokenCount: integer("token_count").notNull(),
  searchVector: text("search_vector"), // tsvector managed by DB trigger
  contextPrefix: text("context_prefix"), // contextual retrieval prefix
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ingestionState = pgTable("ingestion_state", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceType: sourceTypeEnum("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }).notNull().defaultNow(),
  lastCursor: text("last_cursor"), // git SHA, message timestamp, etc.
  chunkCount: integer("chunk_count").notNull().default(0),
});

/* ── Admin Users (dashboard auth) ── */

export const adminUsers = pgTable("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Google OAuth Tokens ── */

export const googleTokens = pgTable("google_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminUserId: uuid("admin_user_id")
    .notNull()
    .unique()
    .references(() => adminUsers.id, { onDelete: "cascade" }),
  accessTokenEncrypted: text("access_token_encrypted").notNull(),
  refreshTokenEncrypted: text("refresh_token_encrypted").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  scopes: text("scopes").notNull(), // space-delimited scope string
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Personas ── */

export const personas = pgTable("personas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  voiceId: text("voice_id"),
  corePersonality: text("core_personality").notNull(),
  capabilities: text("capabilities"),
  behavioralGuidelines: text("behavioral_guidelines"),
  isActive: boolean("is_active").notNull().default(false),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── User Actions (action tracking for pattern learning) ── */

export const userActionTypeEnum = pgEnum("user_action_type", [
  "chat_message",
  "goal_created",
  "deploy_triggered",
  "suggestion_accepted",
  "approval_submitted",
  "schedule_created",
  "tool_executed",
  "goal_viewed",
  "goal_executed",
]);

export const userActions = pgTable("user_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  actionType: userActionTypeEnum("action_type").notNull(),
  actionDetail: text("action_detail"),
  dayOfWeek: integer("day_of_week").notNull(), // 0=Sun..6=Sat
  hourOfDay: integer("hour_of_day").notNull(), // 0-23
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── User Patterns (learned behavioral patterns) ── */

export const userPatterns = pgTable("user_patterns", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  patternType: text("pattern_type").notNull(), // "time_preference", "sequence", "recurring_action"
  description: text("description").notNull(), // human-readable: "deploys on Fridays around 3 PM"
  triggerCondition: jsonb("trigger_condition").notNull(), // { dayOfWeek?: number, hourRange?: [start,end], afterAction?: string }
  suggestedAction: text("suggested_action").notNull(), // "Run the test suite before deploying"
  confidence: integer("confidence").notNull().default(50), // 0-100
  hitCount: integer("hit_count").notNull().default(0),
  acceptCount: integer("accept_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_user_patterns_user_type").on(table.userId, table.patternType),
]);

/* ── Deployments (deploy tracking & self-healing) ── */

export const deployStatusEnum = pgEnum("deploy_status", [
  "started",
  "building",
  "deploying",
  "verifying",
  "healthy",
  "failed",
  "rolled_back",
]);

export const deployments = pgTable("deployments", {
  id: uuid("id").primaryKey().defaultRandom(),
  commitSha: text("commit_sha").notNull(),
  shortSha: text("short_sha").notNull(),
  branch: text("branch").notNull().default("main"),
  status: deployStatusEnum("status").notNull().default("started"),
  services: jsonb("services"), // ["agent-server", "discord-bot", "slack-bot"]
  previousSha: text("previous_sha"),
  triggeredBy: text("triggered_by").notNull().default("ci"), // "ci" | "manual"
  healthChecks: jsonb("health_checks"), // [{service, status, latencyMs}]
  errorLog: text("error_log"),
  rootCauseAnalysis: text("root_cause_analysis"),
  rolledBack: boolean("rolled_back").notNull().default(false),
  rollbackSha: text("rollback_sha"),
  soakStatus: text("soak_status"), // "monitoring" | "passed" | "degraded" | "failed"
  soakStartedAt: timestamp("soak_started_at", { withTimezone: true }),
  soakCompletedAt: timestamp("soak_completed_at", { withTimezone: true }),
  soakMetrics: jsonb("soak_metrics"), // [{checkAt, latencyMs, containerRestarts, healthy}]
  remediationActions: jsonb("remediation_actions"), // [{action, result, timestamp}]
  gitDiffSummary: text("git_diff_summary"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* ── Deploy Circuit Breaker (single-row state for auto-deploy pause) ── */

export const deployCircuitBreaker = pgTable("deploy_circuit_breaker", {
  id: uuid("id").primaryKey().defaultRandom(),
  isPaused: boolean("is_paused").notNull().default(false),
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  pausedReason: text("paused_reason"),
  failureCount: integer("failure_count").notNull().default(0),
  failureWindowStart: timestamp("failure_window_start", { withTimezone: true }),
  resumedAt: timestamp("resumed_at", { withTimezone: true }),
  resumedBy: text("resumed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Session Engagement (tracks user session interaction metrics) ── */

export const sessionEngagement = pgTable("session_engagement", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  sessionStart: timestamp("session_start", { withTimezone: true }).notNull().defaultNow(),
  messageCount: integer("message_count").notNull().default(0),
  avgMessageLength: integer("avg_message_length").notNull().default(0),
  avgResponseIntervalMs: integer("avg_response_interval_ms").notNull().default(0),
  complexityScore: integer("complexity_score").notNull().default(50), // 0-100
  energyLevel: text("energy_level").notNull().default("normal"), // "high" | "normal" | "low"
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Subagent Runs (autonomous subagent execution tracking) ── */

/* ── Agent-to-Agent Messaging ── */

export const agentMessageTypeEnum = pgEnum("agent_message_type", [
  "request",
  "response",
  "broadcast",
  "notification",
  "handoff",
]);

export const agentMessageStatusEnum = pgEnum("agent_message_status", [
  "pending",
  "delivered",
  "read",
  "expired",
]);

export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  senderRole: agentRoleEnum("sender_role").notNull(),
  senderRunId: text("sender_run_id"),
  targetRole: agentRoleEnum("target_role"),
  targetRunId: text("target_run_id"),
  channel: text("channel"),
  messageType: agentMessageTypeEnum("message_type").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  correlationId: uuid("correlation_id"),
  inReplyTo: uuid("in_reply_to"),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  status: agentMessageStatusEnum("status").notNull().default("pending"),
  priority: goalPriorityEnum("priority").notNull().default("medium"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subagentRunStatusEnum = pgEnum("subagent_run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const subagentRuns = pgTable("subagent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentRequestId: text("parent_request_id"),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  instruction: text("instruction").notNull(),
  status: subagentRunStatusEnum("status").notNull().default("queued"),
  output: text("output"),
  error: text("error"),
  toolRounds: integer("tool_rounds").notNull().default(0),
  toolsUsed: jsonb("tools_used"),
  tokens: integer("tokens").notNull().default(0),
  model: text("model"),
  provider: text("provider"),
  durationMs: integer("duration_ms"),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Registered Projects (multi-project awareness) ── */

export const projectLanguageEnum = pgEnum("project_language", [
  "typescript",
  "python",
  "javascript",
  "go",
  "other",
]);

export const registeredProjects = pgTable("registered_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  repoUrl: text("repo_url"),
  workspacePath: text("workspace_path").notNull(),
  description: text("description"),
  language: projectLanguageEnum("language").notNull().default("typescript"),
  defaultBranch: text("default_branch").notNull().default("main"),
  testCommand: text("test_command"),
  isActive: boolean("is_active").notNull().default(true),
  config: jsonb("config"),
  lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectDependencies = pgTable("project_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceProjectId: uuid("source_project_id")
    .notNull()
    .references(() => registeredProjects.id, { onDelete: "cascade" }),
  targetProjectId: uuid("target_project_id")
    .notNull()
    .references(() => registeredProjects.id, { onDelete: "cascade" }),
  dependencyType: text("dependency_type").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Journal Entries (unified activity timeline) ── */

export const journalEntryTypeEnum = pgEnum("journal_entry_type", [
  "goal_started",
  "goal_completed",
  "goal_failed",
  "task_completed",
  "task_failed",
  "git_commit",
  "pr_created",
  "reflection",
  "work_session",
  "subagent_run",
  "deployment",
  "content_pipeline",
]);

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryType: journalEntryTypeEnum("entry_type").notNull(),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
  workSessionId: uuid("work_session_id").references(() => workSessions.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary"),
  details: jsonb("details"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── App Settings (key-value system configuration) ── */

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/* ── Briefing Cache (daily briefing storage) ── */

export const briefingCache = pgTable("briefing_cache", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: text("date").notNull().unique(),
  briefingText: text("briefing_text").notNull(),
  sections: jsonb("sections"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Meeting Preps (AI-generated meeting preparation notes) ── */

export const meetingPreps = pgTable("meeting_preps", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull().unique(),
  eventTitle: text("event_title").notNull(),
  eventStart: timestamp("event_start", { withTimezone: true }).notNull(),
  prepText: text("prep_text").notNull(),
  attendees: jsonb("attendees"),
  relatedMemories: jsonb("related_memories"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  notified: boolean("notified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Follow-Ups (proactive task tracking with reminders) ── */

export const followUpStatusEnum = pgEnum("follow_up_status", ["pending", "done", "dismissed"]);

export const followUps = pgTable("follow_ups", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  status: followUpStatusEnum("status").notNull().default("pending"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  source: text("source"),
  reminderSent: boolean("reminder_sent").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Thinking Traces (agent reasoning for debugging) ── */

export const thinkingTraces = pgTable("thinking_traces", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  requestId: text("request_id"),
  round: integer("round").notNull().default(0),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Pipeline Templates (content automation workflows) ── */

export const pipelineTemplates = pgTable("pipeline_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description"),
  stages: jsonb("stages").notNull(),
  defaultContext: jsonb("default_context"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Outbound Webhooks ── */

export const outboundWebhooks = pgTable("outbound_webhooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  description: text("description"),
  eventTypes: jsonb("event_types").notNull().$type<string[]>(),
  headers: jsonb("headers").$type<Record<string, string>>(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Conversation Branching ── */
// parent_conversation_id and branch_point_message_id are added via ALTER TABLE
// to avoid circular reference issues in the schema definition

/* ── Episodic Memories (conversation-level summaries) ── */

export const episodicMemories = pgTable("episodic_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
  keyDecisions: jsonb("key_decisions").default([]),
  toolsUsed: text("tools_used").array().default([]),
  goalsWorkedOn: jsonb("goals_worked_on").default([]),
  emotionalContext: text("emotional_context"),
  importance: real("importance").notNull().default(0.5),
  accessedAt: timestamp("accessed_at", { withTimezone: true }).defaultNow(),
  accessCount: integer("access_count").notNull().default(0),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Procedural Memories (learned procedures from completed goals) ── */

export const proceduralMemories = pgTable("procedural_memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  triggerPattern: text("trigger_pattern").notNull(),
  steps: jsonb("steps").notNull().default([]),
  preconditions: jsonb("preconditions").default([]),
  successCount: integer("success_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  lastUsed: timestamp("last_used", { withTimezone: true }),
  createdFromGoalId: uuid("created_from_goal_id").references(() => goals.id, { onDelete: "set null" }),
  tags: jsonb("tags").default([]),
  embedding: vector("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ── Failure Patterns (tool error tracking and resolutions) ── */

export const failurePatterns = pgTable("failure_patterns", {
  id: uuid("id").primaryKey().defaultRandom(),
  toolName: text("tool_name").notNull(),
  errorCategory: text("error_category").notNull(),
  errorMessage: text("error_message").notNull(),
  context: jsonb("context").default({}),
  resolution: text("resolution"),
  frequency: integer("frequency").notNull().default(1),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
