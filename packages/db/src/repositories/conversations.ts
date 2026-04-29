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
  channelConversations,
  conversationSummaries,
  conversations,
  messages,
} from "../schema.js";

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

export async function createConversation(
  db: Db,
  data: { userId: string; workspaceId?: string; title?: string },
) {
  const [conv] = await db
    .insert(conversations)
    .values({ ...data, workspaceId: nullifyEmpty(data.workspaceId) })
    .returning();
  return conv;
}

export async function getConversation(db: Db, id: string, workspaceId?: string) {
  const conditions = [eq(conversations.id, id), isNull(conversations.deletedAt)];
  if (workspaceId) conditions.push(eq(conversations.workspaceId, workspaceId));
  const rows = await db
    .select()
    .from(conversations)
    .where(and(...conditions))
    .limit(1);
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
  const [row] = await db
    .update(conversations)
    .set({ deletedAt: new Date() })
    .where(and(eq(conversations.id, id), isNull(conversations.deletedAt)))
    .returning();
  return row ?? null;
}

export async function restoreConversation(db: Db, id: string) {
  const [row] = await db
    .update(conversations)
    .set({ deletedAt: null })
    .where(eq(conversations.id, id))
    .returning();
  return row ?? null;
}

export async function purgeDeletedConversations(db: Db, olderThan: Date) {
  const rows = await db
    .delete(conversations)
    .where(and(isNotNull(conversations.deletedAt), lte(conversations.deletedAt, olderThan)))
    .returning();
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

export async function getConversationMessages(
  db: Db,
  conversationId: string,
  limit = 50,
  offset = 0,
) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(limit)
    .offset(offset);
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
    .where(sql`${conversationSummaries.createdAt} >= ${since.toISOString()}`)
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

