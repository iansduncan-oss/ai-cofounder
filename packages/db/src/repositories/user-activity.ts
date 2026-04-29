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
  adminUsers,
  conversations,
  googleTokens,
  journalEntries,
  memories,
  messages,
  personas,
  reflections,
  sessionEngagement,
  userActions,
  userPatterns,
  users,
  workSessions,
} from "../schema.js";

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

/* ────────────────── Reflections ──────────────── */

type ReflectionType =
  | "goal_completion"
  | "failure_analysis"
  | "pattern_extraction"
  | "weekly_summary";

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
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.email, email)).limit(1);
  return rows[0] ?? undefined;
}

export async function findAdminById(db: Db, id: string) {
  const rows = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
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
  const rows = await db.select({ count: sql<number>`count(*)::int` }).from(adminUsers);
  return rows[0]?.count ?? 0;
}

export async function listAdminUsers(db: Db) {
  return db
    .select({
      id: adminUsers.id,
      email: adminUsers.email,
      role: adminUsers.role,
      createdAt: adminUsers.createdAt,
    })
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

/* ────────────────── User Actions (Pattern Learning) ─────────────── */

type UserActionType =
  | "chat_message"
  | "goal_created"
  | "deploy_triggered"
  | "suggestion_accepted"
  | "approval_submitted"
  | "schedule_created"
  | "tool_executed";

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
      userId: nullifyEmpty(data.userId),
      workspaceId: nullifyEmpty(data.workspaceId),
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
      and(eq(userActions.userId, userId), sql`${userActions.createdAt} >= ${since.toISOString()}`),
    )
    .orderBy(desc(userActions.createdAt));
}

export async function getRecentUserActionSummary(
  db: Db,
  userId: string,
  since: Date,
  workspaceId?: string,
) {
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
    .where(and(sql`${userActions.createdAt} >= ${since}`, sql`${userActions.userId} IS NOT NULL`));
  return rows.map((r) => r.userId!);
}

export async function getUserActionsForAnalysis(db: Db, userId: string, since: Date) {
  return db
    .select()
    .from(userActions)
    .where(and(eq(userActions.userId, userId), sql`${userActions.createdAt} >= ${since}`))
    .orderBy(asc(userActions.createdAt));
}

/* ────────────────── User Patterns ─────────────── */

export async function deactivateLowConfidencePatterns(db: Db, threshold = 15, minHits = 5) {
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
    or(isNull(userPatterns.expiresAt), sql`${userPatterns.expiresAt} > now()`),
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
  opts?: {
    userId?: string;
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
    workspaceId?: string;
  },
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
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userPatterns)
      .where(where),
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
    totalPatterns > 0 ? patterns.reduce((s, p) => s + p.confidence, 0) / totalPatterns : 0;

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
  const [row] = await db.update(users).set({ timezone }).where(eq(users.id, userId)).returning();
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
  | "goal_started"
  | "goal_completed"
  | "goal_failed"
  | "task_completed"
  | "task_failed"
  | "git_commit"
  | "pr_created"
  | "reflection"
  | "work_session"
  | "subagent_run"
  | "deployment";

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
  const rows = await db.select().from(journalEntries).where(eq(journalEntries.id, id)).limit(1);
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

