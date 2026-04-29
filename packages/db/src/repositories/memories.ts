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
  episodicMemories,
  goals,
  memories,
  proceduralMemories,
  users,
} from "../schema.js";

/* ────────────────────── Memories ─────────────────────────── */

export type MemoryCategory =
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
      workspaceId: nullifyEmpty(data.workspaceId),
      importance,
      ...(rawRole ? { agentRole: rawRole as (typeof memories.agentRole.enumValues)[number] } : {}),
    })
    .returning();
  return created;
}

export async function recallMemories(
  db: Db,
  userId: string,
  options?: {
    category?: string;
    query?: string;
    limit?: number;
    agentRole?: string;
    scope?: "own" | "all";
  },
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

export async function countMemoriesByUser(
  db: Db,
  userId: string,
  workspaceId?: string,
): Promise<number> {
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
  await db.update(memories).set({ archivedAt: new Date() }).where(eq(memories.id, id));
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

