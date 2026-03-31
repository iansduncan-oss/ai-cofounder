import { eq, and, desc } from "drizzle-orm";
import type { Db } from "../client.js";
import { workspaces } from "../schema.js";

export async function createWorkspace(
  db: Db,
  data: { name: string; slug: string; ownerId: string; isDefault?: boolean; metadata?: Record<string, unknown> },
) {
  const [row] = await db.insert(workspaces).values(data).returning();
  return row;
}

export async function getWorkspace(db: Db, id: string) {
  const rows = await db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getWorkspaceBySlug(db: Db, slug: string) {
  const rows = await db.select().from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function listWorkspacesByOwner(db: Db, ownerId: string) {
  return db
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerId, ownerId))
    .orderBy(desc(workspaces.createdAt));
}

export async function getDefaultWorkspace(db: Db, ownerId: string) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.ownerId, ownerId), eq(workspaces.isDefault, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getSystemDefaultWorkspace(db: Db) {
  const rows = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.isDefault, true))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateWorkspace(
  db: Db,
  id: string,
  data: { name?: string; slug?: string; metadata?: Record<string, unknown> },
) {
  const [row] = await db
    .update(workspaces)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return row ?? null;
}

export async function deleteWorkspace(db: Db, id: string) {
  const [row] = await db.delete(workspaces).where(eq(workspaces.id, id)).returning();
  return row ?? null;
}

export async function ensureDefaultWorkspace(db: Db, ownerId: string) {
  const existing = await getDefaultWorkspace(db, ownerId);
  if (existing) return existing;
  return createWorkspace(db, { name: "Default", slug: "default", ownerId, isDefault: true });
}
