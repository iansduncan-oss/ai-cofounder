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
  agentMessages,
  messages,
  subagentRuns,
} from "../schema.js";

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
  const rows = await db.select().from(subagentRuns).where(eq(subagentRuns.id, id)).limit(1);
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
  if (opts?.status)
    conditions.push(
      eq(
        subagentRuns.status,
        opts.status as "queued" | "running" | "completed" | "failed" | "cancelled",
      ),
    );
  if (opts?.parentRequestId)
    conditions.push(eq(subagentRuns.parentRequestId, opts.parentRequestId));

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
      senderRole: data.senderRole as
        | "orchestrator"
        | "researcher"
        | "coder"
        | "reviewer"
        | "planner"
        | "debugger"
        | "doc_writer"
        | "verifier"
        | "subagent",
      senderRunId: data.senderRunId,
      targetRole: data.targetRole as
        | "orchestrator"
        | "researcher"
        | "coder"
        | "reviewer"
        | "planner"
        | "debugger"
        | "doc_writer"
        | "verifier"
        | "subagent"
        | undefined,
      targetRunId: data.targetRunId,
      channel: data.channel,
      messageType: data.messageType as
        | "request"
        | "response"
        | "broadcast"
        | "notification"
        | "handoff",
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
  if (opts.targetRole)
    conditions.push(
      eq(
        agentMessages.targetRole,
        opts.targetRole as
          | "orchestrator"
          | "researcher"
          | "coder"
          | "reviewer"
          | "planner"
          | "debugger"
          | "doc_writer"
          | "verifier"
          | "subagent",
      ),
    );
  if (opts.targetRunId) conditions.push(eq(agentMessages.targetRunId, opts.targetRunId));
  if (opts.status)
    conditions.push(
      eq(agentMessages.status, opts.status as "pending" | "delivered" | "read" | "expired"),
    );
  if (opts.messageType)
    conditions.push(
      eq(
        agentMessages.messageType,
        opts.messageType as "request" | "response" | "broadcast" | "notification" | "handoff",
      ),
    );
  if (opts.senderRole)
    conditions.push(
      eq(
        agentMessages.senderRole,
        opts.senderRole as
          | "orchestrator"
          | "researcher"
          | "coder"
          | "reviewer"
          | "planner"
          | "debugger"
          | "doc_writer"
          | "verifier"
          | "subagent",
      ),
    );
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
    .where(and(eq(agentMessages.status, "pending"), lte(agentMessages.expiresAt, now)))
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
  if (opts?.role)
    conditions.push(
      or(
        eq(
          agentMessages.senderRole,
          opts.role as
            | "orchestrator"
            | "researcher"
            | "coder"
            | "reviewer"
            | "planner"
            | "debugger"
            | "doc_writer"
            | "verifier"
            | "subagent",
        ),
        eq(
          agentMessages.targetRole,
          opts.role as
            | "orchestrator"
            | "researcher"
            | "coder"
            | "reviewer"
            | "planner"
            | "debugger"
            | "doc_writer"
            | "verifier"
            | "subagent",
        ),
      ),
    );
  if (opts?.messageType)
    conditions.push(
      eq(
        agentMessages.messageType,
        opts.messageType as "request" | "response" | "broadcast" | "notification" | "handoff",
      ),
    );
  if (opts?.status)
    conditions.push(
      eq(agentMessages.status, opts.status as "pending" | "delivered" | "read" | "expired"),
    );

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
  const rows = await db.select().from(agentMessages).where(eq(agentMessages.id, id)).limit(1);
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

