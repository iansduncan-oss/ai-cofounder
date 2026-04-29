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
  milestones,
} from "../schema.js";

/* ────────────────────── Milestones ──────────────────────── */

type MilestoneStatus = "planned" | "in_progress" | "completed" | "cancelled";

export async function createMilestone(
  db: Db,
  data: {
    conversationId: string;
    title: string;
    description?: string;
    orderIndex?: number;
    dueDate?: Date;
    createdBy?: string;
  },
) {
  const [milestone] = await db
    .insert(milestones)
    .values({
      conversationId: data.conversationId,
      title: data.title,
      description: data.description,
      orderIndex: data.orderIndex ?? 0,
      dueDate: data.dueDate,
      createdBy: data.createdBy,
    })
    .returning();
  return milestone;
}

export async function getMilestone(db: Db, id: string) {
  const rows = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listMilestonesByConversation(db: Db, conversationId: string) {
  return db
    .select()
    .from(milestones)
    .where(eq(milestones.conversationId, conversationId))
    .orderBy(asc(milestones.orderIndex));
}

export async function updateMilestoneStatus(db: Db, id: string, status: MilestoneStatus) {
  const values: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (status === "completed") values.completedAt = new Date();

  const [updated] = await db
    .update(milestones)
    .set(values)
    .where(eq(milestones.id, id))
    .returning();
  return updated ?? null;
}

export async function getMilestoneProgress(db: Db, milestoneId: string) {
  const milestoneGoals = await db
    .select()
    .from(goals)
    .where(and(eq(goals.milestoneId, milestoneId), isNull(goals.deletedAt)))
    .orderBy(asc(goals.createdAt));

  const total = milestoneGoals.length;
  const completed = milestoneGoals.filter((g) => g.status === "completed").length;
  const active = milestoneGoals.filter((g) => g.status === "active").length;

  return {
    total,
    completed,
    active,
    pending: total - completed - active,
    percentComplete: total > 0 ? Math.round((completed / total) * 100) : 0,
    goals: milestoneGoals,
  };
}

export async function assignGoalToMilestone(db: Db, goalId: string, milestoneId: string) {
  const [updated] = await db
    .update(goals)
    .set({ milestoneId, updatedAt: new Date() })
    .where(and(eq(goals.id, goalId), isNull(goals.deletedAt)))
    .returning();
  return updated ?? null;
}

export async function deleteMilestone(db: Db, id: string) {
  // Unlink non-deleted goals first
  await db
    .update(goals)
    .set({ milestoneId: null })
    .where(and(eq(goals.milestoneId, id), isNull(goals.deletedAt)));
  const [deleted] = await db.delete(milestones).where(eq(milestones.id, id)).returning();
  return deleted ?? null;
}

