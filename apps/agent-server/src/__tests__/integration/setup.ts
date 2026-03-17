/**
 * Global setup/teardown for integration tests.
 *
 * Creates a fresh `ai_cofounder_test` database, pushes the Drizzle schema
 * via `drizzle-kit push`, and enables the pgvector extension.
 * Drops the database on teardown.
 *
 * If Postgres is unreachable, sets __INTEGRATION_SKIP__ so tests skip gracefully.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

const TEST_DB = "ai_cofounder_test";
const PG_USER = process.env.POSTGRES_USER ?? "ai_cofounder";
const PG_PASSWORD = process.env.POSTGRES_PASSWORD ?? "localdev";
const PG_HOST = process.env.POSTGRES_HOST ?? "127.0.0.1";
const PG_PORT = process.env.POSTGRES_PORT ?? "5432";

/** Admin connection string — connects to the default `postgres` database */
function adminUrl(): string {
  return `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/postgres`;
}

/** Test database connection string */
export function testDbUrl(): string {
  return `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB}`;
}

export async function setup(): Promise<void> {
  let adminSql: ReturnType<typeof postgres> | undefined;

  try {
    adminSql = postgres(adminUrl(), { max: 1, connect_timeout: 5 });
    // Quick connectivity check
    await adminSql`SELECT 1`;
  } catch {
    console.warn("[integration] Postgres unavailable — integration tests will be skipped");
    process.env.__INTEGRATION_SKIP__ = "true";
    if (adminSql) await adminSql.end().catch(() => {});
    return;
  }

  try {
    // Terminate existing connections to the test database
    await adminSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${TEST_DB} AND pid <> pg_backend_pid()
    `;

    // Drop and recreate
    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await adminSql.unsafe(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await adminSql.end();
  }

  // Connect to the test database to enable extensions before schema push
  const testSql = postgres(testDbUrl(), { max: 1 });
  try {
    await testSql`CREATE EXTENSION IF NOT EXISTS vector`;
    await testSql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
  } finally {
    await testSql.end();
  }

  // Use drizzle-kit push to apply the current schema directly.
  // This avoids migration ordering issues (the project uses db:push for dev).
  const dbPkgDir = path.resolve(
    import.meta.dirname ?? __dirname,
    "../../../../../packages/db",
  );
  execFileSync("npx", ["drizzle-kit", "push", "--force"], {
    cwd: dbPkgDir,
    env: { ...process.env, DATABASE_URL: testDbUrl() },
    stdio: "pipe",
    timeout: 30_000,
  });

  console.log("[integration] Test database ready");
}

export async function teardown(): Promise<void> {
  if (process.env.__INTEGRATION_SKIP__ === "true") return;

  let adminSql: ReturnType<typeof postgres> | undefined;
  try {
    adminSql = postgres(adminUrl(), { max: 1, connect_timeout: 5 });

    // Terminate connections before dropping
    await adminSql`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = ${TEST_DB} AND pid <> pg_backend_pid()
    `;

    await adminSql.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    console.log("[integration] Test database dropped");
  } catch (err) {
    console.warn("[integration] Failed to drop test database:", err);
  } finally {
    if (adminSql) await adminSql.end().catch(() => {});
  }
}
