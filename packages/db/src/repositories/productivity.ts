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
  codebaseInsights,
  conversations,
  goals,
  memories,
  tasks,
} from "../schema.js";

/* ────────────────────── Codebase Insights ────────────────────── */

export type InsightCategory =
  | "fix"
  | "improve"
  | "add"
  | "review"
  | "followup"
  | "security"
  | "other";
export type InsightSeverity = "low" | "medium" | "high" | "critical";

export async function upsertCodebaseInsight(
  db: Db,
  data: {
    fingerprint: string;
    category: InsightCategory;
    severity?: InsightSeverity;
    title: string;
    description?: string;
    suggestedAction?: string;
    reference?: string;
    source: string;
    metadata?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(codebaseInsights)
    .values({
      fingerprint: data.fingerprint,
      category: data.category,
      severity: data.severity ?? "medium",
      title: data.title,
      description: data.description,
      suggestedAction: data.suggestedAction,
      reference: data.reference,
      source: data.source,
      metadata: data.metadata,
    })
    .onConflictDoUpdate({
      target: codebaseInsights.fingerprint,
      set: {
        title: data.title,
        description: data.description,
        suggestedAction: data.suggestedAction,
        reference: data.reference,
        severity: data.severity ?? sql`${codebaseInsights.severity}`,
        hitCount: sql`${codebaseInsights.hitCount} + 1`,
        lastSeenAt: new Date(),
        // If it was resolved/dismissed and came back, re-open it
        status: sql`CASE WHEN ${codebaseInsights.status} IN ('dismissed', 'resolved') THEN 'open' ELSE ${codebaseInsights.status} END`,
        resolvedAt: sql`CASE WHEN ${codebaseInsights.status} IN ('dismissed', 'resolved') THEN NULL ELSE ${codebaseInsights.resolvedAt} END`,
        metadata: data.metadata !== undefined ? data.metadata : sql`${codebaseInsights.metadata}`,
      },
    })
    .returning();
  return row;
}

export async function listCodebaseInsights(
  db: Db,
  opts?: {
    status?: "open" | "dismissed" | "resolved";
    category?: InsightCategory;
    severity?: InsightSeverity;
    limit?: number;
    offset?: number;
  },
) {
  const { status = "open", category, severity, limit = 50, offset = 0 } = opts ?? {};
  const conditions = [eq(codebaseInsights.status, status)];
  if (category) conditions.push(eq(codebaseInsights.category, category));
  if (severity) conditions.push(eq(codebaseInsights.severity, severity));

  const severityOrder = sql`CASE ${codebaseInsights.severity}
    WHEN 'critical' THEN 0
    WHEN 'high' THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low' THEN 3
    ELSE 4 END`;

  const rows = await db
    .select()
    .from(codebaseInsights)
    .where(and(...conditions))
    .orderBy(severityOrder, desc(codebaseInsights.lastSeenAt))
    .limit(limit)
    .offset(offset);

  return { data: rows, total: rows.length };
}

export async function updateCodebaseInsightStatus(
  db: Db,
  id: string,
  status: "open" | "dismissed" | "resolved",
) {
  const [row] = await db
    .update(codebaseInsights)
    .set({
      status,
      resolvedAt: status === "resolved" || status === "dismissed" ? new Date() : null,
    })
    .where(eq(codebaseInsights.id, id))
    .returning();
  return row ?? null;
}

export async function pruneStaleCodebaseInsights(db: Db, olderThanDays = 14) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - olderThanDays);
  const rows = await db
    .delete(codebaseInsights)
    .where(and(eq(codebaseInsights.status, "open"), lte(codebaseInsights.lastSeenAt, cutoff)))
    .returning({ id: codebaseInsights.id });
  return rows.length;
}

export async function countCodebaseInsights(
  db: Db,
  status: "open" | "dismissed" | "resolved" = "open",
) {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(codebaseInsights)
    .where(eq(codebaseInsights.status, status));
  return rows[0]?.count ?? 0;
}

/* ─────���──────────────── Global Search ────────────────────── */

export async function globalSearch(db: Db, query: string, opts?: { limitPerCategory?: number }) {
  const limit = opts?.limitPerCategory ?? 5;
  const pattern = `%${query}%`;

  const [goalRows, taskRows, conversationRows, memoryRows] = await Promise.all([
    db
      .select({
        id: goals.id,
        title: goals.title,
        description: goals.description,
        status: goals.status,
        createdAt: goals.createdAt,
      })
      .from(goals)
      .where(
        and(
          or(ilike(goals.title, pattern), ilike(goals.description, pattern)),
          isNull(goals.deletedAt),
        ),
      )
      .orderBy(desc(goals.createdAt))
      .limit(limit),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        goalId: tasks.goalId,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(ilike(tasks.title, pattern))
      .orderBy(desc(tasks.createdAt))
      .limit(limit),
    db
      .select({
        id: conversations.id,
        title: conversations.title,
        createdAt: conversations.createdAt,
      })
      .from(conversations)
      .where(and(ilike(conversations.title, pattern), isNull(conversations.deletedAt)))
      .orderBy(desc(conversations.createdAt))
      .limit(limit),
    db
      .select({
        id: memories.id,
        key: memories.key,
        content: memories.content,
        category: memories.category,
        createdAt: memories.createdAt,
      })
      .from(memories)
      .where(or(ilike(memories.key, pattern), ilike(memories.content, pattern)))
      .orderBy(desc(memories.createdAt))
      .limit(limit),
  ]);

  return {
    goals: goalRows,
    tasks: taskRows,
    conversations: conversationRows,
    memories: memoryRows,
  };
}
