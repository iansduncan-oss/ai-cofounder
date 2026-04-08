import { eq, and, desc, asc, ilike, or, sql, lte, isNull, isNotNull, inArray, gt } from "drizzle-orm";
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
  personas,
  documentChunks,
  ingestionState,
  reflections,
  adminUsers,
  subagentRuns,
  agentMessages,
  userActions,
  userPatterns,
  deployments,
  toolTierConfig,
  deployCircuitBreaker,
  sessionEngagement,
  journalEntries,
  registeredProjects,
  projectDependencies,
  pipelineTemplates,
  googleTokens,
  briefingCache,
  meetingPreps,
  followUps,
  thinkingTraces,
  episodicMemories,
  proceduralMemories,
  failurePatterns,
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

export async function createConversation(db: Db, data: { userId: string; workspaceId?: string; title?: string }) {
  const [conv] = await db.insert(conversations).values(data).returning();
  return conv;
}

export async function getConversation(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(conversations.id, id), isNull(conversations.deletedAt)];
  if (workspaceId) conditions.push(eq(conversations.workspaceId, workspaceId));
  const rows = await db.select().from(conversations).where(and(...conditions)).limit(1);
  return rows[0] ?? null;
}

export async function updateConversationMetadata(
  db: Db,
  id: string,
  metadata: Record<string, unknown>,
) {
  const [updated] = await db
    .update(conversations)
    .set({ metadata })
    .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function updateConversationTitle(db: Db, id: string, title: string) {
  const [updated] = await db
    .update(conversations)
    .set({ title })
    .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function deleteConversation(db: Db, id: string) {
  const [row] = await db.update(conversations).set({ deletedAt: new Date() }).where(and(eq(conversations.id, id), isNull(conversations.deletedAt))).returning();
  return row ?? null;
}

export async function restoreConversation(db: Db, id: string) {
  const [row] = await db.update(conversations).set({ deletedAt: null }).where(eq(conversations.id, id)).returning();
  return row ?? null;
}

export async function purgeDeletedConversations(db: Db, olderThan: Date) {
  const rows = await db.delete(conversations).where(and(isNotNull(conversations.deletedAt), lte(conversations.deletedAt, olderThan))).returning();
  return rows.length;
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
    workspaceId?: string;
    title: string;
    description?: string;
    priority?: "low" | "medium" | "high" | "critical";
    createdBy?: string;
    metadata?: Record<string, unknown>;
    milestoneId?: string;
    scope?: string;
    requiresApproval?: boolean;
  },
) {
  const [goal] = await db.insert(goals).values(data).returning();
  return goal;
}

export async function getGoal(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(goals.id, id), isNull(goals.deletedAt)];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));
  const rows = await db.select().from(goals).where(and(...conditions)).limit(1);
  return rows[0] ?? null;
}

export async function listGoalsByConversation(
  db: Db,
  conversationId: string,
  options?: { limit?: number; offset?: number; workspaceId?: string },
) {
  const conditions = [eq(goals.conversationId, conversationId), isNull(goals.deletedAt)];
  if (options?.workspaceId) conditions.push(eq(goals.workspaceId, options.workspaceId));

  let query = db
    .select()
    .from(goals)
    .where(and(...conditions))
    .orderBy(desc(goals.createdAt))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countGoalsByConversation(db: Db, conversationId: string, workspaceId?: string): Promise<number> {
  const conditions = [eq(goals.conversationId, conversationId), isNull(goals.deletedAt)];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(goals)
    .where(and(...conditions));
  return rows[0]?.count ?? 0;
}

export async function updateGoalScope(
  db: Db,
  id: string,
  scope: string,
  requiresApproval: boolean,
) {
  const [updated] = await db
    .update(goals)
    .set({ scope, requiresApproval, updatedAt: new Date() })
    .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function updateGoalStatus(
  db: Db,
  id: string,
  status: "draft" | "proposed" | "active" | "completed" | "cancelled" | "needs_review",
) {
  const [updated] = await db
    .update(goals)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function deleteGoal(db: Db, id: string) {
  const [row] = await db.update(goals).set({ deletedAt: new Date() }).where(and(eq(goals.id, id), isNull(goals.deletedAt))).returning();
  return row ?? null;
}

export async function restoreGoal(db: Db, id: string) {
  const [row] = await db.update(goals).set({ deletedAt: null }).where(eq(goals.id, id)).returning();
  return row ?? null;
}

export async function purgeDeletedGoals(db: Db, olderThan: Date) {
  const rows = await db.delete(goals).where(and(isNotNull(goals.deletedAt), lte(goals.deletedAt, olderThan))).returning();
  return rows.length;
}

export async function cancelGoal(db: Db, id: string) {
  const [goal] = await db
    .update(goals)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
    .returning();
  if (!goal) return null;
  await db
    .update(tasks)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(tasks.goalId, id), inArray(tasks.status, ["pending", "assigned", "running"])));
  return goal;
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
    .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
    .returning();
  return updated ?? null;
}

/* ────────────────────────── Goal Analytics ────────────────────────── */

export async function getGoalAnalytics(db: Db, workspaceId?: string) {
  const baseConditions = [isNull(goals.deletedAt)];
  if (workspaceId) baseConditions.push(eq(goals.workspaceId, workspaceId));
  const notDeleted = and(...baseConditions)!;

  const taskConditions = [isNotNull(tasks.assignedAgent)];
  if (workspaceId) taskConditions.push(eq(tasks.workspaceId, workspaceId));

  const wsClause = workspaceId ? sql` and workspace_id = ${workspaceId}` : sql``;

  const [byStatusRows, byPriorityRows, completionMetrics, trendRows, taskAgentRows] = await Promise.all([
    // Count by status
    db.select({
      status: goals.status,
      count: sql<number>`count(*)::int`,
    }).from(goals).where(notDeleted).groupBy(goals.status),

    // Count by priority
    db.select({
      priority: goals.priority,
      count: sql<number>`count(*)::int`,
    }).from(goals).where(notDeleted).groupBy(goals.priority),

    // Completion metrics
    db.select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(case when ${goals.status} = 'completed' then 1 end)::int`,
      cancelled: sql<number>`count(case when ${goals.status} = 'cancelled' then 1 end)::int`,
      avgHours: sql<number>`round(extract(epoch from avg(case when ${goals.status} = 'completed' then ${goals.updatedAt} - ${goals.createdAt} end)) / 3600, 1)`,
    }).from(goals).where(notDeleted),

    // 14-day trend (created vs completed per day)
    db.execute(sql`
      with days as (
        select generate_series(
          current_date - interval '13 days',
          current_date,
          interval '1 day'
        )::date as d
      )
      select
        d::text as date,
        coalesce((select count(*)::int from goals where deleted_at is null${wsClause} and created_at::date = d), 0) as created,
        coalesce((select count(*)::int from goals where deleted_at is null${wsClause} and status = 'completed' and updated_at::date = d), 0) as completed
      from days
      order by d
    `),

    // Tasks by agent (success/fail breakdown)
    db.select({
      agent: tasks.assignedAgent,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(case when ${tasks.status} = 'completed' then 1 end)::int`,
      failed: sql<number>`count(case when ${tasks.status} = 'failed' then 1 end)::int`,
    }).from(tasks).where(and(...taskConditions)).groupBy(tasks.assignedAgent),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of byStatusRows) byStatus[r.status] = r.count;

  const byPriority: Record<string, number> = {};
  for (const r of byPriorityRows) byPriority[r.priority] = r.count;

  const metrics = completionMetrics[0];
  const totalGoals = metrics?.total ?? 0;
  const completedGoals = metrics?.completed ?? 0;
  const terminal = completedGoals + (metrics?.cancelled ?? 0);
  const completionRate = terminal > 0 ? Math.round((completedGoals / terminal) * 100) : 0;

  // Task-level success rate
  const taskTotals = taskAgentRows.reduce(
    (acc, r) => ({ total: acc.total + r.total, completed: acc.completed + r.completed }),
    { total: 0, completed: 0 },
  );
  const taskSuccessRate = taskTotals.total > 0
    ? Math.round((taskTotals.completed / taskTotals.total) * 100)
    : 0;

  return {
    byStatus,
    byPriority,
    completionRate,
    avgCompletionHours: metrics?.avgHours ?? null,
    totalGoals,
    trend: (trendRows as unknown as Array<{ date: string; created: number; completed: number }>).map((r) => ({
      date: r.date,
      created: Number(r.created),
      completed: Number(r.completed),
    })),
    taskSuccessRate,
    totalTasks: taskTotals.total,
    tasksByAgent: taskAgentRows
      .filter((r) => r.agent)
      .map((r) => ({
        agent: r.agent as string,
        total: r.total,
        completed: r.completed,
        failed: r.failed,
      }))
      .sort((a, b) => b.total - a.total),
  };
}

/* ────────────────────── Agent Performance ───────────────────── */

export async function getAgentPerformanceStats(db: Db) {
  const rows = await db.execute(sql`
    select
      assigned_agent as agent,
      count(*)::int as total_tasks,
      count(case when status = 'completed' then 1 end)::int as completed_tasks,
      count(case when status = 'failed' then 1 end)::int as failed_tasks,
      round(avg(case when status in ('completed', 'failed')
        then extract(epoch from (updated_at - created_at)) * 1000 end))::int as avg_duration_ms,
      case when count(case when status in ('completed', 'failed') then 1 end) > 0
        then round(count(case when status = 'completed' then 1 end)::numeric /
             count(case when status in ('completed', 'failed') then 1 end)::numeric, 3)::float
        else 0 end as overall_success_rate,
      count(case when status = 'completed' and created_at > now() - interval '7 days' then 1 end)::int as recent_completed,
      count(case when status = 'failed' and created_at > now() - interval '7 days' then 1 end)::int as recent_failed
    from tasks
    where assigned_agent is not null
    group by assigned_agent
    order by total_tasks desc
  `);

  return (rows as unknown as Array<{
    agent: string;
    total_tasks: number;
    completed_tasks: number;
    failed_tasks: number;
    avg_duration_ms: number | null;
    overall_success_rate: number;
    recent_completed: number;
    recent_failed: number;
  }>).map((r) => {
    const recentTotal = r.recent_completed + r.recent_failed;
    return {
      agent: r.agent,
      totalTasks: r.total_tasks,
      completedTasks: r.completed_tasks,
      failedTasks: r.failed_tasks,
      avgDurationMs: r.avg_duration_ms,
      overallSuccessRate: r.overall_success_rate,
      recentSuccessRate: recentTotal > 0 ? r.recent_completed / recentTotal : null,
      recentCompletedTasks: r.recent_completed,
      recentFailedTasks: r.recent_failed,
    };
  });
}

/* ────────────────────────── Tasks ────────────────────────── */

export async function createTask(
  db: Db,
  data: {
    goalId: string;
    workspaceId?: string;
    title: string;
    description?: string;
    assignedAgent?: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier";
    orderIndex?: number;
    parallelGroup?: number;
    dependsOn?: string[];
    input?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [task] = await db.insert(tasks).values(data).returning();
  return task;
}

export async function getTask(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(tasks.id, id)];
  if (workspaceId) conditions.push(eq(tasks.workspaceId, workspaceId));
  const rows = await db.select().from(tasks).where(and(...conditions)).limit(1);
  return rows[0] ?? null;
}

