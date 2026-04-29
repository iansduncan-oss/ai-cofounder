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
import type { MemoryCategory } from "./memories.js";

/** Coerce empty string to undefined for UUID columns */
function nullifyEmpty(val: string | undefined | null): string | undefined {
  return val ? val : undefined;
}
import {
  failurePatterns,
  memories,
  productivityLogs,
  providerHealth,
  thinkingTraces,
  toolExecutions,
} from "../schema.js";

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

export async function getErrorSummary(db: Db, options?: { since?: Date; limit?: number }) {
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

export async function getThinkingTraces(db: Db, conversationId: string, requestId?: string) {
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
  return db.select().from(failurePatterns).orderBy(desc(failurePatterns.frequency)).limit(limit);
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

/* ──��─────────────────── Productivity Logs ────────────────���───── */

export async function upsertProductivityLog(
  db: Db,
  data: {
    userId: string;
    date: string;
    plannedItems?: { text: string; completed: boolean }[];
    reflectionNotes?: string;
    mood?: "great" | "good" | "okay" | "rough" | "terrible";
    energyLevel?: number;
    completionScore?: number;
    streakDays?: number;
    highlights?: string;
    blockers?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(productivityLogs)
    .values({
      userId: data.userId,
      date: data.date,
      plannedItems: data.plannedItems ?? [],
      reflectionNotes: data.reflectionNotes,
      mood: data.mood,
      energyLevel: data.energyLevel,
      completionScore: data.completionScore,
      streakDays: data.streakDays ?? 0,
      highlights: data.highlights,
      blockers: data.blockers,
      metadata: data.metadata,
    })
    .onConflictDoUpdate({
      target: [productivityLogs.userId, productivityLogs.date],
      set: {
        plannedItems:
          data.plannedItems !== undefined
            ? data.plannedItems
            : sql`${productivityLogs.plannedItems}`,
        reflectionNotes:
          data.reflectionNotes !== undefined
            ? data.reflectionNotes
            : sql`${productivityLogs.reflectionNotes}`,
        mood: data.mood !== undefined ? data.mood : sql`${productivityLogs.mood}`,
        energyLevel:
          data.energyLevel !== undefined ? data.energyLevel : sql`${productivityLogs.energyLevel}`,
        completionScore:
          data.completionScore !== undefined
            ? data.completionScore
            : sql`${productivityLogs.completionScore}`,
        streakDays:
          data.streakDays !== undefined ? data.streakDays : sql`${productivityLogs.streakDays}`,
        highlights:
          data.highlights !== undefined ? data.highlights : sql`${productivityLogs.highlights}`,
        blockers: data.blockers !== undefined ? data.blockers : sql`${productivityLogs.blockers}`,
        metadata: data.metadata !== undefined ? data.metadata : sql`${productivityLogs.metadata}`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function getProductivityLog(db: Db, userId: string, date: string) {
  const rows = await db
    .select()
    .from(productivityLogs)
    .where(and(eq(productivityLogs.userId, userId), eq(productivityLogs.date, date)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listProductivityLogs(
  db: Db,
  userId: string,
  opts?: { limit?: number; offset?: number; from?: string; to?: string },
) {
  const { limit = 30, offset = 0, from, to } = opts ?? {};
  const conditions = [eq(productivityLogs.userId, userId)];
  if (from) conditions.push(sql`${productivityLogs.date} >= ${from}`);
  if (to) conditions.push(sql`${productivityLogs.date} <= ${to}`);

  const rows = await db
    .select()
    .from(productivityLogs)
    .where(and(...conditions))
    .orderBy(desc(productivityLogs.date))
    .limit(limit)
    .offset(offset);

  return { data: rows, total: rows.length };
}

export async function getProductivityStreak(db: Db, userId: string) {
  // Get the most recent log to read the stored streak
  const rows = await db
    .select()
    .from(productivityLogs)
    .where(eq(productivityLogs.userId, userId))
    .orderBy(desc(productivityLogs.date))
    .limit(1);
  return rows[0]?.streakDays ?? 0;
}

export async function getProductivityStats(db: Db, userId: string, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(productivityLogs)
    .where(and(eq(productivityLogs.userId, userId), sql`${productivityLogs.date} >= ${cutoffStr}`))
    .orderBy(asc(productivityLogs.date));

  const totalDays = rows.length;
  const avgCompletion =
    totalDays > 0
      ? Math.round(rows.reduce((sum, r) => sum + (r.completionScore ?? 0), 0) / totalDays)
      : 0;
  const avgEnergy =
    totalDays > 0
      ? +(rows.reduce((sum, r) => sum + (r.energyLevel ?? 3), 0) / totalDays).toFixed(1)
      : 0;
  const moodCounts: Record<string, number> = {};
  for (const r of rows) {
    if (r.mood) moodCounts[r.mood] = (moodCounts[r.mood] || 0) + 1;
  }

  return {
    totalDays,
    avgCompletion,
    avgEnergy,
    moodCounts,
    currentStreak: rows.length > 0 ? rows[rows.length - 1].streakDays : 0,
    history: rows.map((r) => ({
      date: r.date,
      completionScore: r.completionScore,
      mood: r.mood,
      energyLevel: r.energyLevel,
    })),
  };
}

export async function deleteProductivityLog(db: Db, id: string) {
  const [row] = await db.delete(productivityLogs).where(eq(productivityLogs.id, id)).returning();
  return row ?? null;
}

