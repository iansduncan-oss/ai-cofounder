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
  events,
  schedules,
  workSessions,
} from "../schema.js";

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
    .values({ ...data, workspaceId: nullifyEmpty(data.workspaceId) })
    .returning();
  return schedule;
}

export async function listSchedules(db: Db, userId?: string, workspaceId?: string) {
  const conditions = [];
  if (userId) conditions.push(eq(schedules.userId, userId));
  if (workspaceId) conditions.push(eq(schedules.workspaceId, workspaceId));

  return db
    .select()
    .from(schedules)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(schedules.createdAt));
}

export async function listEnabledSchedules(db: Db, workspaceId?: string) {
  const conditions = [eq(schedules.enabled, true)];
  if (workspaceId) conditions.push(eq(schedules.workspaceId, workspaceId));

  return db
    .select()
    .from(schedules)
    .where(and(...conditions))
    .orderBy(asc(schedules.nextRunAt));
}

export async function getSchedule(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(schedules.id, id)];
  if (workspaceId) conditions.push(eq(schedules.workspaceId, workspaceId));
  const rows = await db
    .select()
    .from(schedules)
    .where(and(...conditions))
    .limit(1);
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

export async function listEvents(db: Db, options?: EventFilterOptions) {
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
  return db.select().from(workSessions).orderBy(desc(workSessions.createdAt)).limit(limit);
}

/* ────────────────── Due Schedules ──────────────── */

export async function listDueSchedules(db: Db) {
  return db
    .select()
    .from(schedules)
    .where(and(eq(schedules.enabled, true), lte(schedules.nextRunAt, new Date())))
    .orderBy(asc(schedules.nextRunAt));
}