export async function listTasksByGoal(
  db: Db,
  goalId: string,
  options?: { limit?: number; offset?: number; workspaceId?: string },
) {
  const conditions = [eq(tasks.goalId, goalId)];
  if (options?.workspaceId) conditions.push(eq(tasks.workspaceId, options.workspaceId));

  let query = db
    .select()
    .from(tasks)
    .where(and(...conditions))
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

export async function listPendingTasks(db: Db, limit = 50, workspaceId?: string) {
  const conditions = [eq(tasks.status, "pending")];
  if (workspaceId) conditions.push(eq(tasks.workspaceId, workspaceId));

  return db
    .select()
    .from(tasks)
    .where(and(...conditions))
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

export async function blockTask(db: Db, id: string, reason: string) {
  const [updated] = await db
    .update(tasks)
    .set({ status: "blocked" as const, error: reason, updatedAt: new Date() })
    .where(eq(tasks.id, id))
    .returning();
  return updated ?? null;
}

export async function updateTaskDependencies(db: Db, taskId: string, dependsOn: string[]) {
  const [updated] = await db
    .update(tasks)
    .set({ dependsOn, updatedAt: new Date() })
    .where(eq(tasks.id, taskId))
    .returning();
  return updated ?? null;
}

/* ────────────────────────── Approvals ────────────────────── */

export async function createApproval(
  db: Db,
  data: {
    taskId?: string;
    requestedBy: "orchestrator" | "researcher" | "coder" | "reviewer" | "planner";
    reason: string;
  },
) {
  const values: { requestedBy: typeof data.requestedBy; reason: string; taskId?: string } = {
    requestedBy: data.requestedBy,
    reason: data.reason,
  };
  if (data.taskId !== undefined) values.taskId = data.taskId;
  const [approval] = await db.insert(approvals).values(values).returning();
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

export async function listPendingApprovalsForTasks(db: Db, taskIds: string[]) {
  if (taskIds.length === 0) return [];
  return db
    .select()
    .from(approvals)
    .where(and(eq(approvals.status, "pending"), inArray(approvals.taskId, taskIds)));
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
    workspaceId?: string;
    category: MemoryCategory;
    key: string;
    content: string;
    source?: string;
    agentRole?: string;
    metadata?: Record<string, unknown>;
    embedding?: number[];
  },
) {
  const importance = computeImportance(data.category, data.content);

  // Upsert: if same userId + agentRole + key exists, update
  const agentRoleCondition = data.agentRole
    ? eq(memories.agentRole, data.agentRole as (typeof memories.agentRole.enumValues)[number])
    : isNull(memories.agentRole);

  const existing = await db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, data.userId), agentRoleCondition, eq(memories.key, data.key)))
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

  const { agentRole: rawRole, ...rest } = data;
  const [created] = await db
    .insert(memories)
    .values({
      ...rest,
      importance,
      ...(rawRole
        ? { agentRole: rawRole as (typeof memories.agentRole.enumValues)[number] }
        : {}),
    })
    .returning();
  return created;
}

