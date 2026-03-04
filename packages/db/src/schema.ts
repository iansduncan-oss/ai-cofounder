import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  integer,
} from "drizzle-orm/pg-core";

export const agentRoleEnum = pgEnum("agent_role", [
  "orchestrator",
  "researcher",
  "coder",
  "reviewer",
  "planner",
]);

export const agentRunStatusEnum = pgEnum("agent_run_status", [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  externalId: text("external_id").notNull().unique(),
  platform: text("platform").notNull(), // "discord", "web", etc.
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  agentRole: agentRoleEnum("agent_role").notNull(),
  status: agentRunStatusEnum("status").notNull().default("pending"),
  input: text("input").notNull(),
  output: text("output"),
  error: text("error"),
  parentRunId: uuid("parent_run_id"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/* ── Channel ↔ Conversation mapping (Discord bot persistence) ── */

export const channelConversations = pgTable("channel_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: text("channel_id").notNull().unique(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  platform: text("platform").notNull().default("discord"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ── Goal / Task / Approval enums ── */

export const goalStatusEnum = pgEnum("goal_status", [
  "draft",
  "active",
  "completed",
  "cancelled",
]);

export const goalPriorityEnum = pgEnum("goal_priority", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "assigned",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);

/* ── Goals ── */

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  title: text("title").notNull(),
  description: text("description"),
  status: goalStatusEnum("status").notNull().default("draft"),
  priority: goalPriorityEnum("priority").notNull().default("medium"),
  createdBy: uuid("created_by").references(() => users.id),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
