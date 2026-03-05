import { eq, and, desc, asc, ilike, or, sql } from "drizzle-orm";
import type { Db } from "./client.js";
import {
  users,
  goals,
  tasks,
  approvals,
  conversations,
  messages,
  channelConversations,
  memories,
  prompts,
} from "./schema.js";

/* ────────────────────────── Users ────────────────────────── */

export async function findOrCreateUser(
  db: Db,
  externalId: string,
  platform: string,
  displayName?: string,
) {
  const existing = await db.select().from(users).where(eq(users.externalId, externalId)).limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(users)
    .values({ externalId, platform, displayName })
    .returning();
  return created;
}

export async function findUserByPlatform(db: Db, platform: string, externalId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.platform, platform), eq(users.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
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

/* ──────────────── Conversations ──────────────────────────── */

export async function createConversation(db: Db, data: { userId: string; title?: string }) {
  const [conv] = await db.insert(conversations).values(data).returning();
  return conv;
}

export async function getConversation(db: Db, id: string) {
  const rows = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
  return rows[0] ?? null;
}

/* ────────────────────── Messages ────────────────────────── */

export async function createMessage(
  db: Db,
  data: {
    conversationId: string;
    role: "user" | "agent" | "system";
    agentRole?: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner";
    content: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [msg] = await db.insert(messages).values(data).returning();
  return msg;
}

export async function getConversationMessages(db: Db, conversationId: string, limit = 50) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);
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

export async function listGoalsByConversation(db: Db, conversationId: string) {
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
  return db.select().from(tasks).where(eq(tasks.goalId, goalId)).orderBy(asc(tasks.orderIndex));
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
  const [approval] = await db.insert(approvals).values(data).returning();
  return approval;
}

export async function getApproval(db: Db, id: string) {
  const rows = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
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

/* ────────────────────── Memories ─────────────────────────── */

type MemoryCategory =
  | "user_info"
  | "preferences"
  | "projects"
  | "decisions"
  | "goals"
  | "technical"
  | "business"
  | "other";

export async function saveMemory(
  db: Db,
  data: {
    userId: string;
    category: MemoryCategory;
    key: string;
    content: string;
    source?: string;
    metadata?: Record<string, unknown>;
    embedding?: number[];
  },
) {
  // Upsert: if same userId + key exists, update
  const existing = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, data.userId), eq(memories.key, data.key)))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(memories)
      .set({
        content: data.content,
        category: data.category,
        source: data.source,
        ...(data.embedding ? { embedding: data.embedding } : {}),
        updatedAt: new Date(),
      })
      .where(eq(memories.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(memories).values(data).returning();
  return created;
}

export async function recallMemories(
  db: Db,
  userId: string,
  options?: { category?: string; query?: string; limit?: number },
) {
  const limit = options?.limit ?? 20;
  const conditions = [eq(memories.userId, userId)];

  if (options?.category) {
    conditions.push(eq(memories.category, options.category as MemoryCategory));
  }

  if (options?.query) {
    conditions.push(
      or(ilike(memories.key, `%${options.query}%`), ilike(memories.content, `%${options.query}%`))!,
    );
  }

  return db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.updatedAt))
    .limit(limit);
}

export async function searchMemoriesByVector(
  db: Db,
  embedding: number[],
  userId: string,
  limit = 10,
) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const rows = await db.execute(
    sql`SELECT id, user_id, category, key, content, source, metadata, created_at, updated_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM memories
        WHERE user_id = ${userId} AND embedding IS NOT NULL
        ORDER BY distance ASC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    user_id: string;
    category: string;
    key: string;
    content: string;
    source: string | null;
    metadata: unknown;
    created_at: Date;
    updated_at: Date;
    distance: number;
  }>;
}

export async function listMemoriesByUser(db: Db, userId: string) {
  return db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.updatedAt));
}

export async function deleteMemory(db: Db, id: string) {
  const [deleted] = await db.delete(memories).where(eq(memories.id, id)).returning();
  return deleted ?? null;
}

/* ────────────────── Briefing Queries ─────────────────────── */

export interface GoalSummary {
  id: string;
  title: string;
  status: string;
  priority: string;
  createdAt: Date;
  updatedAt: Date;
  taskCount: number;
  completedTaskCount: number;
}

export async function listActiveGoals(db: Db): Promise<GoalSummary[]> {
  const rows = await db
    .select({
      id: goals.id,
      title: goals.title,
      status: goals.status,
      priority: goals.priority,
      createdAt: goals.createdAt,
      updatedAt: goals.updatedAt,
    })
    .from(goals)
    .where(eq(goals.status, "active"))
    .orderBy(desc(goals.updatedAt));

  const result: GoalSummary[] = [];
  for (const goal of rows) {
    const goalTasks = await db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.goalId, goal.id));
    result.push({
      ...goal,
      taskCount: goalTasks.length,
      completedTaskCount: goalTasks.filter((t) => t.status === "completed").length,
    });
  }
  return result;
}

export async function listRecentlyCompletedGoals(db: Db, since: Date) {
  return db
    .select({
      id: goals.id,
      title: goals.title,
      updatedAt: goals.updatedAt,
    })
    .from(goals)
    .where(
      and(
        eq(goals.status, "completed"),
        sql`${goals.updatedAt} >= ${since.toISOString()}`,
      ),
    )
    .orderBy(desc(goals.updatedAt));
}

export async function countTasksByStatus(db: Db) {
  const rows = await db
    .select({ status: tasks.status })
    .from(tasks)
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(eq(goals.status, "active"));

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

/* ────────────────────── Prompts ─────────────────────────── */

export async function getActivePrompt(db: Db, name: string) {
  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.name, name), eq(prompts.isActive, 1)))
    .orderBy(desc(prompts.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPromptVersion(db: Db, name: string, version: number) {
  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.name, name), eq(prompts.version, version)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPromptVersions(db: Db, name: string) {
  return db.select().from(prompts).where(eq(prompts.name, name)).orderBy(desc(prompts.version));
}

export async function createPromptVersion(
  db: Db,
  data: { name: string; content: string; metadata?: Record<string, unknown> },
) {
  // Get the highest version number for this prompt name
  const existing = await db
    .select({ version: prompts.version })
    .from(prompts)
    .where(eq(prompts.name, data.name))
    .orderBy(desc(prompts.version))
    .limit(1);

  const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

  // Deactivate previous versions
  await db.update(prompts).set({ isActive: 0 }).where(eq(prompts.name, data.name));

  // Insert new active version
  const [created] = await db
    .insert(prompts)
    .values({
      name: data.name,
      version: nextVersion,
      content: data.content,
      isActive: 1,
      metadata: data.metadata,
    })
    .returning();
  return created;
}