export async function recallMemories(
  db: Db,
  userId: string,
  options?: { category?: string; query?: string; limit?: number; agentRole?: string; scope?: "own" | "all" },
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

  // Agent-scoped filtering: "own" shows agent's memories + shared (null role)
  if (options?.agentRole && options?.scope !== "all") {
    conditions.push(
      or(
        eq(memories.agentRole, options.agentRole as (typeof memories.agentRole.enumValues)[number]),
        isNull(memories.agentRole),
      )!,
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
  agentRole?: string,
  workspaceId?: string,
) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const agentFilter = agentRole
    ? sql`AND (agent_role = ${agentRole} OR agent_role IS NULL)`
    : sql``;
  const wsFilter = workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``;
  const rows = await db.execute(
    sql`SELECT id, user_id, category, key, content, source, agent_role, metadata, created_at, updated_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM memories
        WHERE user_id = ${userId} AND embedding IS NOT NULL ${agentFilter} ${wsFilter}
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
    agent_role: string | null;
    metadata: unknown;
    created_at: Date;
    updated_at: Date;
    distance: number;
  }>;
}

export async function listMemoriesByUser(
  db: Db,
  userId: string,
  options?: { limit?: number; offset?: number; workspaceId?: string },
) {
  const conditions = [eq(memories.userId, userId)];
  if (options?.workspaceId) conditions.push(eq(memories.workspaceId, options.workspaceId));

  let query = db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.updatedAt))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countMemoriesByUser(db: Db, userId: string, workspaceId?: string): Promise<number> {
  const conditions = [eq(memories.userId, userId)];
  if (workspaceId) conditions.push(eq(memories.workspaceId, workspaceId));
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(...conditions));
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

export async function listActiveGoals(db: Db, workspaceId?: string): Promise<GoalSummary[]> {
  const conditions = [eq(goals.status, "active"), isNull(goals.deletedAt)];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));

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
    .where(and(...conditions))
    .groupBy(goals.id)
    .orderBy(desc(goals.updatedAt));

  return rows;
}

export async function listRecentlyCompletedGoals(db: Db, since: Date, workspaceId?: string) {
  const conditions = [
    eq(goals.status, "completed"),
    isNull(goals.deletedAt),
    sql`${goals.updatedAt} >= ${since.toISOString()}`,
  ];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));

  return db
    .select({
      id: goals.id,
      title: goals.title,
      updatedAt: goals.updatedAt,
    })
    .from(goals)
    .where(and(...conditions))
    .orderBy(desc(goals.updatedAt));
}

export async function countTasksByStatus(db: Db, workspaceId?: string) {
  const conditions = [eq(goals.status, "active"), isNull(goals.deletedAt)];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));

  const rows = await db
    .select({ status: tasks.status })
    .from(tasks)
    .innerJoin(goals, eq(tasks.goalId, goals.id))
    .where(and(...conditions));

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * Returns active goals that have at least one pending task and zero running tasks,
 * ordered by priority (critical > high > medium > low) then staleness (oldest first).
 * Used by the autonomous executor to deterministically pick the next goal to work on.
 */
export async function listGoalBacklog(db: Db, limit = 5, workspaceId?: string) {
  const conditions = [eq(goals.status, "active"), isNull(goals.deletedAt)];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));

  return db
    .select({
      id: goals.id,
      title: goals.title,
      description: goals.description,
      status: goals.status,
      priority: goals.priority,
      createdAt: goals.createdAt,
      updatedAt: goals.updatedAt,
      taskCount: sql<number>`count(${tasks.id})::int`.as("task_count"),
      pendingTaskCount: sql<number>`count(case when ${tasks.status} = 'pending' then 1 end)::int`.as("pending_task_count"),
    })
    .from(goals)
    .leftJoin(tasks, eq(tasks.goalId, goals.id))
    .where(and(...conditions))
    .groupBy(goals.id)
    .having(
      and(
        gt(sql<number>`count(case when ${tasks.status} = 'pending' then 1 end)::int`, 0),
        eq(sql<number>`count(case when ${tasks.status} = 'running' then 1 end)::int`, 0),
      ),
    )
    .orderBy(
      sql`case ${goals.priority}
        when 'critical' then 1
        when 'high' then 2
        when 'medium' then 3
        else 4
      end`,
      asc(goals.updatedAt),
    )
    .limit(limit);
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
  "claude-opus-4-20250514": { input: 15_000, output: 75_000 }, // $15/$75 per MTok
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
    workspaceId?: string;
    userId?: string;
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

/**
 * Returns aggregated LLM cost and token usage for a specific goal.
 * Avoids the pre-existing TS errors in getUsageSummary() by using a simple aggregate query.
 * Note: estimatedCostUsd is stored in microdollars; divide by 1_000_000 to get USD.
 */
export async function getCostByGoal(
  db: Db,
  goalId: string,
): Promise<{
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
}> {
  const rows = await db
    .select({
      totalCostUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as("total_cost_usd"),
      totalInputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as("total_input_tokens"),
      totalOutputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as("total_output_tokens"),
      requestCount: sql<number>`count(*)::int`.as("request_count"),
    })
    .from(llmUsage)
    .where(eq(llmUsage.goalId, goalId));

  const row = rows[0];
  return {
    // Convert microdollars to dollars
    totalCostUsd: Number(row?.totalCostUsd ?? 0) / 1_000_000,
    totalInputTokens: row?.totalInputTokens ?? 0,
    totalOutputTokens: row?.totalOutputTokens ?? 0,
    requestCount: row?.requestCount ?? 0,
  };
}

/**
 * Returns the top most expensive goals by total LLM cost.
 * JOINs llmUsage with goals to include titles.
 */
export async function getTopExpensiveGoals(
  db: Db,
  options?: { limit?: number; since?: Date },
): Promise<
  Array<{
    goalId: string;
    goalTitle: string;
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    requestCount: number;
  }>
> {
  const limit = options?.limit ?? 10;
  const conditions = [sql`${llmUsage.goalId} IS NOT NULL`];
  if (options?.since) {
    conditions.push(sql`${llmUsage.createdAt} >= ${options.since.toISOString()}`);
  }

  const rows = await db
    .select({
      goalId: llmUsage.goalId,
      goalTitle: goals.title,
      totalCostUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as("total_cost_usd"),
      totalInputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as("total_input_tokens"),
      totalOutputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as("total_output_tokens"),
      requestCount: sql<number>`count(*)::int`.as("request_count"),
    })
    .from(llmUsage)
    .innerJoin(goals, eq(llmUsage.goalId, goals.id))
    .where(and(...conditions))
    .groupBy(llmUsage.goalId, goals.title)
    .orderBy(sql`total_cost_usd desc`)
    .limit(limit);

  return rows.map((row) => ({
    goalId: row.goalId!,
    goalTitle: row.goalTitle,
    totalCostUsd: Number(row.totalCostUsd) / 1_000_000,
    totalInputTokens: row.totalInputTokens ?? 0,
    totalOutputTokens: row.totalOutputTokens ?? 0,
    requestCount: row.requestCount ?? 0,
  }));
}

/**
 * Returns daily cost aggregates for LLM usage within the given date range.
 * Divides microdollar values by 1_000_000 to return USD.
 * Results are ordered ascending by date for chart rendering.
 */
export async function getCostByDay(
  db: Db,
  since: Date,
  until?: Date,
  workspaceId?: string,
): Promise<Array<{ date: string; costUsd: number; inputTokens: number; outputTokens: number; requests: number }>> {
  const conditions = [sql`${llmUsage.createdAt} >= ${since.toISOString()}`];
  if (until) {
    conditions.push(sql`${llmUsage.createdAt} <= ${until.toISOString()}`);
  }
  if (workspaceId) {
    conditions.push(eq(llmUsage.workspaceId, workspaceId));
  }

  const rows = await db
    .select({
      date: sql<string>`date_trunc('day', ${llmUsage.createdAt})::date::text`.as("date"),
      costUsd: sql<number>`coalesce(sum(${llmUsage.estimatedCostUsd}), 0)::bigint`.as("cost_usd"),
      inputTokens: sql<number>`coalesce(sum(${llmUsage.inputTokens}), 0)::int`.as("input_tokens"),
      outputTokens: sql<number>`coalesce(sum(${llmUsage.outputTokens}), 0)::int`.as("output_tokens"),
      requests: sql<number>`count(*)::int`.as("requests"),
    })
    .from(llmUsage)
    .where(and(...conditions))
    .groupBy(sql`date_trunc('day', ${llmUsage.createdAt})::date`)
    .orderBy(sql`date_trunc('day', ${llmUsage.createdAt})::date asc`);

  return rows.map((row) => ({
    date: row.date,
    // Convert microdollars to dollars
    costUsd: Number(row.costUsd) / 1_000_000,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    requests: row.requests ?? 0,
  }));
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
  options?: { since?: Date; until?: Date; workspaceId?: string },
): Promise<UsageSummary> {
  const conditions = [];
  if (options?.since) {
    conditions.push(sql`${llmUsage.createdAt} >= ${options.since.toISOString()}`);
  }
  if (options?.until) {
    conditions.push(sql`${llmUsage.createdAt} < ${options.until.toISOString()}`);
  }
  if (options?.workspaceId) {
    conditions.push(eq(llmUsage.workspaceId, options.workspaceId));
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
    workspaceId?: string;
    cronExpression: string;
    actionPrompt: string;
    description?: string;
    enabled?: boolean;
    nextRunAt?: Date;
    metadata?: Record<string, unknown>;
  },
) {
  const [schedule] = await db
    .insert(schedules)
    .values(data)
    .returning();
  return schedule;
}

export async function listSchedules(db: Db, userId?: string, workspaceId?: string) {
  const conditions = [];
  if (userId) conditions.push(eq(schedules.userId, userId));
  if (workspaceId) conditions.push(eq(schedules.workspaceId, workspaceId));

  return db.select().from(schedules)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schedules.createdAt));
}

export async function listEnabledSchedules(db: Db, workspaceId?: string) {
  const conditions = [eq(schedules.enabled, true)];
  if (workspaceId) conditions.push(eq(schedules.workspaceId, workspaceId));

  return db.select().from(schedules).where(and(...conditions)).orderBy(asc(schedules.nextRunAt));
}

export async function getSchedule(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(schedules.id, id)];
  if (workspaceId) conditions.push(eq(schedules.workspaceId, workspaceId));
  const rows = await db.select().from(schedules).where(and(...conditions)).limit(1);
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

export async function resetEventProcessed(db: Db, id: string) {
  const [updated] = await db
    .update(events)
    .set({ processed: false, result: null })
    .where(eq(events.id, id))
    .returning();
  return updated;
}

export interface EventFilterOptions {
  limit?: number;
  offset?: number;
  source?: string;
  type?: string;
  processed?: boolean;
}

export async function listEvents(
  db: Db,
  options?: EventFilterOptions,
) {
  const conditions = buildEventConditions(options);

  let query = db
    .select()
    .from(events)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(events.createdAt))
    .$dynamic();

  if (options?.limit != null) query = query.limit(options.limit);
  if (options?.offset != null) query = query.offset(options.offset);

  return query;
}

export async function countEvents(db: Db, options?: EventFilterOptions): Promise<number> {
  const conditions = buildEventConditions(options);

  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return rows[0]?.count ?? 0;
}

export async function getEventById(db: Db, id: string) {
  const [event] = await db.select().from(events).where(eq(events.id, id));
  return event ?? null;
}

function buildEventConditions(options?: EventFilterOptions) {
  const conditions = [];
  if (options?.source) conditions.push(eq(events.source, options.source));
  if (options?.type) conditions.push(eq(events.type, options.type));
  if (options?.processed != null) conditions.push(eq(events.processed, options.processed));
  return conditions;
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
    goalId?: string;
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
    .where(and(eq(goals.milestoneId, milestoneId), isNull(goals.deletedAt)))
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
    .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function deleteMilestone(db: Db, id: string) {
  // Unlink non-deleted goals first
  await db.update(goals).set({ milestoneId: null }).where(and(eq(goals.milestoneId, id), isNull(goals.deletedAt)));
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

export async function getRecentConversationSummaries(db: Db, since: Date) {
  return db
    .select({
      id: conversationSummaries.id,
      conversationId: conversationSummaries.conversationId,
      summary: conversationSummaries.summary,
      createdAt: conversationSummaries.createdAt,
    })
    .from(conversationSummaries)
    .where(
      sql`${conversationSummaries.createdAt} >= ${since.toISOString()}`,
    )
    .orderBy(desc(conversationSummaries.createdAt));
}

/**
 * getRecentSessionSummaries
 *
 * Returns the most recent conversation summaries for a specific user.
 * Unlike getRecentConversationSummaries (which filters by date), this function
 * filters by userId via the conversations join — satisfying MEM-01 session context needs.
 */
export async function getRecentSessionSummaries(
  db: Db,
  userId: string,
  limit = 3,
): Promise<Array<{ conversationId: string; summary: string; createdAt: Date }>> {
  // Step 1: Get the user's most recent conversations
  const recentConvs = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.userId, userId), isNull(conversations.deletedAt)))
    .orderBy(desc(conversations.updatedAt))
    .limit(10);

  if (recentConvs.length === 0) return [];

  const convIds = recentConvs.map((c) => c.id);

  // Step 2: Get the latest summary for each of those conversations
  const summaries = await db
    .select({
      conversationId: conversationSummaries.conversationId,
      summary: conversationSummaries.summary,
      createdAt: conversationSummaries.createdAt,
    })
    .from(conversationSummaries)
    .where(inArray(conversationSummaries.conversationId, convIds))
    .orderBy(desc(conversationSummaries.createdAt))
    .limit(limit);

  return summaries;
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
        requestCount: data.requestCount,
        successCount: data.successCount,
        errorCount: data.errorCount,
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

/* ────────────────── Error Summary ──────────────── */

export async function getErrorSummary(
  db: Db,
  options?: { since?: Date; limit?: number },
) {
  const limit = options?.limit ?? 20;
  const conditions = [eq(toolExecutions.success, false)];
  if (options?.since) {
    conditions.push(gt(toolExecutions.createdAt, options.since));
  }
  const rows = await db
    .select({
      toolName: toolExecutions.toolName,
      errorMessage: toolExecutions.errorMessage,
      count: sql<number>`count(*)::int`,
      lastSeen: sql<string>`max(${toolExecutions.createdAt})::text`,
    })
    .from(toolExecutions)
    .where(and(...conditions))
    .groupBy(toolExecutions.toolName, toolExecutions.errorMessage)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
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
  options?: { limit?: number; offset?: number; workspaceId?: string },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const conditions = [eq(conversations.userId, userId), isNull(conversations.deletedAt)];
  if (options?.workspaceId) conditions.push(eq(conversations.workspaceId, options.workspaceId));
  const where = and(...conditions);

  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(conversations)
      .where(where)
      .orderBy(desc(conversations.updatedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(where),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

/* ────────────────── User Activity ──────────────── */

export async function getLatestUserMessageTime(db: Db): Promise<Date | null> {
  const rows = await db
    .select({ latest: sql<string>`max(${messages.createdAt})` })
    .from(messages)
    .where(eq(messages.role, "user"));
  const val = rows[0]?.latest;
  return val ? new Date(val) : null;
}

export async function getLastUserMessageTimestamp(db: Db, userId: string): Promise<Date | null> {
  const rows = await db
    .select({ latest: sql<string>`max(${messages.createdAt})` })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, userId),
        eq(messages.role, "user"),
        isNull(conversations.deletedAt),
      ),
    );
  const val = rows[0]?.latest;
  return val ? new Date(val) : null;
}

export async function getRecentDecisionMemories(db: Db, userId: string, since: Date) {
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.category, "decisions"),
        sql`${memories.createdAt} >= ${since.toISOString()}`,
      ),
    )
    .orderBy(desc(memories.createdAt))
    .limit(10);
}

/* ────────────────── Personas ──────────────── */

export async function getActivePersona(db: Db) {
  const rows = await db.select().from(personas).where(eq(personas.isActive, true)).limit(1);
  return rows[0] ?? null;
}

export async function listPersonas(db: Db) {
  return db.select().from(personas).orderBy(desc(personas.updatedAt));
}

export async function getPersona(db: Db, id: string) {
  const rows = await db.select().from(personas).where(eq(personas.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function upsertPersona(
  db: Db,
  data: {
    id?: string;
    name: string;
    voiceId?: string;
    corePersonality: string;
    capabilities?: string;
    behavioralGuidelines?: string;
    isActive?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  // If setting as active, deactivate all others first
  if (data.isActive) {
    await db.update(personas).set({ isActive: false }).where(eq(personas.isActive, true));
  }

  if (data.id) {
    const rows = await db
      .update(personas)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(personas.id, data.id))
      .returning();
    return rows[0];
  }

  const rows = await db.insert(personas).values(data).returning();
  return rows[0];
}

export async function deletePersona(db: Db, id: string) {
  await db.delete(personas).where(eq(personas.id, id));
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

/* ────────────────── RAG: Document Chunks ──────────────── */

type SourceType = "git" | "conversation" | "slack" | "memory" | "reflection" | "markdown";

export interface ChunkInsert {
  sourceType: SourceType;
  sourceId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  chunkIndex: number;
  tokenCount: number;
  contextPrefix?: string;
}

export async function insertChunks(db: Db, chunks: ChunkInsert[]) {
  if (chunks.length === 0) return [];
  const rows = await db.insert(documentChunks).values(chunks).returning();
  return rows;
}

export async function searchChunksByVector(
  db: Db,
  embedding: number[],
  options?: {
    limit?: number;
    sourceType?: SourceType;
    sourceId?: string;
  },
) {
  const limit = options?.limit ?? 20;
  const vectorLiteral = `[${embedding.join(",")}]`;

  // Build parameterized WHERE clause — never interpolate user input into sql.raw()
  const validSourceTypes: SourceType[] = ["git", "conversation", "slack", "memory", "reflection", "markdown"];
  let whereClause = sql`embedding IS NOT NULL`;
  if (options?.sourceType && validSourceTypes.includes(options.sourceType)) {
    whereClause = sql`${whereClause} AND source_type = ${options.sourceType}`;
  }
  if (options?.sourceId) {
    whereClause = sql`${whereClause} AND source_id = ${options.sourceId}`;
  }

  const rows = await db.execute(
    sql`SELECT id, source_type, source_id, content, metadata, chunk_index, token_count, created_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM document_chunks
        WHERE ${whereClause}
        ORDER BY distance ASC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    metadata: Record<string, unknown> | null;
    chunk_index: number;
    token_count: number;
    created_at: Date;
    distance: number;
  }>;
}

export async function deleteChunksBySource(db: Db, sourceType: SourceType, sourceId: string) {
  await db
    .delete(documentChunks)
    .where(
      and(
        eq(documentChunks.sourceType, sourceType),
        eq(documentChunks.sourceId, sourceId),
      ),
    );
}

export async function getChunkCount(db: Db, sourceType?: SourceType): Promise<number> {
  const conditions = sourceType ? [eq(documentChunks.sourceType, sourceType)] : [];
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentChunks)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  return rows[0]?.count ?? 0;
}

/* ────────────────── RAG: Ingestion State ──────────────── */

export async function upsertIngestionState(
  db: Db,
  data: {
    sourceType: SourceType;
    sourceId: string;
    lastCursor?: string;
    chunkCount: number;
  },
) {
  const [result] = await db
    .insert(ingestionState)
    .values({
      sourceType: data.sourceType,
      sourceId: data.sourceId,
      lastIngestedAt: new Date(),
      lastCursor: data.lastCursor,
      chunkCount: data.chunkCount,
    })
    .onConflictDoUpdate({
      target: [ingestionState.sourceType, ingestionState.sourceId],
      set: {
        lastIngestedAt: new Date(),
        lastCursor: data.lastCursor,
        chunkCount: data.chunkCount,
      },
    })
    .returning();
  return result;
}

