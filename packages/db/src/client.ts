import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const sql = postgres(connectionString);
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;

/**
 * Run pending Drizzle migrations.
 * Uses a separate connection with max 1 client to avoid pool conflicts.
 * @param migrationsFolder - absolute path to the drizzle migrations folder
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
): Promise<void> {
  const migrationClient = postgres(connectionString, { max: 1 });
  const db = drizzle(migrationClient);

  await migrate(db, { migrationsFolder });
  await migrationClient.end();
}
