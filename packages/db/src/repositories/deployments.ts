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
  approvals,
  deployCircuitBreaker,
  deployments,
  toolTierConfig,
} from "../schema.js";

/* ────────────────── Deployments ─────────────── */

export async function createDeployment(
  db: Db,
  data: {
    commitSha: string;
    shortSha: string;
    branch?: string;
    services?: string[];
    previousSha?: string;
    triggeredBy?: string;
  },
) {
  const [row] = await db
    .insert(deployments)
    .values({
      commitSha: data.commitSha,
      shortSha: data.shortSha,
      branch: data.branch ?? "main",
      services: data.services,
      previousSha: data.previousSha,
      triggeredBy: data.triggeredBy ?? "ci",
    })
    .returning();
  return row;
}

export async function updateDeploymentStatus(
  db: Db,
  id: string,
  data: {
    status: string;
    healthChecks?: unknown;
    errorLog?: string;
    rootCauseAnalysis?: string;
    rolledBack?: boolean;
    rollbackSha?: string;
    completedAt?: Date;
  },
) {
  const [row] = await db
    .update(deployments)
    .set({
      status: data.status as (typeof deployments.$inferSelect)["status"],
      healthChecks: data.healthChecks,
      errorLog: data.errorLog,
      rootCauseAnalysis: data.rootCauseAnalysis,
      rolledBack: data.rolledBack,
      rollbackSha: data.rollbackSha,
      completedAt: data.completedAt,
    })
    .where(eq(deployments.id, id))
    .returning();
  return row;
}

export async function getLatestDeployment(db: Db) {
  const rows = await db.select().from(deployments).orderBy(desc(deployments.startedAt)).limit(1);
  return rows[0] ?? null;
}

export async function listDeployments(db: Db, opts: { limit?: number; offset?: number } = {}) {
  const { limit = 20, offset = 0 } = opts;
  const [data, countResult] = await Promise.all([
    db.select().from(deployments).orderBy(desc(deployments.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(deployments),
  ]);
  return { data, total: countResult[0]?.count ?? 0 };
}

export async function getDeploymentBySha(db: Db, commitSha: string) {
  const rows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.commitSha, commitSha))
    .orderBy(desc(deployments.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

/* ────────────────── Tool Tier Config ─────────────── */

export async function listToolTierConfigs(db: Db) {
  return db.select().from(toolTierConfig).orderBy(asc(toolTierConfig.toolName));
}

export async function getToolTierConfig(db: Db, toolName: string) {
  const rows = await db
    .select()
    .from(toolTierConfig)
    .where(eq(toolTierConfig.toolName, toolName))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertToolTierConfig(
  db: Db,
  data: {
    toolName: string;
    tier: "green" | "yellow" | "red";
    timeoutMs?: number;
    updatedBy?: string;
  },
) {
  const [row] = await db
    .insert(toolTierConfig)
    .values({
      toolName: data.toolName,
      tier: data.tier,
      timeoutMs: data.timeoutMs ?? 300000,
      updatedBy: data.updatedBy,
    })
    .onConflictDoUpdate({
      target: toolTierConfig.toolName,
      set: {
        tier: data.tier,
        timeoutMs: data.timeoutMs ?? 300000,
        updatedBy: data.updatedBy,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function listExpiredPendingApprovals(db: Db) {
  // Returns approvals that have been pending for more than 300 seconds (default timeout)
  // The per-tool timeout sweep in Plan 02 will refine this with per-tool values
  return db
    .select()
    .from(approvals)
    .where(
      and(
        eq(approvals.status, "pending"),
        sql`${approvals.createdAt} < (now() - interval '300 seconds')`,
      ),
    )
    .orderBy(asc(approvals.createdAt));
}

/* ────────────────── Deploy Circuit Breaker ─────────────── */

export async function getDeployCircuitBreaker(db: Db) {
  const rows = await db.select().from(deployCircuitBreaker).limit(1);
  return rows[0] ?? null;
}

export async function upsertDeployCircuitBreaker(
  db: Db,
  data: {
    isPaused: boolean;
    pausedAt?: Date | null;
    pausedReason?: string | null;
    failureCount: number;
    failureWindowStart?: Date | null;
    resumedAt?: Date | null;
    resumedBy?: string | null;
  },
) {
  const existing = await getDeployCircuitBreaker(db);
  if (existing) {
    const [row] = await db
      .update(deployCircuitBreaker)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(deployCircuitBreaker.id, existing.id))
      .returning();
    return row;
  }
  const [row] = await db.insert(deployCircuitBreaker).values(data).returning();
  return row;
}

export async function resetCircuitBreaker(db: Db, resumedBy?: string) {
  const existing = await getDeployCircuitBreaker(db);
  if (!existing) return null;
  const [row] = await db
    .update(deployCircuitBreaker)
    .set({
      isPaused: false,
      pausedAt: null,
      pausedReason: null,
      failureCount: 0,
      failureWindowStart: null,
      resumedAt: new Date(),
      resumedBy: resumedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(deployCircuitBreaker.id, existing.id))
    .returning();
  return row;
}

export async function getRecentFailedDeployments(db: Db, windowHours: number) {
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        or(eq(deployments.status, "failed"), eq(deployments.status, "rolled_back")),
        sql`${deployments.startedAt} >= ${since}`,
      ),
    )
    .orderBy(desc(deployments.startedAt));
  return rows;
}

export async function updateDeploymentSoakStatus(
  db: Db,
  id: string,
  data: {
    soakStatus?: string;
    soakStartedAt?: Date;
    soakCompletedAt?: Date;
    soakMetrics?: unknown;
    remediationActions?: unknown;
    gitDiffSummary?: string;
  },
) {
  const [row] = await db.update(deployments).set(data).where(eq(deployments.id, id)).returning();
  return row;
}

