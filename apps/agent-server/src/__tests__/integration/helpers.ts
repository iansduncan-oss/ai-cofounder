/**
 * Shared utilities for integration tests.
 */
import postgres from "postgres";
import { testDbUrl } from "./setup.js";

const PG_USER = process.env.POSTGRES_USER ?? "ai_cofounder";
const PG_PASSWORD = process.env.POSTGRES_PASSWORD ?? "localdev";
const PG_HOST = process.env.POSTGRES_HOST ?? "127.0.0.1";
const PG_PORT = process.env.POSTGRES_PORT ?? "5432";
const TEST_DB = "ai_cofounder_test";

/** Returns the test database connection string */
export function getTestDbUrl(): string {
  return `postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${TEST_DB}`;
}

/** Returns true if integration tests should be skipped (Postgres unavailable) */
export function shouldSkip(): boolean {
  return process.env.__INTEGRATION_SKIP__ === "true";
}

/**
 * Truncate all public tables except __drizzle_migrations.
 * Uses a raw SQL connection for speed.
 */
export async function truncateAll(sql: ReturnType<typeof postgres>): Promise<void> {
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'
  `;
  if (tables.length === 0) return;

  const tableList = tables.map((t) => `"${t.tablename}"`).join(", ");
  await sql.unsafe(`TRUNCATE ${tableList} CASCADE`);
}

/**
 * Build a real Fastify server backed by the test database.
 *
 * - DATABASE_URL → test DB
 * - REDIS_URL, JWT_SECRET, COOKIE_SECRET → empty (disables queue/auth/ws)
 * - NODE_ENV → test
 * - LlmRegistry → mock (no real LLM calls)
 */
export async function buildIntegrationServer() {
  // Set env vars BEFORE importing server (db plugin reads DATABASE_URL at registration time)
  process.env.DATABASE_URL = getTestDbUrl();
  process.env.REDIS_URL = "";
  process.env.JWT_SECRET = "";
  process.env.COOKIE_SECRET = "";
  process.env.NODE_ENV = "test";
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.API_SECRET = "";

  // Create a mock LlmRegistry with minimum required interface
  const { LlmRegistry } = await import("@ai-cofounder/llm");
  const mockRegistry = new LlmRegistry();

  // Dynamically import buildServer to pick up the env vars
  const { buildServer } = await import("../../server.js");
  const { app } = buildServer(mockRegistry);

  await app.ready();
  return app;
}

/**
 * Seed a test user and conversation in the real database.
 * Returns the IDs for use in test requests.
 */
export async function seedUserAndConversation(app: { db: unknown }) {
  const { findOrCreateUser, createConversation } = await import("@ai-cofounder/db");
  const db = app.db as Parameters<typeof findOrCreateUser>[0];

  const user = await findOrCreateUser(db, "integration-test-user", "test", "Test User");
  const conversation = await createConversation(db, { userId: user.id, title: "Integration Test" });

  return { userId: user.id, conversationId: conversation.id };
}

/** Create a raw postgres.js connection to the test DB for truncation */
export function createTestSql() {
  return postgres(getTestDbUrl(), { max: 2 });
}
