import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { appSettings } from "../schema.js";

/**
 * Retrieve a single app setting by key.
 * Returns null if not found.
 */
export async function getAppSetting(db: Db, key: string): Promise<string | null> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

/**
 * Insert or update an app setting.
 */
export async function upsertAppSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

/**
 * Convenience wrapper: returns the admin user ID used by background jobs.
 */
export async function getPrimaryAdminUserId(db: Db): Promise<string | null> {
  return getAppSetting(db, "primary_admin_user_id");
}

/**
 * Return all app settings as a key-value map.
 */
export async function getAllAppSettings(db: Db): Promise<Record<string, string>> {
  const rows = await db.select().from(appSettings);
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}
