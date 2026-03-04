import { eq, and, desc, asc } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  users,
  goals,
  tasks,
  approvals,
  conversations,
  messages,
  channelConversations,
} from "./schema.js";

/* ────────────────────────── Users ────────────────────────── */

export async function findOrCreateUser(
  db: Db,
  externalId: string,
  platform: string,
  displayName?: string,
) {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.externalId, externalId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(users)
    .values({ externalId, platform, displayName })
    .returning();
  return created;
}

/* ──────────────── Channel Conversations ──────────────────── */

export async function getChannelConversation(db: Db, channelId: string) {
  const rows = await db
    .select()
    .from(channelConversations)
    .where(eq(channelConversations.channelId, channelId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertChannelConversation(
  db: Db,
  channelId: string,
  conversationId: string,
  platform = "discord",
) {
  const existing = await getChannelConversation(db, channelId);
  if (existing) {
    const [updated] = await db
      .update(channelConversations)
      .set({ conversationId, updatedAt: new Date() })
      .where(eq(channelConversations.channelId, channelId))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(channelConversations)
    .values({ channelId, conversationId, platform })
    .returning();
  return created;
}

/* ────────────────────────── Goals ────────────────────────── */

export async function createGoal(
  db: Db,
  data: {
    conversationId: string;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "critical";
    createdBy?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [goal] = await db.insert(goals).values(data).returning();
  return goal;
}

export async function getGoal(db: Db, id: string) {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listGoalsByConversation(
  db: Db,
  conversationId: string,
) {
  return db
    .select()
    .from(goals)
    .where(eq(goals.conversationId, conversationId))
    .orderBy(desc(goals.createdAt));
}

export async function updateGoalStatus(
  db: Db,
  id: string,
  status: "draft" | "active" | "completed" | "cancelled",
) {
  const [updated] = await db
    .update(goals)
    .set({ status, updatedAt: new Date() })
    .where(eq(goals.id, id))
    .returning();
  return updated ?? null;
}

/* ────────────────────────── Tasks ────────────────────────── */

export async function createTask(
  db: Db,
  data: {
    goalId: string;
    title: string;
    description?: string;
    assignedAgent?: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner";
    orderIndex?: number;
    input?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
}

export async function getTask(db: Db, id: string) {
  const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listTasksByGoal(db: Db, goalId: string) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.goalId, goalId))
    .orderBy(asc(tasks.orderIndex));
}

export async function listPendingTasks(db: Db, limit = 50) {
  return db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "pending"))
    .orderBy(asc(tasks.createdAt))
    .limit(limit);
}

export async function assignTask(
  db: Db,
  id: string,
  agent: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner",
) {
  const [updated] = await db
    .update(tasks)
    .set({ status: "assigned" as const, assignedAgent: agent, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return updated ?? null;
}

export async function startTask(db: Db, id: string) {
  const [updated] = await db
    .update(tasks)
    .set({ status: "running" as const, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return updated ?? null;
}

export async function completeTask(db: Db, id: string, output: string) {
  const [updated] = await db
    .update(tasks)
    .set({ status: "completed" as const, output, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return updated ?? null;
}

export async function failTask(db: Db, id: string, error: string) {
  const [updated] = await db
    .update(tasks)
    .set({ status: "failed" as const, error, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return updated ?? null;
}

/* ────────────────────────── Approvals ────────────────────── */

export async function createApproval(
  db: Db,
  data: {
    taskId: string;
    requestedBy: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner";
    reason: string;
  },
) {
  const [approval] = await db
    .insert(approvals)
    .values(data)
    .returning();
  return approval;
}

export async function getApproval(db: Db, id: string) {
  const rows = await db
    .select()
    .from(approvals)
    .where(eq(approvals.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPendingApprovals(db: Db, limit = 50) {
  return db
    .select()
    .from(approvals)
    .where(eq(approvals.status, "pending"))
    .orderBy(asc(approvals.createdAt))
    .limit(limit);
}

export async function listApprovalsByTask(db: Db, taskId: string) {
  return db
    .select()
    .from(approvals)
    .where(eq(approvals.taskId, taskId))
    .orderBy(desc(approvals.createdAt));
}

export async function resolveApproval(
  db: Db,
  id: string,
  status: "approved" | "rejected",
  decision: string,
  decidedBy?: string,
) {
  const [updated] = await db
    .update(approvals)
    .set({
      status,
      decision,
      decidedBy,
      decidedAt: new Date(),
    })
    .where(eq(approvals.id, id))
    .returning();
  return updated ?? null;
}
