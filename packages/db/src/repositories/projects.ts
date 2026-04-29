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
  pipelineTemplates,
  projectDependencies,
  registeredProjects,
} from "../schema.js";

/* ──────────────── Registered Projects ──────────────────── */

export async function createRegisteredProject(
  db: Db,
  data: {
    name: string;
    slug: string;
    workspacePath: string;
    repoUrl?: string;
    description?: string;
    language?: "typescript" | "python" | "javascript" | "go" | "other";
    defaultBranch?: string;
    testCommand?: string;
    isActive?: boolean;
    config?: Record<string, unknown>;
    lastIngestedAt?: Date;
  },
) {
  const [project] = await db.insert(registeredProjects).values(data).returning();
  return project;
}

export async function listRegisteredProjects(db: Db) {
  return db
    .select()
    .from(registeredProjects)
    .where(eq(registeredProjects.isActive, true))
    .orderBy(asc(registeredProjects.name));
}

export async function getRegisteredProjectByName(db: Db, name: string) {
  const rows = await db
    .select()
    .from(registeredProjects)
    .where(eq(registeredProjects.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function getRegisteredProjectById(db: Db, id: string) {
  const rows = await db
    .select()
    .from(registeredProjects)
    .where(eq(registeredProjects.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateRegisteredProject(
  db: Db,
  id: string,
  data: Partial<{
    name: string;
    slug: string;
    workspacePath: string;
    repoUrl: string | null;
    description: string | null;
    language: "typescript" | "python" | "javascript" | "go" | "other";
    defaultBranch: string;
    testCommand: string | null;
    isActive: boolean;
    config: Record<string, unknown> | null;
    lastIngestedAt: Date | null;
  }>,
) {
  const [updated] = await db
    .update(registeredProjects)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(registeredProjects.id, id))
    .returning();
  return updated;
}

export async function deleteRegisteredProject(db: Db, id: string) {
  const [updated] = await db
    .update(registeredProjects)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(registeredProjects.id, id))
    .returning();
  return updated;
}

export async function createProjectDependency(
  db: Db,
  data: {
    sourceProjectId: string;
    targetProjectId: string;
    dependencyType: string;
    description?: string;
  },
) {
  const [dep] = await db.insert(projectDependencies).values(data).returning();
  return dep;
}

export async function listProjectDependencies(db: Db, projectId: string) {
  return db
    .select()
    .from(projectDependencies)
    .where(
      or(
        eq(projectDependencies.sourceProjectId, projectId),
        eq(projectDependencies.targetProjectId, projectId),
      ),
    );
}

export async function deleteProjectDependency(db: Db, id: string) {
  const [deleted] = await db
    .delete(projectDependencies)
    .where(eq(projectDependencies.id, id))
    .returning();
  return deleted;
}

/* ────────────────── Pipeline Templates ─────────────────────── */

export async function createPipelineTemplate(
  db: Db,
  data: {
    name: string;
    description?: string;
    stages: unknown;
    defaultContext?: unknown;
    isActive?: boolean;
  },
) {
  const [template] = await db.insert(pipelineTemplates).values(data).returning();
  return template;
}

export async function getPipelineTemplate(db: Db, id: string) {
  const rows = await db
    .select()
    .from(pipelineTemplates)
    .where(eq(pipelineTemplates.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPipelineTemplateByName(db: Db, name: string) {
  const rows = await db
    .select()
    .from(pipelineTemplates)
    .where(eq(pipelineTemplates.name, name))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPipelineTemplates(db: Db, activeOnly = true) {
  const conditions = activeOnly ? [eq(pipelineTemplates.isActive, true)] : [];
  return db
    .select()
    .from(pipelineTemplates)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(pipelineTemplates.name));
}

export async function updatePipelineTemplate(
  db: Db,
  id: string,
  data: Partial<{
    name: string;
    description: string;
    stages: unknown;
    defaultContext: unknown;
    isActive: boolean;
  }>,
) {
  const [updated] = await db
    .update(pipelineTemplates)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(pipelineTemplates.id, id))
    .returning();
  return updated ?? null;
}

export async function deletePipelineTemplate(db: Db, id: string) {
  const result = await db.delete(pipelineTemplates).where(eq(pipelineTemplates.id, id)).returning();
  return result.length > 0;
}

