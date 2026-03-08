import { eq, and, desc, asc, ilike, or, sql, lte } from "drizzle-orm";
import type { Db } from "./client.js";
import type { AgentRole } from "@ai-cofounder/shared";
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
  n8nWorkflows,
  codeExecutions,
  llmUsage,
  schedules,
  events,
  workSessions,
  milestones,
  conversationSummaries,
  providerHealth,
  toolExecutions,
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
  const [result] = await db
    .insert(channelConversations)
    .values({ channelId, conversationId, platform })
    .onConflictDoUpdate({
      target: channelConversations.channelId,
      set: { conversationId, updatedAt: new Date() },
    })
    .returning();
  return result;
}

export async function deleteChannelConversation(db: Db, channelId: string) {
  await db.delete(channelConversations).where(eq(channelConversations.channelId, channelId));
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
    agentRole?: AgentRole;
    content: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [msg] = await db.insert(messages).values(data).returning();
  return msg;
}

export async function getConversationMessages(db: Db, conversationId: string, limit = 50, offset = 0) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
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
    milestoneId?: string;
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
  options?: { limit?: number; offset?: number },
) {
  let query = db
    .select()
    .from(goals)
    .where(eq(goals.conversationId, conversationId))
    .orderBy(desc(goals.createdAt))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countGoalsByConversation(db: Db, conversationId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(goals)
    .where(eq(goals.conversationId, conversationId));
  return rows[0]?.count ?? 0;
}

export async function updateGoalStatus(
  db: Db,
  id: string,
  status: "draft" | "active" | "completed" | "cancelled" | "needs_review",
) {
  const [updated] = await db
    .update(goals)
    .set({ status, updatedAt: new Date() })
    .where(eq(goals.id, id))
    .returning();
  return updated ?? null;
}

export async function updateGoalMetadata(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
) {
  const goal = await getGoal(db, id);
  if (!goal) return null;

  const merged = { ...(goal.metadata as Record<string, unknown> ?? {}), ...metadata };
  const [updated] = await db
    .update(goals)
    .set({ metadata: merged, updatedAt: new Date() })
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
    assignedAgent?: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier";
    orderIndex?: number;
    parallelGroup?: number;
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

export async function listTasksByGoal(
  db: Db,
  goalId: string,
  options?: { limit?: number; offset?: number },
) {
  let query = db
    .select()
    .from(tasks)
    .where(eq(tasks.goalId, goalId))
    .orderBy(asc(tasks.orderIndex))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countTasksByGoal(db: Db, goalId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.goalId, goalId));
  return rows[0]?.count ?? 0;
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
  agent: AgentRole,
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
  const importance = computeImportance(data.category, data.content);

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
        importance,
        ...(data.embedding ? { embedding: data.embedding } : {}),
        updatedAt: new Date(),
      })
      .where(eq(memories.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db.insert(memories).values({ ...data, importance }).returning();
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
    .orderBy(desc(memories.importance), desc(memories.updatedAt))
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

export async function listMemoriesByUser(
  db: Db,
  userId: string,
  options?: { limit?: number; offset?: number },
) {
  let query = db
    .select()
    .from(memories)
    .where(eq(memories.userId, userId))
    .orderBy(desc(memories.updatedAt))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countMemoriesByUser(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(eq(memories.userId, userId));
  return rows[0]?.count ?? 0;
}

export async function deleteMemory(db: Db, id: string) {
  const [deleted] = await db.delete(memories).where(eq(memories.id, id)).returning();
  return deleted ?? null;
}

/** Compute importance score for a memory (0-100) based on category and content */
export function computeImportance(category: string, content: string): number {
  // Base score by category
  const categoryScores: Record<string, number> = {
    decisions: 80,
    goals: 75,
    projects: 70,
    technical: 65,
    business: 65,
    preferences: 60,
    user_info: 55,
    other: 40,
  };
  let score = categoryScores[category] ?? 50;

  // Boost for longer, more detailed content
  if (content.length > 200) score += 10;
  else if (content.length > 50) score += 5;

  return Math.min(100, Math.max(0, score));
}

/** Record that a memory was accessed (for recall ranking) */
export async function touchMemory(db: Db, id: string) {
  const [updated] = await db
    .update(memories)
    .set({
      accessCount: sql`${memories.accessCount} + 1`,
      lastAccessedAt: new Date(),
    })
    .where(eq(memories.id, id))
    .returning();
  return updated ?? null;
}

/** Decay importance of old, unused memories. Call periodically (e.g. daily). */
export async function decayMemoryImportance(db: Db, userId: string, decayAmount = 2) {
  // Only decay memories that haven't been accessed in 7+ days and have importance > 10
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .update(memories)
    .set({
      importance: sql`GREATEST(10, ${memories.importance} - ${decayAmount})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(memories.userId, userId),
        sql`${memories.importance} > 10`,
        or(
          sql`${memories.lastAccessedAt} < ${cutoff.toISOString()}`,
          sql`${memories.lastAccessedAt} IS NULL`,
        )!,
      ),
    );
}

/** Decay importance of all old, unused memories across all users. Call periodically (e.g. daily). */
export async function decayAllMemoryImportance(db: Db, decayAmount = 2) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db
    .update(memories)
    .set({
      importance: sql`GREATEST(10, ${memories.importance} - ${decayAmount})`,
      updatedAt: new Date(),
    })
    .where(
      and(
        sql`${memories.importance} > 10`,
        or(
          sql`${memories.lastAccessedAt} < ${cutoff.toISOString()}`,
          sql`${memories.lastAccessedAt} IS NULL`,
        )!,
      ),
    );
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
      taskCount: sql<number>`count(${tasks.id})::int`.as("task_count"),
      completedTaskCount: sql<number>`count(case when ${tasks.status} = 'completed' then 1 end)::int`.as("completed_task_count"),
    })
    .from(goals)
    .leftJoin(tasks, eq(tasks.goalId, goals.id))
    .where(eq(goals.status, "active"))
    .groupBy(goals.id)
    .orderBy(desc(goals.updatedAt));

  return rows;
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
    .where(and(eq(prompts.name, name), eq(prompts.isActive, true)))
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
  await db.update(prompts).set({ isActive: false }).where(eq(prompts.name, data.name));

  // Insert new active version
  const [created] = await db
    .insert(prompts)
    .values({
      name: data.name,
      version: nextVersion,
      content: data.content,
      isActive: true,
      metadata: data.metadata,
    })
    .returning();
  return created;
}

/* ────────────────── n8n Workflows ─────────────────────── */

type WorkflowDirection = "inbound" | "outbound" | "both";

export async function createN8nWorkflow(
  db: Db,
  data: {
    name: string;
    description?: string;
    webhookUrl: string;
    direction?: WorkflowDirection;
    eventType?: string;
    inputSchema?: Record<string, unknown>;
    isActive?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  const [workflow] = await db.insert(n8nWorkflows).values(data).returning();
  return workflow;
}

export async function updateN8nWorkflow(
  db: Db,
  id: string,
  data: Partial<{
    name: string;
    description: string;
    webhookUrl: string;
    direction: WorkflowDirection;
    eventType: string;
    inputSchema: Record<string, unknown>;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>,
) {
  const [updated] = await db
    .update(n8nWorkflows)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(n8nWorkflows.id, id))
    .returning();
  return updated ?? null;
}

export async function getN8nWorkflow(db: Db, id: string) {
  const rows = await db.select().from(n8nWorkflows).where(eq(n8nWorkflows.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getN8nWorkflowByName(db: Db, name: string) {
  const rows = await db
    .select()
    .from(n8nWorkflows)
    .where(and(eq(n8nWorkflows.name, name), eq(n8nWorkflows.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listN8nWorkflows(db: Db, direction?: WorkflowDirection) {
  const conditions = [eq(n8nWorkflows.isActive, true)];
  if (direction) {
    conditions.push(
      or(eq(n8nWorkflows.direction, direction), eq(n8nWorkflows.direction, "both"))!,
    );
  }
  return db
    .select()
    .from(n8nWorkflows)
    .where(and(...conditions))
    .orderBy(asc(n8nWorkflows.name));
}

export async function findN8nWorkflowByEvent(db: Db, eventType: string) {
  const rows = await db
    .select()
    .from(n8nWorkflows)
    .where(and(eq(n8nWorkflows.eventType, eventType), eq(n8nWorkflows.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteN8nWorkflow(db: Db, id: string) {
  const [deleted] = await db.delete(n8nWorkflows).where(eq(n8nWorkflows.id, id)).returning();
  return deleted ?? null;
}

/* ────────────────────── Code Executions ────────────────────── */

export async function saveCodeExecution(
  db: Db,
  data: {
    taskId?: string;
    language: string;
    codeHash: string;
    stdout: string;
    stderr: string;
    exitCode: number;
    durationMs: number;
    timedOut?: boolean;
  },
) {
  const [execution] = await db
    .insert(codeExecutions)
    .values({
      taskId: data.taskId,
      language: data.language,
      codeHash: data.codeHash,
      stdout: data.stdout,
      stderr: data.stderr,
      exitCode: data.exitCode,
      durationMs: data.durationMs,
      timedOut: data.timedOut ?? false,
    })
    .returning();
  return execution;
}

export async function listCodeExecutionsByTask(db: Db, taskId: string) {
  return db
    .select()
    .from(codeExecutions)
    .where(eq(codeExecutions.taskId, taskId))
    .orderBy(desc(codeExecutions.createdAt));
}

/* ────────────────── LLM Usage Tracking ─────────────────── */

/** Per-model pricing in microdollars per token ($0.000001 = 1 microdollar) */
const PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  "claude-opus-4-20250901": { input: 15_000, output: 75_000 }, // $15/$75 per MTok
  "claude-sonnet-4-20250514": { input: 3_000, output: 15_000 }, // $3/$15 per MTok
  // Groq (free tier)
  "llama-3.1-8b-instant": { input: 0, output: 0 },
  "llama-3.3-70b-versatile": { input: 0, output: 0 },
  // Gemini
  "gemini-2.5-pro": { input: 1_250, output: 10_000 }, // $1.25/$10 per MTok
  "gemini-2.5-flash": { input: 150, output: 600 }, // $0.15/$0.60 per MTok
  // OpenRouter free models
  "meta-llama/llama-3.3-70b-instruct:free": { input: 0, output: 0 },
};

function estimateCostMicros(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  // pricing is per million tokens, so divide by 1_000_000
  return Math.round((inputTokens * price.input + outputTokens * price.output) / 1_000_000);
}

export async function recordLlmUsage(
  db: Db,
  data: {
    provider: string;
    model: string;
    taskCategory: string;
    agentRole?: AgentRole;
    inputTokens: number;
    outputTokens: number;
    goalId?: string;
    taskId?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const costMicros = estimateCostMicros(data.model, data.inputTokens, data.outputTokens);
  const [record] = await db
    .insert(llmUsage)
    .values({
      ...data,
      estimatedCostUsd: costMicros,
    })
    .returning();
  return record;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number; // in dollars
  byProvider: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byModel: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  byAgent: Record<string, { inputTokens: number; outputTokens: number; costUsd: number; requests: number }>;
  requestCount: number;
}

export async function getTodayTokenTotal(db: Db): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const rows = await db
    .select({
      total: sql<number>`coalesce(sum(${llmUsage.inputTokens} + ${llmUsage.outputTokens}), 0)::int`,
    })
    .from(llmUsage)
    .where(sql`${llmUsage.createdAt} >= ${todayStart.toISOString()}`);
  return rows[0]?.total ?? 0;
}

export async function getUsageSummary(
  db: Db,
  options?: { since?: Date; until?: Date },
): Promise<UsageSummary> {
  const conditions = [];
  if (options?.since) {
    conditions.push(sql`${llmUsage.createdAt} >= ${options.since.toISOString()}`);
  }
  if (options?.until) {
    conditions.push(sql`${llmUsage.createdAt} < ${options.until.toISOString()}`);
  }

  const rows = await db
    .select()
    .from(llmUsage)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(llmUsage.createdAt));

  const summary: UsageSummary = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    byProvider: {},
    byModel: {},
    byAgent: {},
    requestCount: rows.length,
  };

  for (const row of rows) {
    const costUsd = (row.estimatedCostUsd ?? 0) / 1_000_000;
    summary.totalInputTokens += row.inputTokens;
    summary.totalOutputTokens += row.outputTokens;
    summary.totalCostUsd += costUsd;

    // By provider
    const prov = summary.byProvider[row.provider] ??= { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
    prov.inputTokens += row.inputTokens;
    prov.outputTokens += row.outputTokens;
    prov.costUsd += costUsd;
    prov.requests++;

    // By model
    const mod = summary.byModel[row.model] ??= { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
    mod.inputTokens += row.inputTokens;
    mod.outputTokens += row.outputTokens;
    mod.costUsd += costUsd;
    mod.requests++;

    // By agent
    const agent = row.agentRole ?? "unknown";
    const ag = summary.byAgent[agent] ??= { inputTokens: 0, outputTokens: 0, costUsd: 0, requests: 0 };
    ag.inputTokens += row.inputTokens;
    ag.outputTokens += row.outputTokens;
    ag.costUsd += costUsd;
    ag.requests++;
  }

  // Round dollar amounts
  summary.totalCostUsd = Math.round(summary.totalCostUsd * 1_000_000) / 1_000_000;

  return summary;
}

/* ────────────────────── Schedules ────────────────────── */

export async function createSchedule(
  db: Db,
  data: {
    userId?: string;
    cronExpression: string;
    actionPrompt: string;
    description?: string;
    enabled?: boolean;
    nextRunAt?: Date;
  },
) {
  const [schedule] = await db
    .insert(schedules)
    .values(data)
    .returning();
  return schedule;
}

export async function listSchedules(db: Db, userId?: string) {
  if (userId) {
    return db.select().from(schedules).where(eq(schedules.userId, userId)).orderBy(asc(schedules.createdAt));
  }
  return db.select().from(schedules).orderBy(asc(schedules.createdAt));
}

export async function listEnabledSchedules(db: Db) {
  return db.select().from(schedules).where(eq(schedules.enabled, true)).orderBy(asc(schedules.nextRunAt));
}

export async function getSchedule(db: Db, id: string) {
  const rows = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function updateScheduleLastRun(db: Db, id: string, lastRunAt: Date, nextRunAt: Date) {
  const [updated] = await db
    .update(schedules)
    .set({ lastRunAt, nextRunAt, updatedAt: new Date() })
    .where(eq(schedules.id, id))
    .returning();
  return updated;
}

export async function deleteSchedule(db: Db, id: string) {
  const [deleted] = await db.delete(schedules).where(eq(schedules.id, id)).returning();
  return deleted ?? null;
}

export async function toggleSchedule(db: Db, id: string, enabled: boolean) {
  const [updated] = await db
    .update(schedules)
    .set({ enabled, updatedAt: new Date() })
    .where(eq(schedules.id, id))
    .returning();
  return updated;
}

/* ────────────────────── Events ────────────────────── */

export async function createEvent(
  db: Db,
  data: { source: string; type: string; payload: unknown },
) {
  const [event] = await db.insert(events).values(data).returning();
  return event;
}

export async function markEventProcessed(db: Db, id: string, result?: string) {
  const [updated] = await db
    .update(events)
    .set({ processed: true, result })
    .where(eq(events.id, id))
    .returning();
  return updated;
}

export async function listEvents(
  db: Db,
  options?: { limit?: number; offset?: number },
) {
  let query = db
    .select()
    .from(events)
    .orderBy(desc(events.createdAt))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countEvents(db: Db): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events);
  return rows[0]?.count ?? 0;
}

export async function listUnprocessedEvents(db: Db, limit = 20) {
  return db
    .select()
    .from(events)
    .where(eq(events.processed, false))
    .orderBy(asc(events.createdAt))
    .limit(limit);
}

/* ────────────────────── Work Sessions ────────────────────── */

export async function createWorkSession(
  db: Db,
  data: {
    trigger: string;
    scheduleId?: string;
    eventId?: string;
    context?: unknown;
  },
) {
  const [session] = await db.insert(workSessions).values(data).returning();
  return session;
}

export async function completeWorkSession(
  db: Db,
  id: string,
  data: {
    tokensUsed: number;
    durationMs: number;
    actionsTaken?: unknown;
    status: string;
    summary?: string;
  },
) {
  const [updated] = await db
    .update(workSessions)
    .set({ ...data, completedAt: new Date() })
    .where(eq(workSessions.id, id))
    .returning();
  return updated;
}

export async function listRecentWorkSessions(db: Db, limit = 10) {
  return db
    .select()
    .from(workSessions)
    .orderBy(desc(workSessions.createdAt))
    .limit(limit);
}

/* ────────────────────── Milestones ──────────────────────── */

type MilestoneStatus = "planned" | "in_progress" | "completed" | "cancelled";

export async function createMilestone(
  db: Db,
  data: {
    conversationId: string;
    title: string;
    description?: string;
    orderIndex?: number;
    dueDate?: Date;
    createdBy?: string;
  },
) {
  const [milestone] = await db
    .insert(milestones)
    .values({
      conversationId: data.conversationId,
      title: data.title,
      description: data.description,
      orderIndex: data.orderIndex ?? 0,
      dueDate: data.dueDate,
      createdBy: data.createdBy,
    })
    .returning();
  return milestone;
}

export async function getMilestone(db: Db, id: string) {
  const rows = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listMilestonesByConversation(db: Db, conversationId: string) {
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.conversationId, conversationId))
    .orderBy(asc(milestones.orderIndex));
}

export async function updateMilestoneStatus(db: Db, id: string, status: MilestoneStatus) {
  const values: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "completed") values.completedAt = new Date();

  const [updated] = await db.update(milestones).set(values).where(eq(milestones.id, id)).returning();
  return updated ?? null;
}

export async function getMilestoneProgress(db: Db, milestoneId: string) {
  const milestoneGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.milestoneId, milestoneId))
    .orderBy(asc(goals.createdAt));

  const total = milestoneGoals.length;
  const completed = milestoneGoals.filter((g) => g.status === "completed").length;
  const active = milestoneGoals.filter((g) => g.status === "active").length;

  return {
    total,
    completed,
    active,
    pending: total - completed - active,
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
    goals: milestoneGoals,
  };
}

export async function assignGoalToMilestone(db: Db, goalId: string, milestoneId: string) {
  const [updated] = await db
    .update(goals)
    .set({ milestoneId, updatedAt: new Date() })
    .where(eq(goals.id, goalId))
    .returning();
  return updated ?? null;
}

export async function deleteMilestone(db: Db, id: string) {
  // Unlink goals first
  await db.update(goals).set({ milestoneId: null }).where(eq(goals.milestoneId, id));
  const [deleted] = await db.delete(milestones).where(eq(milestones.id, id)).returning();
  return deleted ?? null;
}

/* ────────────────── Conversation Summaries ──────────────── */

export async function getConversationMessageCount(db: Db, conversationId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
  return rows[0]?.count ?? 0;
}

export async function saveConversationSummary(
  db: Db,
  data: {
    conversationId: string;
    summary: string;
    messageCount: number;
    fromMessageCreatedAt?: Date;
    toMessageCreatedAt?: Date;
  },
) {
  const [created] = await db.insert(conversationSummaries).values(data).returning();
  return created;
}

export async function getLatestConversationSummary(db: Db, conversationId: string) {
  const rows = await db
    .select()
    .from(conversationSummaries)
    .where(eq(conversationSummaries.conversationId, conversationId))
    .orderBy(desc(conversationSummaries.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/* ────────────────── Provider Health ──────────────────────── */

export async function upsertProviderHealth(
  db: Db,
  data: {
    providerName: string;
    modelId?: string;
    requestCount: number;
    successCount: number;
    errorCount: number;
    avgLatencyMs: number;
    lastErrorMessage?: string;
    lastErrorAt?: Date;
    lastSuccessAt?: Date;
  },
) {
  const [result] = await db
    .insert(providerHealth)
    .values({ ...data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: providerHealth.providerName,
      set: {
        requestCount: sql`${providerHealth.requestCount} + ${data.requestCount}`,
        successCount: sql`${providerHealth.successCount} + ${data.successCount}`,
        errorCount: sql`${providerHealth.errorCount} + ${data.errorCount}`,
        avgLatencyMs: data.avgLatencyMs,
        lastErrorMessage: data.lastErrorMessage,
        lastErrorAt: data.lastErrorAt,
        lastSuccessAt: data.lastSuccessAt,
        updatedAt: new Date(),
      },
    })
    .returning();
  return result;
}

export async function getProviderHealthRecords(db: Db) {
  return db.select().from(providerHealth).orderBy(asc(providerHealth.providerName));
}

export async function getProviderHealthHistory(db: Db, providerName?: string) {
  if (providerName) {
    return db
      .select()
      .from(providerHealth)
      .where(eq(providerHealth.providerName, providerName))
      .orderBy(desc(providerHealth.updatedAt));
  }
  return db.select().from(providerHealth).orderBy(desc(providerHealth.updatedAt));
}

/* ────────────────── Tool Executions ──────────────────────── */

export async function recordToolExecution(
  db: Db,
  data: {
    toolName: string;
    durationMs: number;
    success: boolean;
    errorMessage?: string;
    requestId?: string;
  },
) {
  const [record] = await db.insert(toolExecutions).values(data).returning();
  return record;
}

export async function getToolStats(db: Db) {
  const rows = await db
    .select({
      toolName: toolExecutions.toolName,
      totalExecutions: sql<number>`count(*)::int`,
      successCount: sql<number>`count(case when ${toolExecutions.success} then 1 end)::int`,
      errorCount: sql<number>`count(case when not ${toolExecutions.success} then 1 end)::int`,
      avgDurationMs: sql<number>`round(avg(${toolExecutions.durationMs}))::int`,
      p95DurationMs: sql<number>`round(percentile_cont(0.95) within group (order by ${toolExecutions.durationMs}))::int`,
      maxDurationMs: sql<number>`max(${toolExecutions.durationMs})::int`,
    })
    .from(toolExecutions)
    .groupBy(toolExecutions.toolName)
    .orderBy(asc(toolExecutions.toolName));
  return rows;
}

/* ────────────────── Decision Log ──────────────── */

export async function listDecisions(
  db: Db,
  userId: string,
  options?: { query?: string; limit?: number; offset?: number },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const conditions = [
    eq(memories.userId, userId),
    eq(memories.category, "decisions" as MemoryCategory),
  ];

  if (options?.query) {
    conditions.push(
      or(ilike(memories.key, `%${options.query}%`), ilike(memories.content, `%${options.query}%`))!,
    );
  }

  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memories)
      .where(and(...conditions)),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

/* ────────────────── Conversation Search ──────────────── */

export async function searchMessages(
  db: Db,
  query: string,
  options?: {
    conversationId?: string;
    role?: "user" | "agent" | "system";
    limit?: number;
    offset?: number;
  },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const conditions = [ilike(messages.content, `%${query}%`)];

  if (options?.conversationId) {
    conditions.push(eq(messages.conversationId, options.conversationId));
  }
  if (options?.role) {
    conditions.push(eq(messages.role, options.role));
  }

  const [data, countRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        role: messages.role,
        agentRole: messages.agentRole,
        content: messages.content,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(...conditions)),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

export async function listConversationsByUser(
  db: Db,
  userId: string,
  options?: { limit?: number; offset?: number },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(eq(conversations.userId, userId)),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

/* ────────────────── User Activity ──────────────── */

export async function getLatestUserMessageTime(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ latest: sql<Date>`max(${messages.createdAt})` })
    .from(messages)
    .where(eq(messages.role, "user"));
  return rows[0]?.latest ?? null;
}

/* ────────────────── Due Schedules ──────────────── */

export async function listDueSchedules(db: Db) {
  return db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.enabled, true),
        lte(schedules.nextRunAt, new Date()),
      ),
    )
    .orderBy(asc(schedules.nextRunAt));
}