export async function getIngestionState(db: Db, sourceType: SourceType, sourceId: string) {
  const rows = await db
    .select()
    .from(ingestionState)
    .where(
      and(
        eq(ingestionState.sourceType, sourceType),
        eq(ingestionState.sourceId, sourceId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listIngestionStates(db: Db, sourceType?: SourceType) {
  if (sourceType) {
    return db
      .select()
      .from(ingestionState)
      .where(eq(ingestionState.sourceType, sourceType))
      .orderBy(desc(ingestionState.lastIngestedAt));
  }
  return db.select().from(ingestionState).orderBy(desc(ingestionState.lastIngestedAt));
}

/* ────────────────── Reflections ──────────────── */

type ReflectionType = "goal_completion" | "failure_analysis" | "pattern_extraction" | "weekly_summary";

export async function insertReflection(
  db: Db,
  data: {
    goalId?: string;
    reflectionType: ReflectionType;
    content: string;
    embedding?: number[];
    lessons?: unknown;
    agentPerformance?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db.insert(reflections).values(data).returning();
  return row;
}

export async function getReflection(db: Db, id: string) {
  const rows = await db.select().from(reflections).where(eq(reflections.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listReflectionsByGoal(db: Db, goalId: string) {
  return db
    .select()
    .from(reflections)
    .where(eq(reflections.goalId, goalId))
    .orderBy(desc(reflections.createdAt));
}

export async function listReflections(
  db: Db,
  options?: { type?: ReflectionType; limit?: number; offset?: number },
) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const conditions = options?.type ? [eq(reflections.reflectionType, options.type)] : [];

  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(reflections)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(reflections.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(reflections)
      .where(conditions.length > 0 ? and(...conditions) : undefined),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

export async function getReflectionStats(db: Db) {
  const rows = await db
    .select({
      reflectionType: reflections.reflectionType,
      count: sql<number>`count(*)::int`,
      avgLessons: sql<number>`round(avg(jsonb_array_length(coalesce(${reflections.lessons}, '[]'::jsonb))))::int`,
    })
    .from(reflections)
    .groupBy(reflections.reflectionType)
    .orderBy(asc(reflections.reflectionType));
  return rows;
}

/* ────────────────── Admin Users ──────────────── */

export async function findAdminByEmail(db: Db, email: string) {
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email))
    .limit(1);
  return rows[0] ?? undefined;
}

export async function findAdminById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, id))
    .limit(1);
  return rows[0] ?? undefined;
}

export async function createAdminUser(
  db: Db,
  data: { email: string; passwordHash: string | null; role?: "admin" | "editor" | "viewer" },
) {
  const [created] = await db.insert(adminUsers).values(data).returning();
  return created;
}

export async function countAdminUsers(db: Db): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(adminUsers);
  return rows[0]?.count ?? 0;
}

export async function listAdminUsers(db: Db) {
  return db
    .select({ id: adminUsers.id, email: adminUsers.email, role: adminUsers.role, createdAt: adminUsers.createdAt })
    .from(adminUsers)
    .orderBy(adminUsers.createdAt);
}

export async function updateAdminRole(db: Db, id: string, role: "admin" | "editor" | "viewer") {
  const [updated] = await db
    .update(adminUsers)
    .set({ role })
    .where(eq(adminUsers.id, id))
    .returning();
  return updated ?? null;
}

/* ────────────────────── Google OAuth Tokens ─────────────────────── */

export async function upsertGoogleToken(
  db: Db,
  data: {
    adminUserId: string;
    accessTokenEncrypted: string;
    refreshTokenEncrypted: string;
    expiresAt: Date;
    scopes: string;
  },
) {
  const [row] = await db
    .insert(googleTokens)
    .values(data)
    .onConflictDoUpdate({
      target: googleTokens.adminUserId,
      set: {
        accessTokenEncrypted: data.accessTokenEncrypted,
        refreshTokenEncrypted: data.refreshTokenEncrypted,
        expiresAt: data.expiresAt,
        scopes: data.scopes,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function getGoogleToken(db: Db, adminUserId: string) {
  const rows = await db
    .select()
    .from(googleTokens)
    .where(eq(googleTokens.adminUserId, adminUserId));
  return rows[0] ?? undefined;
}

export async function deleteGoogleToken(db: Db, adminUserId: string) {
  await db.delete(googleTokens).where(eq(googleTokens.adminUserId, adminUserId));
}

/* ────────────────────── Subagent Runs ─────────────────────── */

export async function createSubagentRun(
  db: Db,
  data: {
    parentRequestId?: string;
    conversationId?: string;
    goalId?: string;
    title: string;
    instruction: string;
    userId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [created] = await db
    .insert(subagentRuns)
    .values({
      parentRequestId: data.parentRequestId,
      conversationId: data.conversationId,
      goalId: data.goalId,
      title: data.title,
      instruction: data.instruction,
      userId: data.userId,
      metadata: data.metadata,
    })
    .returning();
  return created;
}

export async function updateSubagentRunStatus(
  db: Db,
  id: string,
  update: {
    status: "queued" | "running" | "completed" | "failed" | "cancelled";
    output?: string;
    error?: string;
    toolRounds?: number;
    toolsUsed?: string[];
    tokens?: number;
    model?: string;
    provider?: string;
    durationMs?: number;
  },
) {
  const values: Record<string, unknown> = {
    status: update.status,
    updatedAt: new Date(),
  };
  if (update.output !== undefined) values.output = update.output;
  if (update.error !== undefined) values.error = update.error;
  if (update.toolRounds !== undefined) values.toolRounds = update.toolRounds;
  if (update.toolsUsed !== undefined) values.toolsUsed = update.toolsUsed;
  if (update.tokens !== undefined) values.tokens = update.tokens;
  if (update.model !== undefined) values.model = update.model;
  if (update.provider !== undefined) values.provider = update.provider;
  if (update.durationMs !== undefined) values.durationMs = update.durationMs;

  const [updated] = await db
    .update(subagentRuns)
    .set(values)
    .where(eq(subagentRuns.id, id))
    .returning();
  return updated;
}

export async function getSubagentRun(db: Db, id: string) {
  const rows = await db
    .select()
    .from(subagentRuns)
    .where(eq(subagentRuns.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listSubagentRuns(
  db: Db,
  opts?: {
    goalId?: string;
    status?: string;
    parentRequestId?: string;
    limit?: number;
    offset?: number;
  },
) {
  const conditions = [];
  if (opts?.goalId) conditions.push(eq(subagentRuns.goalId, opts.goalId));
  if (opts?.status) conditions.push(eq(subagentRuns.status, opts.status as "queued" | "running" | "completed" | "failed" | "cancelled"));
  if (opts?.parentRequestId) conditions.push(eq(subagentRuns.parentRequestId, opts.parentRequestId));

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const data = await db
    .select()
    .from(subagentRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(subagentRuns.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(subagentRuns)
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  const total = countResult[0]?.count ?? 0;

  return { data, total };
}

export async function getSubagentRunsByParentRequest(db: Db, parentRequestId: string) {
  return db
    .select()
    .from(subagentRuns)
    .where(eq(subagentRuns.parentRequestId, parentRequestId))
    .orderBy(desc(subagentRuns.createdAt));
}

/* ────────────────── Agent Messages ─────────────────── */

export async function sendAgentMessage(
  db: Db,
  data: {
    senderRole: string;
    senderRunId?: string;
    targetRole?: string;
    targetRunId?: string;
    channel?: string;
    messageType: string;
    subject: string;
    body: string;
    correlationId?: string;
    inReplyTo?: string;
    goalId?: string;
    taskId?: string;
    conversationId?: string;
    priority?: string;
    expiresAt?: Date;
    metadata?: Record<string, unknown>;
  },
) {
  const [created] = await db
    .insert(agentMessages)
    .values({
      senderRole: data.senderRole as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier" | "subagent",
      senderRunId: data.senderRunId,
      targetRole: data.targetRole as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier" | "subagent" | undefined,
      targetRunId: data.targetRunId,
      channel: data.channel,
      messageType: data.messageType as "request" | "response" | "broadcast" | "notification" | "handoff",
      subject: data.subject,
      body: data.body,
      correlationId: data.correlationId,
      inReplyTo: data.inReplyTo,
      goalId: data.goalId,
      taskId: data.taskId,
      conversationId: data.conversationId,
      priority: (data.priority as "low" | "medium" | "high" | "critical") ?? "medium",
      expiresAt: data.expiresAt,
      metadata: data.metadata,
    })
    .returning();
  return created;
}

export async function getAgentInbox(
  db: Db,
  opts: {
    targetRole?: string;
    targetRunId?: string;
    status?: string;
    messageType?: string;
    senderRole?: string;
    goalId?: string;
    limit?: number;
  },
) {
  const conditions = [];
  if (opts.targetRole) conditions.push(eq(agentMessages.targetRole, opts.targetRole as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier" | "subagent"));
  if (opts.targetRunId) conditions.push(eq(agentMessages.targetRunId, opts.targetRunId));
  if (opts.status) conditions.push(eq(agentMessages.status, opts.status as "pending" | "delivered" | "read" | "expired"));
  if (opts.messageType) conditions.push(eq(agentMessages.messageType, opts.messageType as "request" | "response" | "broadcast" | "notification" | "handoff"));
  if (opts.senderRole) conditions.push(eq(agentMessages.senderRole, opts.senderRole as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier" | "subagent"));
  if (opts.goalId) conditions.push(eq(agentMessages.goalId, opts.goalId));

  // Exclude broadcast messages from inbox (those go to channels)
  conditions.push(isNull(agentMessages.channel));

  const limit = opts.limit ?? 5;

  return db
    .select()
    .from(agentMessages)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit);
}

export async function getChannelMessages(
  db: Db,
  opts: {
    channel: string;
    goalId?: string;
    since?: Date;
    limit?: number;
  },
) {
  const conditions = [eq(agentMessages.channel, opts.channel)];
  if (opts.goalId) conditions.push(eq(agentMessages.goalId, opts.goalId));
  if (opts.since) conditions.push(sql`${agentMessages.createdAt} > ${opts.since}`);

  const limit = opts.limit ?? 20;

  return db
    .select()
    .from(agentMessages)
    .where(and(...conditions))
    .orderBy(asc(agentMessages.createdAt))
    .limit(limit);
}

export async function markMessagesRead(db: Db, messageIds: string[]) {
  if (messageIds.length === 0) return;
  const now = new Date();
  await db
    .update(agentMessages)
    .set({ status: "read", readAt: now })
    .where(sql`${agentMessages.id} = ANY(${messageIds})`);
}

export async function getResponseToRequest(db: Db, correlationId: string) {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.correlationId, correlationId),
        eq(agentMessages.messageType, "response"),
      ),
    )
    .orderBy(desc(agentMessages.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getMessageThread(db: Db, correlationId: string) {
  return db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.correlationId, correlationId))
    .orderBy(asc(agentMessages.createdAt));
}

export async function listGoalMessages(
  db: Db,
  goalId: string,
  opts?: { limit?: number; offset?: number },
) {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.goalId, goalId))
      .orderBy(asc(agentMessages.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentMessages)
      .where(eq(agentMessages.goalId, goalId)),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

export async function expireStaleMessages(db: Db) {
  const now = new Date();
  const result = await db
    .update(agentMessages)
    .set({ status: "expired" })
    .where(
      and(
        eq(agentMessages.status, "pending"),
        lte(agentMessages.expiresAt, now),
      ),
    )
    .returning({ id: agentMessages.id });
  return result.length;
}

export async function listAgentMessages(
  db: Db,
  opts?: {
    goalId?: string;
    role?: string;
    messageType?: string;
    status?: string;
    limit?: number;
    offset?: number;
  },
) {
  const conditions = [];
  if (opts?.goalId) conditions.push(eq(agentMessages.goalId, opts.goalId));
  if (opts?.role) conditions.push(
    or(
      eq(agentMessages.senderRole, opts.role as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier" | "subagent"),
      eq(agentMessages.targetRole, opts.role as "orchestrator" | "researcher" | "coder" | "reviewer" | "planner" | "debugger" | "doc_writer" | "verifier" | "subagent"),
    ),
  );
  if (opts?.messageType) conditions.push(eq(agentMessages.messageType, opts.messageType as "request" | "response" | "broadcast" | "notification" | "handoff"));
  if (opts?.status) conditions.push(eq(agentMessages.status, opts.status as "pending" | "delivered" | "read" | "expired"));

  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const [data, countRows] = await Promise.all([
    db
      .select()
      .from(agentMessages)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentMessages)
      .where(conditions.length > 0 ? and(...conditions) : undefined),
  ]);

  return { data, total: countRows[0]?.count ?? 0 };
}

export async function getAgentMessage(db: Db, id: string) {
  const rows = await db
    .select()
    .from(agentMessages)
    .where(eq(agentMessages.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getAgentMessageStats(db: Db) {
  const rows = await db
    .select({
      senderRole: agentMessages.senderRole,
      messageType: agentMessages.messageType,
      count: sql<number>`count(*)::int`,
      avgResponseMs: sql<number>`avg(EXTRACT(EPOCH FROM (${agentMessages.readAt} - ${agentMessages.createdAt})) * 1000)::int`,
    })
    .from(agentMessages)
    .groupBy(agentMessages.senderRole, agentMessages.messageType);
  return rows;
}

/* ────────────────── User Actions (Pattern Learning) ─────────────── */

type UserActionType = "chat_message" | "goal_created" | "deploy_triggered" | "suggestion_accepted" | "approval_submitted" | "schedule_created" | "tool_executed";

export async function recordUserAction(
  db: Db,
  data: {
    userId?: string;
    workspaceId?: string;
    actionType: UserActionType;
    actionDetail?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const now = new Date();
  const [row] = await db
    .insert(userActions)
    .values({
      userId: data.userId,
      workspaceId: data.workspaceId,
      actionType: data.actionType,
      actionDetail: data.actionDetail,
      dayOfWeek: now.getDay(),
      hourOfDay: now.getHours(),
      metadata: data.metadata,
    })
    .returning();
  return row;
}

export async function getUserActionsSince(db: Db, userId: string, since: Date) {
  return db
    .select()
    .from(userActions)
    .where(
      and(
        eq(userActions.userId, userId),
        sql`${userActions.createdAt} >= ${since.toISOString()}`,
      ),
    )
    .orderBy(desc(userActions.createdAt));
}

export async function getRecentUserActionSummary(db: Db, userId: string, since: Date, workspaceId?: string) {
  const conditions = [
    eq(userActions.userId, userId),
    sql`${userActions.createdAt} >= ${since.toISOString()}`,
  ];
  if (workspaceId) conditions.push(eq(userActions.workspaceId, workspaceId));

  return db
    .select({
      actionType: userActions.actionType,
      count: sql<number>`count(*)::int`,
    })
    .from(userActions)
    .where(and(...conditions))
    .groupBy(userActions.actionType)
    .orderBy(sql`count(*) desc`);
}

export async function deleteOldUserActions(db: Db, olderThan: Date) {
  const result = await db
    .delete(userActions)
    .where(lte(userActions.createdAt, olderThan))
    .returning({ id: userActions.id });
  return result.length;
}

export async function getDistinctActionUserIds(db: Db, since: Date) {
  const rows = await db
    .selectDistinct({ userId: userActions.userId })
    .from(userActions)
    .where(
      and(
        sql`${userActions.createdAt} >= ${since}`,
        sql`${userActions.userId} IS NOT NULL`,
      ),
    );
  return rows.map((r) => r.userId!);
}

export async function getUserActionsForAnalysis(
  db: Db,
  userId: string,
  since: Date,
) {
  return db
    .select()
    .from(userActions)
    .where(
      and(
        eq(userActions.userId, userId),
        sql`${userActions.createdAt} >= ${since}`,
      ),
    )
    .orderBy(asc(userActions.createdAt));
}

/* ────────────────── User Patterns ─────────────── */

export async function deactivateLowConfidencePatterns(
  db: Db,
  threshold = 15,
  minHits = 5,
) {
  const result = await db
    .update(userPatterns)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(userPatterns.isActive, true),
        lte(userPatterns.confidence, threshold),
        sql`${userPatterns.hitCount} >= ${minHits}`,
      ),
    )
    .returning({ id: userPatterns.id });
  return result.length;
}

export async function upsertUserPattern(
  db: Db,
  data: {
    userId?: string;
    workspaceId?: string;
    patternType: string;
    description: string;
    triggerCondition: Record<string, unknown>;
    suggestedAction: string;
    confidence?: number;
  },
) {
  // Check for existing pattern with same user + type + description
  const existing = await db
    .select()
    .from(userPatterns)
    .where(
      and(
        data.userId ? eq(userPatterns.userId, data.userId) : isNull(userPatterns.userId),
        eq(userPatterns.patternType, data.patternType),
        eq(userPatterns.description, data.description),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(userPatterns)
      .set({
        triggerCondition: data.triggerCondition,
        suggestedAction: data.suggestedAction,
        confidence: data.confidence ?? existing[0].confidence,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(userPatterns.id, existing[0].id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(userPatterns)
    .values({
      userId: data.userId,
      workspaceId: data.workspaceId,
      patternType: data.patternType,
      description: data.description,
      triggerCondition: data.triggerCondition,
      suggestedAction: data.suggestedAction,
      confidence: data.confidence ?? 50,
    })
    .returning();
  return created;
}

export async function getActiveUserPatterns(db: Db, userId: string, workspaceId?: string) {
  const conditions = [
    or(eq(userPatterns.userId, userId), isNull(userPatterns.userId)),
    eq(userPatterns.isActive, true),
    or(
      isNull(userPatterns.expiresAt),
      sql`${userPatterns.expiresAt} > now()`,
    ),
  ];
  if (workspaceId) conditions.push(eq(userPatterns.workspaceId, workspaceId));

  return db
    .select()
    .from(userPatterns)
    .where(and(...conditions))
    .orderBy(desc(userPatterns.confidence));
}

export async function getTriggeredPatterns(
  db: Db,
  userId: string,
  context: { dayOfWeek: number; hourOfDay: number },
) {
  // Fetch all active patterns for this user, then filter in-app
  // (JSONB field filtering is simpler in JS than in SQL for nested conditions)
  const patterns = await getActiveUserPatterns(db, userId);

  return patterns.filter((p) => {
    const trigger = p.triggerCondition as Record<string, unknown> | null;
    if (!trigger) return false;

    // Check dayOfWeek match
    if (trigger.dayOfWeek !== undefined && trigger.dayOfWeek !== context.dayOfWeek) {
      return false;
    }

    // Check hourRange match
    if (Array.isArray(trigger.hourRange) && trigger.hourRange.length === 2) {
      const [start, end] = trigger.hourRange as [number, number];
      if (context.hourOfDay < start || context.hourOfDay > end) {
        return false;
      }
    }

    return true;
  });
}

export async function incrementPatternAcceptCount(db: Db, patternId: string) {
  const [updated] = await db
    .update(userPatterns)
    .set({
      acceptCount: sql`${userPatterns.acceptCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(userPatterns.id, patternId))
    .returning();
  return updated;
}

export async function incrementPatternHitCount(db: Db, patternId: string) {
  const [updated] = await db
    .update(userPatterns)
    .set({
      hitCount: sql`${userPatterns.hitCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(userPatterns.id, patternId))
    .returning();
  return updated;
}

export async function listPatterns(
  db: Db,
  opts?: { userId?: string; includeInactive?: boolean; limit?: number; offset?: number; workspaceId?: string },
) {
  const { limit = 50, offset = 0 } = opts ?? {};
  const conditions = [];
  if (opts?.userId) {
    conditions.push(eq(userPatterns.userId, opts.userId));
  }
  if (!opts?.includeInactive) {
    conditions.push(eq(userPatterns.isActive, true));
  }
  if (opts?.workspaceId) {
    conditions.push(eq(userPatterns.workspaceId, opts.workspaceId));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(userPatterns)
      .where(where)
      .orderBy(desc(userPatterns.confidence))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(userPatterns).where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function togglePatternActive(db: Db, id: string, isActive: boolean) {
  const [updated] = await db
    .update(userPatterns)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(userPatterns.id, id))
    .returning();
  return updated;
}

export async function deletePattern(db: Db, id: string) {
  const result = await db
    .delete(userPatterns)
    .where(eq(userPatterns.id, id))
    .returning({ id: userPatterns.id });
  return result.length > 0;
}

export async function createPattern(
  db: Db,
  data: {
    userId?: string;
    workspaceId?: string;
    patternType: string;
    description: string;
    suggestedAction: string;
    triggerCondition?: unknown;
    confidence?: number;
  },
) {
  const [created] = await db
    .insert(userPatterns)
    .values({
      userId: data.userId,
      workspaceId: data.workspaceId,
      patternType: data.patternType,
      description: data.description,
      suggestedAction: data.suggestedAction,
      triggerCondition: data.triggerCondition ?? {},
      confidence: data.confidence ?? 50,
    })
    .returning();
  return created;
}

export async function updatePattern(
  db: Db,
  id: string,
  data: {
    description?: string;
    suggestedAction?: string;
    triggerCondition?: unknown;
    confidence?: number;
    isActive?: boolean;
  },
) {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (data.description !== undefined) set.description = data.description;
  if (data.suggestedAction !== undefined) set.suggestedAction = data.suggestedAction;
  if (data.triggerCondition !== undefined) set.triggerCondition = data.triggerCondition;
  if (data.confidence !== undefined) set.confidence = data.confidence;
  if (data.isActive !== undefined) set.isActive = data.isActive;

  const [updated] = await db
    .update(userPatterns)
    .set(set)
    .where(eq(userPatterns.id, id))
    .returning();
  return updated;
}

export async function adjustPatternConfidence(db: Db, patternId: string, delta: number) {
  const [updated] = await db
    .update(userPatterns)
    .set({
      confidence: sql`GREATEST(0, LEAST(100, ${userPatterns.confidence} + ${delta}))`,
      updatedAt: new Date(),
    })
    .where(eq(userPatterns.id, patternId))
    .returning();
  return updated;
}

export async function getPatternAnalytics(db: Db, userId?: string, workspaceId?: string) {
  const conditions = [];
  if (userId) conditions.push(eq(userPatterns.userId, userId));
  if (workspaceId) conditions.push(eq(userPatterns.workspaceId, workspaceId));

  const patterns = await db
    .select()
    .from(userPatterns)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(userPatterns.updatedAt));

  const totalPatterns = patterns.length;
  const activePatterns = patterns.filter((p) => p.isActive).length;
  const totalHits = patterns.reduce((s, p) => s + p.hitCount, 0);
  const totalAccepts = patterns.reduce((s, p) => s + p.acceptCount, 0);
  const overallAcceptRate = totalHits > 0 ? (totalAccepts / totalHits) * 100 : 0;
  const avgConfidence =
    totalPatterns > 0
      ? patterns.reduce((s, p) => s + p.confidence, 0) / totalPatterns
      : 0;

  // Group by type
  const byType: Record<string, number> = {};
  for (const p of patterns) {
    byType[p.patternType] = (byType[p.patternType] ?? 0) + 1;
  }

  return {
    totalPatterns,
    activePatterns,
    totalHits,
    totalAccepts,
    overallAcceptRate: Math.round(overallAcceptRate * 10) / 10,
    avgConfidence: Math.round(avgConfidence * 10) / 10,
    byType,
    patterns,
  };
}

export async function getActionHeatmap(db: Db, userId?: string, workspaceId?: string) {
  const parts: ReturnType<typeof sql>[] = [];
  if (userId) parts.push(sql`user_id = ${userId}`);
  if (workspaceId) parts.push(sql`workspace_id = ${workspaceId}`);
  const conditions = parts.length > 0 ? sql`WHERE ${sql.join(parts, sql` AND `)}` : sql``;

  const rows = await db.execute(
    sql`SELECT day_of_week, hour_of_day, COUNT(*)::int AS count
        FROM user_actions ${conditions}
        GROUP BY day_of_week, hour_of_day
        ORDER BY day_of_week, hour_of_day`,
  );

  return rows as unknown as Array<{ day_of_week: number; hour_of_day: number; count: number }>;
}


/* ────────────────── Deployments ─────────────── */

export async function createDeployment(
  db: Db,
  data: {
    commitSha: string;
    shortSha: string;
    branch?: string;
    services?: string[];
    previousSha?: string;
    triggeredBy?: string;
  },
) {
  const [row] = await db
    .insert(deployments)
    .values({
      commitSha: data.commitSha,
      shortSha: data.shortSha,
      branch: data.branch ?? "main",
      services: data.services,
      previousSha: data.previousSha,
      triggeredBy: data.triggeredBy ?? "ci",
    })
    .returning();
  return row;
}

export async function updateDeploymentStatus(
  db: Db,
  id: string,
  data: {
    status: string;
    healthChecks?: unknown;
    errorLog?: string;
    rootCauseAnalysis?: string;
    rolledBack?: boolean;
    rollbackSha?: string;
    completedAt?: Date;
  },
) {
  const [row] = await db
    .update(deployments)
    .set({
      status: data.status as typeof deployments.$inferSelect["status"],
      healthChecks: data.healthChecks,
      errorLog: data.errorLog,
      rootCauseAnalysis: data.rootCauseAnalysis,
      rolledBack: data.rolledBack,
      rollbackSha: data.rollbackSha,
      completedAt: data.completedAt,
    })
    .where(eq(deployments.id, id))
    .returning();
  return row;
}

export async function getLatestDeployment(db: Db) {
  const rows = await db
    .select()
    .from(deployments)
    .orderBy(desc(deployments.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listDeployments(db: Db, opts: { limit?: number; offset?: number } = {}) {
  const { limit = 20, offset = 0 } = opts;
  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(deployments)
      .orderBy(desc(deployments.startedAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(deployments),
  ]);
  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getDeploymentBySha(db: Db, commitSha: string) {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.commitSha, commitSha))
    .orderBy(desc(deployments.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/* ────────────────── Tool Tier Config ─────────────── */

export async function listToolTierConfigs(db: Db) {
  return db
    .select()
    .from(toolTierConfig)
    .orderBy(asc(toolTierConfig.toolName));
}

export async function getToolTierConfig(db: Db, toolName: string) {
  const rows = await db
    .select()
    .from(toolTierConfig)
    .where(eq(toolTierConfig.toolName, toolName))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertToolTierConfig(
  db: Db,
  data: {
    toolName: string;
    tier: "green" | "yellow" | "red";
    timeoutMs?: number;
    updatedBy?: string;
  },
) {
  const [row] = await db
    .insert(toolTierConfig)
    .values({
      toolName: data.toolName,
      tier: data.tier,
      timeoutMs: data.timeoutMs ?? 300000,
      updatedBy: data.updatedBy,
    })
    .onConflictDoUpdate({
      target: toolTierConfig.toolName,
      set: {
        tier: data.tier,
        timeoutMs: data.timeoutMs ?? 300000,
        updatedBy: data.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listExpiredPendingApprovals(db: Db) {
  // Returns approvals that have been pending for more than 300 seconds (default timeout)
  // The per-tool timeout sweep in Plan 02 will refine this with per-tool values
  return db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.status, "pending"),
        sql`${approvals.createdAt} < (now() - interval '300 seconds')`,
      ),
    )
    .orderBy(asc(approvals.createdAt));
}

/* ────────────────── Deploy Circuit Breaker ─────────────── */

export async function getDeployCircuitBreaker(db: Db) {
  const rows = await db.select().from(deployCircuitBreaker).limit(1);
  return rows[0] ?? null;
}

export async function upsertDeployCircuitBreaker(
  db: Db,
  data: {
    isPaused: boolean;
    pausedAt?: Date | null;
    pausedReason?: string | null;
    failureCount: number;
    failureWindowStart?: Date | null;
    resumedAt?: Date | null;
    resumedBy?: string | null;
  },
) {
  const existing = await getDeployCircuitBreaker(db);
  if (existing) {
    const [row] = await db
      .update(deployCircuitBreaker)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(deployCircuitBreaker.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(deployCircuitBreaker).values(data).returning();
  return row;
}

export async function resetCircuitBreaker(db: Db, resumedBy?: string) {
  const existing = await getDeployCircuitBreaker(db);
  if (!existing) return null;
  const [row] = await db
    .update(deployCircuitBreaker)
    .set({
      isPaused: false,
      pausedAt: null,
      pausedReason: null,
      failureCount: 0,
      failureWindowStart: null,
      resumedAt: new Date(),
      resumedBy: resumedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(deployCircuitBreaker.id, existing.id))
    .returning();
  return row;
}

export async function getRecentFailedDeployments(db: Db, windowHours: number) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        or(eq(deployments.status, "failed"), eq(deployments.status, "rolled_back")),
        sql`${deployments.startedAt} >= ${since}`,
      ),
    )
    .orderBy(desc(deployments.startedAt));
  return rows;
}

export async function updateDeploymentSoakStatus(
  db: Db,
  id: string,
  data: {
    soakStatus?: string;
    soakStartedAt?: Date;
    soakCompletedAt?: Date;
    soakMetrics?: unknown;
    remediationActions?: unknown;
    gitDiffSummary?: string;
  },
) {
  const [row] = await db
    .update(deployments)
    .set(data)
    .where(eq(deployments.id, id))
    .returning();
  return row;
}

/* ────────────────── Session Engagement ─────────────── */

export async function upsertSessionEngagement(
  db: Db,
  data: {
    id?: string;
    userId?: string;
    sessionStart?: Date;
    messageCount: number;
    avgMessageLength: number;
    avgResponseIntervalMs: number;
    complexityScore: number;
    energyLevel: string;
    lastMessageAt?: Date;
    metadata?: Record<string, unknown>;
  },
) {
  if (data.id) {
    const [row] = await db
      .update(sessionEngagement)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(sessionEngagement.id, data.id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(sessionEngagement)
    .values({
      userId: data.userId,
      sessionStart: data.sessionStart ?? new Date(),
      messageCount: data.messageCount,
      avgMessageLength: data.avgMessageLength,
      avgResponseIntervalMs: data.avgResponseIntervalMs,
      complexityScore: data.complexityScore,
      energyLevel: data.energyLevel,
      lastMessageAt: data.lastMessageAt,
      metadata: data.metadata,
    })
    .returning();
  return row;
}

export async function getLatestSessionEngagement(db: Db, userId: string) {
  const rows = await db
    .select()
    .from(sessionEngagement)
    .where(eq(sessionEngagement.userId, userId))
    .orderBy(desc(sessionEngagement.sessionStart))
    .limit(1);
  return rows[0] ?? null;
}

/* ────────────────── User Timezone ─────────────── */

export async function getUserTimezone(db: Db, userId: string) {
  const rows = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.timezone ?? null;
}

export async function setUserTimezone(db: Db, userId: string, timezone: string) {
  const [row] = await db
    .update(users)
    .set({ timezone })
    .where(eq(users.id, userId))
    .returning();
  return row;
}

export async function getSessionEngagementHistory(db: Db, userId: string, limit = 10) {
  return db
    .select()
    .from(sessionEngagement)
    .where(eq(sessionEngagement.userId, userId))
    .orderBy(desc(sessionEngagement.sessionStart))
    .limit(limit);
}

/* ────────────────── Journal Entries ─────────────────────── */

type JournalEntryType =
  | "goal_started" | "goal_completed" | "goal_failed"
  | "task_completed" | "task_failed"
  | "git_commit" | "pr_created"
  | "reflection" | "work_session" | "subagent_run" | "deployment";

export async function createJournalEntry(
  db: Db,
  data: {
    entryType: JournalEntryType;
    title: string;
    summary?: string;
    goalId?: string;
    taskId?: string;
    workSessionId?: string;
    details?: Record<string, unknown>;
    occurredAt?: Date;
  },
) {
  const [entry] = await db
    .insert(journalEntries)
    .values({
      entryType: data.entryType,
      title: data.title,
      summary: data.summary,
      goalId: data.goalId,
      taskId: data.taskId,
      workSessionId: data.workSessionId,
      details: data.details,
      occurredAt: data.occurredAt ?? new Date(),
    })
    .returning();
  return entry;
}

export async function getJournalEntry(db: Db, id: string) {
  const rows = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function listJournalEntries(
  db: Db,
  opts: {
    since?: Date;
    until?: Date;
    goalId?: string;
    entryType?: string;
    search?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const { since, until, goalId, entryType, search, limit = 50, offset = 0 } = opts;
  const conditions = [];

  if (since) conditions.push(sql`${journalEntries.occurredAt} >= ${since.toISOString()}`);
  if (until) conditions.push(sql`${journalEntries.occurredAt} <= ${until.toISOString()}`);
  if (goalId) conditions.push(eq(journalEntries.goalId, goalId));
  if (entryType) conditions.push(sql`${journalEntries.entryType} = ${entryType}`);
  if (search) {
    conditions.push(sql`"journal_entries"."search_text" @@ plainto_tsquery('english', ${search})`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(journalEntries)
      .where(where)
      .orderBy(desc(journalEntries.occurredAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(journalEntries)
      .where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function listWorkSessionsFiltered(
  db: Db,
  opts: {
    since?: Date;
    until?: Date;
    goalId?: string;
    limit?: number;
    offset?: number;
  } = {},
) {
  const { since, until, goalId, limit = 50, offset = 0 } = opts;
  const conditions = [];

  if (since) conditions.push(sql`${workSessions.createdAt} >= ${since.toISOString()}`);
  if (until) conditions.push(sql`${workSessions.createdAt} <= ${until.toISOString()}`);
  if (goalId) conditions.push(eq(workSessions.goalId, goalId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [data, countResult] = await Promise.all([
    db
      .select()
      .from(workSessions)
      .where(where)
      .orderBy(desc(workSessions.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workSessions)
      .where(where),
  ]);

  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getWorkSession(db: Db, id: string) {
  const rows = await db.select().from(workSessions).where(eq(workSessions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function cancelWorkSession(db: Db, id: string) {
  const rows = await db
    .update(workSessions)
    .set({ status: "failed", summary: "Cancelled by user", completedAt: new Date() })
    .where(and(eq(workSessions.id, id), eq(workSessions.status, "running")))
    .returning();
  return rows[0] ?? null;
}

/* ──────────────── Registered Projects ──────────────────── */

export async function createRegisteredProject(
  db: Db,
  data: {
    name: string;
    slug: string;
    workspacePath: string;
    repoUrl?: string;
    description?: string;
    language?: "typescript" | "python" | "javascript" | "go" | "other";
    defaultBranch?: string;
    testCommand?: string;
    isActive?: boolean;
    config?: Record<string, unknown>;
    lastIngestedAt?: Date;
  },
) {
  const [project] = await db.insert(registeredProjects).values(data).returning();
  return project;
}

export async function listRegisteredProjects(db: Db) {
  return db
    .select()
    .from(registeredProjects)
    .where(eq(registeredProjects.isActive, true))
    .orderBy(asc(registeredProjects.name));
}

export async function getRegisteredProjectByName(db: Db, name: string) {
  const rows = await db
    .select()
    .from(registeredProjects)
    .where(eq(registeredProjects.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRegisteredProjectById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(registeredProjects)
    .where(eq(registeredProjects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateRegisteredProject(
  db: Db,
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    workspacePath: string;
    repoUrl: string | null;
    description: string | null;
    language: "typescript" | "python" | "javascript" | "go" | "other";
    defaultBranch: string;
    testCommand: string | null;
    isActive: boolean;
    config: Record<string, unknown> | null;
    lastIngestedAt: Date | null;
  }>,
) {
  const [updated] = await db
    .update(registeredProjects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(registeredProjects.id, id))
    .returning();
  return updated;
}

export async function deleteRegisteredProject(db: Db, id: string) {
  const [updated] = await db
    .update(registeredProjects)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(registeredProjects.id, id))
    .returning();
  return updated;
}

export async function createProjectDependency(
  db: Db,
  data: {
    sourceProjectId: string;
    targetProjectId: string;
    dependencyType: string;
    description?: string;
  },
) {
  const [dep] = await db.insert(projectDependencies).values(data).returning();
  return dep;
}

export async function listProjectDependencies(db: Db, projectId: string) {
  return db
    .select()
    .from(projectDependencies)
    .where(
      or(
        eq(projectDependencies.sourceProjectId, projectId),
        eq(projectDependencies.targetProjectId, projectId),
      ),
    );
}

export async function deleteProjectDependency(db: Db, id: string) {
  const [deleted] = await db
    .delete(projectDependencies)
    .where(eq(projectDependencies.id, id))
    .returning();
  return deleted;
}

/* ────────────────── Pipeline Templates ─────────────────────── */

export async function createPipelineTemplate(
  db: Db,
  data: {
    name: string;
    description?: string;
    stages: unknown;
    defaultContext?: unknown;
    isActive?: boolean;
  },
) {
  const [template] = await db.insert(pipelineTemplates).values(data).returning();
  return template;
}

export async function getPipelineTemplate(db: Db, id: string) {
  const rows = await db.select().from(pipelineTemplates).where(eq(pipelineTemplates.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getPipelineTemplateByName(db: Db, name: string) {
  const rows = await db
    .select()
    .from(pipelineTemplates)
    .where(eq(pipelineTemplates.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPipelineTemplates(db: Db, activeOnly = true) {
  const conditions = activeOnly ? [eq(pipelineTemplates.isActive, true)] : [];
  return db
    .select()
    .from(pipelineTemplates)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(pipelineTemplates.name));
}

export async function updatePipelineTemplate(
  db: Db,
  id: string,
  data: Partial<{
    name: string;
    description: string;
    stages: unknown;
    defaultContext: unknown;
    isActive: boolean;
  }>,
) {
  const [updated] = await db
    .update(pipelineTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(pipelineTemplates.id, id))
    .returning();
  return updated ?? null;
}

export async function deletePipelineTemplate(db: Db, id: string) {
  const result = await db
    .delete(pipelineTemplates)
    .where(eq(pipelineTemplates.id, id))
    .returning();
  return result.length > 0;
}

/* ────────────────── Briefing Cache ─────────────────────── */

export async function getBriefingCache(db: Db, date: string) {
  const rows = await db
    .select()
    .from(briefingCache)
    .where(eq(briefingCache.date, date))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertBriefingCache(
  db: Db,
  date: string,
  briefingText: string,
  sections?: Record<string, unknown>,
) {
  const [row] = await db
    .insert(briefingCache)
    .values({ date, briefingText, sections })
    .onConflictDoUpdate({
      target: briefingCache.date,
      set: {
        briefingText,
        sections,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/* ────────────────── Meeting Preps ─────────────────────── */

export async function getMeetingPrep(db: Db, eventId: string) {
  const rows = await db
    .select()
    .from(meetingPreps)
    .where(eq(meetingPreps.eventId, eventId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMeetingPrep(
  db: Db,
  data: {
    eventId: string;
    eventTitle: string;
    eventStart: Date;
    prepText: string;
    attendees?: unknown;
    relatedMemories?: unknown;
  },
) {
  const [row] = await db
    .insert(meetingPreps)
    .values({
      eventId: data.eventId,
      eventTitle: data.eventTitle,
      eventStart: data.eventStart,
      prepText: data.prepText,
      attendees: data.attendees,
      relatedMemories: data.relatedMemories,
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: meetingPreps.eventId,
      set: {
        eventTitle: data.eventTitle,
        eventStart: data.eventStart,
        prepText: data.prepText,
        attendees: data.attendees,
        relatedMemories: data.relatedMemories,
        generatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listUnnotifiedMeetingPreps(db: Db) {
  const thirtyMinFromNow = new Date(Date.now() + 30 * 60 * 1000);
  return db
    .select()
    .from(meetingPreps)
    .where(
      and(
        eq(meetingPreps.notified, false),
        lte(meetingPreps.eventStart, thirtyMinFromNow),
        gt(meetingPreps.eventStart, new Date()),
      ),
    );
}

export async function markMeetingPrepNotified(db: Db, id: string) {
  await db
    .update(meetingPreps)
    .set({ notified: true })
    .where(eq(meetingPreps.id, id));
}

/* ────────────────────────── Follow-Ups ────────────────────────── */

export async function createFollowUp(
  db: Db,
  data: {
    title: string;
    workspaceId?: string;
    description?: string;
    dueDate?: Date;
    source?: string;
  },
) {
  const [row] = await db
    .insert(followUps)
    .values({
      title: data.title,
      workspaceId: data.workspaceId,
      description: data.description,
      dueDate: data.dueDate,
      source: data.source,
    })
    .returning();
  return row;
}

export async function getFollowUp(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(followUps.id, id)];
  if (workspaceId) conditions.push(eq(followUps.workspaceId, workspaceId));
  const rows = await db
    .select()
    .from(followUps)
    .where(and(...conditions))
    .limit(1);
  return rows[0] ?? null;
}

export async function listFollowUps(
  db: Db,
  opts?: { status?: "pending" | "done" | "dismissed"; limit?: number; offset?: number; workspaceId?: string },
) {
  const { status, limit = 50, offset = 0 } = opts ?? {};
  const conditions = status ? [eq(followUps.status, status)] : [];
  if (opts?.workspaceId) conditions.push(eq(followUps.workspaceId, opts.workspaceId));

  const rows = await db
    .select()
    .from(followUps)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(followUps.createdAt))
    .limit(limit)
    .offset(offset);

  return { data: rows, total: rows.length };
}

export async function updateFollowUp(
  db: Db,
  id: string,
  data: {
    title?: string;
    description?: string;
    status?: "pending" | "done" | "dismissed";
    dueDate?: Date | null;
    source?: string;
  },
) {
  const [row] = await db
    .update(followUps)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(followUps.id, id))
    .returning();
  return row ?? null;
}

export async function deleteFollowUp(db: Db, id: string) {
  const [row] = await db
    .delete(followUps)
    .where(eq(followUps.id, id))
    .returning();
  return row ?? null;
}

export async function listDueFollowUps(db: Db) {
  return db
    .select()
    .from(followUps)
    .where(
      and(
        eq(followUps.status, "pending"),
        lte(followUps.dueDate, new Date()),
        eq(followUps.reminderSent, false),
      ),
    );
}

export async function markFollowUpReminderSent(db: Db, id: string) {
  await db
    .update(followUps)
    .set({ reminderSent: true, updatedAt: new Date() })
    .where(eq(followUps.id, id));
}

/* ────────────────────── Thinking Traces ────────────────────── */

export async function saveThinkingTrace(
  db: Db,
  data: {
    conversationId: string;
    requestId?: string;
    round: number;
    content: string;
    tokenCount?: number;
  },
) {
  const rows = await db
    .insert(thinkingTraces)
    .values({
      conversationId: data.conversationId,
      requestId: data.requestId,
      round: data.round,
      content: data.content,
      tokenCount: data.tokenCount ?? Math.ceil(data.content.length / 4),
    })
    .returning();
  return rows[0];
}

export async function getThinkingTraces(
  db: Db,
  conversationId: string,
  requestId?: string,
) {
  const conditions = [eq(thinkingTraces.conversationId, conversationId)];
  if (requestId) {
    conditions.push(eq(thinkingTraces.requestId, requestId));
  }
  return db
    .select()
    .from(thinkingTraces)
    .where(and(...conditions))
    .orderBy(asc(thinkingTraces.createdAt), asc(thinkingTraces.round));
}

/* ────────────────────── Tool Efficacy Stats ────────────────────── */

export async function getToolEfficacyStats(db: Db, sinceDays = 7) {
  const since = new Date();
  since.setDate(since.getDate() - sinceDays);
  const rows = await db
    .select({
      toolName: toolExecutions.toolName,
      totalCalls: sql<number>`count(*)::int`,
      successCount: sql<number>`count(*) filter (where ${toolExecutions.success} = true)::int`,
      avgDurationMs: sql<number>`avg(${toolExecutions.durationMs})::int`,
    })
    .from(toolExecutions)
    .where(gt(toolExecutions.createdAt, since))
    .groupBy(toolExecutions.toolName)
    .orderBy(sql`count(*) desc`);
  return rows;
}

/* ────────────────────── Hybrid RAG Search (BM25 + Vector) ────────────────────── */

export async function searchChunksByText(
  db: Db,
  query: string,
  options?: {
    limit?: number;
    sourceType?: SourceType;
    sourceId?: string;
  },
) {
  const limit = options?.limit ?? 20;
  const validSourceTypes: SourceType[] = ["git", "conversation", "slack", "memory", "reflection", "markdown"];
  let whereClause = sql`search_vector IS NOT NULL`;
  if (options?.sourceType && validSourceTypes.includes(options.sourceType)) {
    whereClause = sql`${whereClause} AND source_type = ${options.sourceType}`;
  }
  if (options?.sourceId) {
    whereClause = sql`${whereClause} AND source_id = ${options.sourceId}`;
  }

  const rows = await db.execute(
    sql`SELECT id, source_type, source_id, content, metadata, chunk_index, token_count, created_at,
               ts_rank_cd(search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM document_chunks
        WHERE ${whereClause} AND search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    source_type: string;
    source_id: string;
    content: string;
    metadata: Record<string, unknown> | null;
    chunk_index: number;
    token_count: number;
    created_at: Date;
    rank: number;
  }>;
}

export async function hybridSearchChunks(
  db: Db,
  embedding: number[],
  queryText: string,
  options?: {
    limit?: number;
    sourceType?: SourceType;
    sourceId?: string;
    vectorWeight?: number;
    bm25Weight?: number;
  },
) {
  const limit = options?.limit ?? 20;
  const vectorWeight = options?.vectorWeight ?? 0.6;
  const bm25Weight = options?.bm25Weight ?? 0.4;
  const k = 60; // RRF constant
  const vectorLiteral = `[${embedding.join(",")}]`;

  const validSourceTypes: SourceType[] = ["git", "conversation", "slack", "memory", "reflection", "markdown"];
  let whereClause = sql`embedding IS NOT NULL`;
  if (options?.sourceType && validSourceTypes.includes(options.sourceType)) {
    whereClause = sql`${whereClause} AND source_type = ${options.sourceType}`;
  }
  if (options?.sourceId) {
    whereClause = sql`${whereClause} AND source_id = ${options.sourceId}`;
  }

  // Reciprocal Rank Fusion (RRF) combining vector and BM25 results
  const rows = await db.execute(
    sql`WITH vector_ranked AS (
          SELECT id, content, source_type, source_id, metadata, chunk_index, token_count, created_at,
                 ROW_NUMBER() OVER (ORDER BY embedding <=> ${vectorLiteral}::vector ASC) AS vrank
          FROM document_chunks
          WHERE ${whereClause}
          LIMIT 100
        ),
        bm25_ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', ${queryText})) DESC) AS brank
          FROM document_chunks
          WHERE search_vector IS NOT NULL AND search_vector @@ plainto_tsquery('english', ${queryText})
          LIMIT 100
        )
        SELECT v.id, v.content, v.source_type, v.source_id, v.metadata, v.chunk_index, v.token_count, v.created_at,
               (${vectorWeight} / (${k} + v.vrank)) + COALESCE(${bm25Weight} / (${k} + b.brank), 0) AS rrf_score,
               v.vrank,
               b.brank
        FROM vector_ranked v
        LEFT JOIN bm25_ranked b ON v.id = b.id
        ORDER BY rrf_score DESC
        LIMIT ${limit}`,
  );
  return rows as unknown as Array<{
    id: string;
    content: string;
    source_type: string;
    source_id: string;
    metadata: Record<string, unknown> | null;
    chunk_index: number;
    token_count: number;
    created_at: Date;
    rrf_score: number;
    vrank: number;
    brank: number | null;
  }>;
}

/* ────────────────────── Episodic Memory ────────────────────── */

export async function createEpisodicMemory(
  db: Db,
  data: {
    conversationId: string;
    workspaceId?: string;
    summary: string;
    keyDecisions?: unknown[];
    toolsUsed?: string[];
    goalsWorkedOn?: unknown[];
    emotionalContext?: string;
    importance?: number;
    embedding?: number[];
  },
) {
  const rows = await db.insert(episodicMemories).values(data).returning();
  return rows[0];
}

export async function listEpisodicMemories(db: Db, limit = 20, offset = 0, workspaceId?: string) {
  const conditions = [];
  if (workspaceId) conditions.push(eq(episodicMemories.workspaceId, workspaceId));

  return db
    .select()
    .from(episodicMemories)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(episodicMemories.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function searchEpisodicMemoriesByVector(
  db: Db,
  embedding: number[],
  limit = 5,
  minScore = 0.3,
  workspaceId?: string,
) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const wsFilter = workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``;
  const rows = await db.execute(
    sql`SELECT id, conversation_id, summary, key_decisions, tools_used, goals_worked_on,
               emotional_context, importance, accessed_at, access_count, created_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM episodic_memories
        WHERE embedding IS NOT NULL ${wsFilter}
        ORDER BY distance ASC
        LIMIT ${limit}`,
  );
  const results = rows as unknown as Array<{
    id: string;
    conversation_id: string;
    summary: string;
    key_decisions: unknown[];
    tools_used: string[];
    goals_worked_on: unknown[];
    emotional_context: string | null;
    importance: number;
    accessed_at: Date;
    access_count: number;
    created_at: Date;
    distance: number;
  }>;
  return results.filter((r) => 1 - r.distance >= minScore);
}

export async function touchEpisodicMemory(db: Db, id: string) {
  await db
    .update(episodicMemories)
    .set({
      accessedAt: new Date(),
      accessCount: sql`${episodicMemories.accessCount} + 1`,
    })
    .where(eq(episodicMemories.id, id));
}

/* ────────────────────── Procedural Memory ────────────────────── */

export async function createProceduralMemory(
  db: Db,
  data: {
    triggerPattern: string;
    steps: unknown[];
    preconditions?: unknown[];
    createdFromGoalId?: string;
    tags?: unknown[];
    embedding?: number[];
  },
) {
  const rows = await db.insert(proceduralMemories).values(data).returning();
  return rows[0];
}

export async function listProceduralMemories(db: Db, limit = 20, offset = 0) {
  return db
    .select()
    .from(proceduralMemories)
    .orderBy(desc(proceduralMemories.successCount))
    .limit(limit)
    .offset(offset);
}

export async function searchProceduralMemoriesByVector(
  db: Db,
  embedding: number[],
  limit = 5,
  minScore = 0.3,
) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const rows = await db.execute(
    sql`SELECT id, trigger_pattern, steps, preconditions, success_count, failure_count,
               last_used, created_from_goal_id, tags, created_at, updated_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM procedural_memories
        WHERE embedding IS NOT NULL
        ORDER BY distance ASC
        LIMIT ${limit}`,
  );
  const results = rows as unknown as Array<{
    id: string;
    trigger_pattern: string;
    steps: unknown[];
    preconditions: unknown[];
    success_count: number;
    failure_count: number;
    last_used: Date | null;
    created_from_goal_id: string | null;
    tags: unknown[];
    created_at: Date;
    updated_at: Date;
    distance: number;
  }>;
  return results.filter((r) => 1 - r.distance >= minScore);
}

export async function incrementProceduralSuccess(db: Db, id: string) {
  await db
    .update(proceduralMemories)
    .set({
      successCount: sql`${proceduralMemories.successCount} + 1`,
      lastUsed: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(proceduralMemories.id, id));
}

export async function incrementProceduralFailure(db: Db, id: string) {
  await db
    .update(proceduralMemories)
    .set({
      failureCount: sql`${proceduralMemories.failureCount} + 1`,
      lastUsed: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(proceduralMemories.id, id));
}

/* ────────────────────── Memory Lifecycle ────────────────────── */

export async function archiveMemory(db: Db, id: string) {
  await db
    .update(memories)
    .set({ archivedAt: new Date() })
    .where(eq(memories.id, id));
}

export async function listMemoriesForDecay(db: Db, userId: string, limit = 500) {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.archivedAt)))
    .orderBy(desc(memories.lastAccessedAt))
    .limit(limit);
}

export async function countActiveMemories(db: Db, userId: string) {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(and(eq(memories.userId, userId), isNull(memories.archivedAt)));
  return rows[0]?.count ?? 0;
}

export async function findSimilarMemories(
  db: Db,
  userId: string,
  embedding: number[],
  limit = 5,
  minScore = 0.85,
  workspaceId?: string,
) {
  const vectorLiteral = `[${embedding.join(",")}]`;
  const wsFilter = workspaceId ? sql`AND workspace_id = ${workspaceId}` : sql``;
  const rows = await db.execute(
    sql`SELECT id, key, content, category, importance, access_count, created_at,
               embedding <=> ${vectorLiteral}::vector AS distance
        FROM memories
        WHERE user_id = ${userId} AND embedding IS NOT NULL AND archived_at IS NULL ${wsFilter}
        ORDER BY distance ASC
        LIMIT ${limit}`,
  );
  const results = rows as unknown as Array<{
    id: string;
    key: string;
    content: string;
    category: string;
    importance: number;
    access_count: number;
    created_at: Date;
    distance: number;
  }>;
  return results.filter((r) => 1 - r.distance >= minScore);
}

/* ────────────────────── Failure Patterns ────────────────────── */

export async function upsertFailurePattern(
  db: Db,
  data: {
    toolName: string;
    errorCategory: string;
    errorMessage: string;
    context?: Record<string, unknown>;
    resolution?: string;
  },
) {
  // Try to find existing pattern for this tool+category
  const existing = await db
    .select()
    .from(failurePatterns)
    .where(
      and(
        eq(failurePatterns.toolName, data.toolName),
        eq(failurePatterns.errorCategory, data.errorCategory),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const updated = await db
      .update(failurePatterns)
      .set({
        frequency: sql`${failurePatterns.frequency} + 1`,
        lastSeen: new Date(),
        errorMessage: data.errorMessage,
        context: data.context ?? existing[0].context,
        resolution: data.resolution ?? existing[0].resolution,
        updatedAt: new Date(),
      })
      .where(eq(failurePatterns.id, existing[0].id))
      .returning();
    return updated[0];
  }

  const rows = await db.insert(failurePatterns).values(data).returning();
  return rows[0];
}

export async function listFailurePatterns(db: Db, limit = 50) {
  return db
    .select()
    .from(failurePatterns)
    .orderBy(desc(failurePatterns.frequency))
    .limit(limit);
}

export async function getFailurePatternsForTool(db: Db, toolName: string, limit = 5) {
  return db
    .select()
    .from(failurePatterns)
    .where(eq(failurePatterns.toolName, toolName))
    .orderBy(desc(failurePatterns.frequency))
    .limit(limit);
}

export async function incrementFailureFrequency(db: Db, id: string) {
  await db
    .update(failurePatterns)
    .set({
      frequency: sql`${failurePatterns.frequency} + 1`,
      lastSeen: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(failurePatterns.id, id));
}

/* ────────────────────── Global Search ────────────────────── */

export async function globalSearch(
  db: Db,
  query: string,
  opts?: { limitPerCategory?: number },
) {
  const limit = opts?.limitPerCategory ?? 5;
  const pattern = `%${query}%`;

  const [goalRows, taskRows, conversationRows, memoryRows] = await Promise.all([
    db
      .select({ id: goals.id, title: goals.title, description: goals.description, status: goals.status, createdAt: goals.createdAt })
      .from(goals)
      .where(and(or(ilike(goals.title, pattern), ilike(goals.description, pattern)), isNull(goals.deletedAt)))
      .orderBy(desc(goals.createdAt))
      .limit(limit),
    db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, goalId: tasks.goalId, createdAt: tasks.createdAt })
      .from(tasks)
      .where(ilike(tasks.title, pattern))
      .orderBy(desc(tasks.createdAt))
      .limit(limit),
    db
      .select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt })
      .from(conversations)
      .where(and(ilike(conversations.title, pattern), isNull(conversations.deletedAt)))
      .orderBy(desc(conversations.createdAt))
      .limit(limit),
    db
      .select({ id: memories.id, key: memories.key, content: memories.content, category: memories.category, createdAt: memories.createdAt })
      .from(memories)
      .where(or(ilike(memories.key, pattern), ilike(memories.content, pattern)))
      .orderBy(desc(memories.createdAt))
      .limit(limit),
  ]);

  return { goals: goalRows, tasks: taskRows, conversations: conversationRows, memories: memoryRows };
}
