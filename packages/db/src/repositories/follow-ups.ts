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
  briefingCache,
  followUps,
  meetingPreps,
} from "../schema.js";

/* ────────────────── Briefing Cache ─────────────────────── */

export async function getBriefingCache(db: Db, date: string) {
  const rows = await db.select().from(briefingCache).where(eq(briefingCache.date, date)).limit(1);
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
  await db.update(meetingPreps).set({ notified: true }).where(eq(meetingPreps.id, id));
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
      workspaceId: nullifyEmpty(data.workspaceId),
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
  opts?: {
    status?: "pending" | "done" | "dismissed";
    limit?: number;
    offset?: number;
    workspaceId?: string;
  },
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
  const [row] = await db.delete(followUps).where(eq(followUps.id, id)).returning();
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

