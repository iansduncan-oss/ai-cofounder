import {
  eq,
  and,
  desc,
  asc,
  ilike,
  or,
  sql,
  lte,
  gte,
  isNull,
  isNotNull,
  inArray,
  gt,
} from "drizzle-orm";
import type { Db } from "../client.js";

/** Coerce empty string to undefined for UUID columns */
function nullifyEmpty(val: string | undefined | null): string | undefined {
  return val ? val : undefined;
}
import {
  goals,
  tasks,
} from "../schema.js";

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
  const [goal] = await db
    .insert(goals)
    .values({ ...data, workspaceId: nullifyEmpty(data.workspaceId) })
    .returning();
  return goal;
}

export async function getGoal(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(goals.id, id), isNull(goals.deletedAt)];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));
  const rows = await db
    .select()
    .from(goals)
    .where(and(...conditions))
    .limit(1);
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

export async function countGoalsByConversation(
  db: Db,
  conversationId: string,
  workspaceId?: string,
): Promise<number> {
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
  const [row] = await db
    .update(goals)
    .set({ deletedAt: new Date() })
    .where(and(eq(goals.id, id), isNull(goals.deletedAt)))
    .returning();
  return row ?? null;
}

export async function restoreGoal(db: Db, id: string) {
  const [row] = await db.update(goals).set({ deletedAt: null }).where(eq(goals.id, id)).returning();
  return row ?? null;
}

export async function purgeDeletedGoals(db: Db, olderThan: Date) {
  const rows = await db
    .delete(goals)
    .where(and(isNotNull(goals.deletedAt), lte(goals.deletedAt, olderThan)))
    .returning();
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

export async function updateGoalMetadata(db: Db, id: string, metadata: Record<string, unknown>) {
  const goal = await getGoal(db, id);
  if (!goal) return null;

  const merged = { ...((goal.metadata as Record<string, unknown>) ?? {}), ...metadata };
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

  const [byStatusRows, byPriorityRows, completionMetrics, trendRows, taskAgentRows] =
    await Promise.all([
      // Count by status
      db
        .select({
          status: goals.status,
          count: sql<number>`count(*)::int`,
        })
        .from(goals)
        .where(notDeleted)
        .groupBy(goals.status),

      // Count by priority
      db
        .select({
          priority: goals.priority,
          count: sql<number>`count(*)::int`,
        })
        .from(goals)
        .where(notDeleted)
        .groupBy(goals.priority),

      // Completion metrics
      db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(case when ${goals.status} = 'completed' then 1 end)::int`,
          cancelled: sql<number>`count(case when ${goals.status} = 'cancelled' then 1 end)::int`,
          avgHours: sql<number>`round(extract(epoch from avg(case when ${goals.status} = 'completed' then ${goals.updatedAt} - ${goals.createdAt} end)) / 3600, 1)`,
        })
        .from(goals)
        .where(notDeleted),

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
      db
        .select({
          agent: tasks.assignedAgent,
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(case when ${tasks.status} = 'completed' then 1 end)::int`,
          failed: sql<number>`count(case when ${tasks.status} = 'failed' then 1 end)::int`,
        })
        .from(tasks)
        .where(and(...taskConditions))
        .groupBy(tasks.assignedAgent),
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
  const taskSuccessRate =
    taskTotals.total > 0 ? Math.round((taskTotals.completed / taskTotals.total) * 100) : 0;

  return {
    byStatus,
    byPriority,
    completionRate,
    avgCompletionHours: metrics?.avgHours ?? null,
    totalGoals,
    trend: (
      trendRows as unknown as Array<{ date: string; created: number; completed: number }>
    ).map((r) => ({
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

  return (
    rows as unknown as Array<{
      agent: string;
      total_tasks: number;
      completed_tasks: number;
      failed_tasks: number;
      avg_duration_ms: number | null;
      overall_success_rate: number;
      recent_completed: number;
      recent_failed: number;
    }>
  ).map((r) => {
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
      completedTaskCount:
        sql<number>`count(case when ${tasks.status} = 'completed' then 1 end)::int`.as(
          "completed_task_count",
        ),
    })
    .from(goals)
    .leftJoin(tasks, eq(tasks.goalId, goals.id))
    .where(and(...conditions))
    .groupBy(goals.id)
    .orderBy(desc(goals.updatedAt));

  return rows;
}

/**
 * Find an existing non-terminal goal whose title matches exactly (case-insensitive).
 * Used for deduplication — prevents creating duplicate goals from recurring monitoring/scheduling.
 * Returns the first matching goal or undefined.
 */
export async function findActiveGoalByTitle(
  db: Db,
  title: string,
  workspaceId?: string,
): Promise<{ id: string; title: string; status: string; createdAt: Date } | undefined> {
  const conditions = [
    ilike(goals.title, title),
    inArray(goals.status, ["draft", "proposed", "active"]),
    isNull(goals.deletedAt),
  ];
  if (workspaceId) conditions.push(eq(goals.workspaceId, workspaceId));

  const rows = await db
    .select({
      id: goals.id,
      title: goals.title,
      status: goals.status,
      createdAt: goals.createdAt,
    })
    .from(goals)
    .where(and(...conditions))
    .orderBy(desc(goals.createdAt))
    .limit(1);

  return rows[0];
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
      pendingTaskCount:
        sql<number>`count(case when ${tasks.status} = 'pending' then 1 end)::int`.as(
          "pending_task_count",
        ),
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

