import { eq, and, desc, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { opsAlerts } from "../schema.js";

export async function createOpsAlert(
  db: Db,
  data: {
    source: "alertmanager" | "deploy" | "health" | "manual";
    severity?: string;
    title: string;
    body?: unknown;
  },
) {
  const [row] = await db
    .insert(opsAlerts)
    .values({
      source: data.source,
      severity: data.severity ?? "warning",
      title: data.title,
      body: data.body,
    })
    .returning();
  return row;
}

export async function listOpsAlerts(
  db: Db,
  opts: { status?: string; limit?: number } = {},
) {
  const { status, limit = 50 } = opts;
  const conditions = status
    ? [eq(opsAlerts.status, status as (typeof opsAlerts.$inferSelect)["status"])]
    : [];

  return db
    .select()
    .from(opsAlerts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(opsAlerts.createdAt))
    .limit(limit);
}

export async function updateOpsAlert(
  db: Db,
  id: string,
  data: {
    status?: "unprocessed" | "processing" | "resolved" | "ignored" | "needs-review";
    resolution?: string;
  },
) {
  const [row] = await db
    .update(opsAlerts)
    .set({
      ...data,
      status: data.status as (typeof opsAlerts.$inferSelect)["status"],
      processedAt: data.status === "resolved" || data.status === "ignored" ? new Date() : undefined,
    })
    .where(eq(opsAlerts.id, id))
    .returning();
  return row;
}
