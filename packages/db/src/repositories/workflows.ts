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
  n8nWorkflows,
  prompts,
} from "../schema.js";

/* ────────────────────── Prompts ─────────────────────────── */

export async function getActivePrompt(db: Db, name: string) {
  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.name, name), eq(prompts.isActive, true)))
    .orderBy(desc(prompts.version))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPromptVersion(db: Db, name: string, version: number) {
  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.name, name), eq(prompts.version, version)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPromptVersions(db: Db, name: string) {
  return db.select().from(prompts).where(eq(prompts.name, name)).orderBy(desc(prompts.version));
}

export async function createPromptVersion(
  db: Db,
  data: { name: string; content: string; metadata?: Record<string, unknown> },
) {
  // Get the highest version number for this prompt name
  const existing = await db
    .select({ version: prompts.version })
    .from(prompts)
    .where(eq(prompts.name, data.name))
    .orderBy(desc(prompts.version))
    .limit(1);

  const nextVersion = existing.length > 0 ? existing[0].version + 1 : 1;

  // Deactivate previous versions
  await db.update(prompts).set({ isActive: false }).where(eq(prompts.name, data.name));

  // Insert new active version
  const [created] = await db
    .insert(prompts)
    .values({
      name: data.name,
      version: nextVersion,
      content: data.content,
      isActive: true,
      metadata: data.metadata,
    })
    .returning();
  return created;
}

/* ────────────────── n8n Workflows ─────────────────────── */

type WorkflowDirection = "inbound" | "outbound" | "both";

export async function createN8nWorkflow(
  db: Db,
  data: {
    name: string;
    description?: string;
    webhookUrl: string;
    direction?: WorkflowDirection;
    eventType?: string;
    inputSchema?: Record<string, unknown>;
    isActive?: boolean;
    metadata?: Record<string, unknown>;
  },
) {
  const [workflow] = await db.insert(n8nWorkflows).values(data).returning();
  return workflow;
}

export async function updateN8nWorkflow(
  db: Db,
  id: string,
  data: Partial<{
    name: string;
    description: string;
    webhookUrl: string;
    direction: WorkflowDirection;
    eventType: string;
    inputSchema: Record<string, unknown>;
    isActive: boolean;
    metadata: Record<string, unknown>;
  }>,
) {
  const [updated] = await db
    .update(n8nWorkflows)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(n8nWorkflows.id, id))
    .returning();
  return updated ?? null;
}

export async function getN8nWorkflow(db: Db, id: string) {
  const rows = await db.select().from(n8nWorkflows).where(eq(n8nWorkflows.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getN8nWorkflowByName(db: Db, name: string) {
  const rows = await db
    .select()
    .from(n8nWorkflows)
    .where(and(eq(n8nWorkflows.name, name), eq(n8nWorkflows.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listN8nWorkflows(db: Db, direction?: WorkflowDirection) {
  const conditions = [eq(n8nWorkflows.isActive, true)];
  if (direction) {
    conditions.push(or(eq(n8nWorkflows.direction, direction), eq(n8nWorkflows.direction, "both"))!);
  }
  return db
    .select()
    .from(n8nWorkflows)
    .where(and(...conditions))
    .orderBy(asc(n8nWorkflows.name));
}

export async function findN8nWorkflowByEvent(db: Db, eventType: string) {
  const rows = await db
    .select()
    .from(n8nWorkflows)
    .where(and(eq(n8nWorkflows.eventType, eventType), eq(n8nWorkflows.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteN8nWorkflow(db: Db, id: string) {
  const [deleted] = await db.delete(n8nWorkflows).where(eq(n8nWorkflows.id, id)).returning();
  return deleted ?? null;
}

