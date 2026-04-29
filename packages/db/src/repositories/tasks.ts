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
import type { AgentRole } from "@ai-cofounder/shared";
import {
  approvals,
  followUps,
  tasks,
} from "../schema.js";

/* ────────────────────────── Tasks ────────────────────────── */

export async function createTask(
  db: Db,
  data: {
    goalId: string;
    workspaceId?: string;
    title: string;
    description?: string;
    assignedAgent?:
      | "orchestrator"
      | "researcher"
      | "coder"
      | "reviewer"
      | "planner"
      | "debugger"
      | "doc_writer"
      | "verifier";
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
  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .limit(1);
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

/** List tasks completed since a given timestamp (for plan-sync). */
export async function listRecentlyCompletedTasks(db: Db, since: Date, limit = 50) {
  return db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "completed"), gte(tasks.updatedAt, since)))
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
}

/** List follow-ups marked done since a given timestamp (for plan-sync). */
export async function listRecentlyCompletedFollowUps(db: Db, since: Date, limit = 50) {
  return db
    .select()
    .from(followUps)
    .where(and(eq(followUps.status, "done"), gte(followUps.updatedAt, since)))
    .orderBy(desc(followUps.updatedAt))
    .limit(limit);
}

export async function assignTask(db: Db, id: string, agent: AgentRole) {
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

