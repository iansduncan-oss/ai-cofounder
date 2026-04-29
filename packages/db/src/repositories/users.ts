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
  users,
} from "../schema.js";

/* ────────────────────────── Users ────────────────────────── */

export async function findOrCreateUser(
  db: Db,
  externalId: string,
  platform: string,
  displayName?: string,
) {
  const existing = await db.select().from(users).where(eq(users.externalId, externalId)).limit(1);

  if (existing.length > 0) return existing[0];

  const [created] = await db
    .insert(users)
    .values({ externalId, platform, displayName })
    .returning();
  return created;
}

export async function findUserByPlatform(db: Db, platform: string, externalId: string) {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.platform, platform), eq(users.externalId, externalId)))
    .limit(1);
  return rows[0] ?? null;
}

