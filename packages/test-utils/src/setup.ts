/**
 * Sets common test environment variables.
 * Call in beforeAll() before any dynamic imports.
 */
export function setupTestEnv(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    ANTHROPIC_API_KEY: "test-key-not-real",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    NODE_ENV: "test",
  };
  Object.assign(process.env, defaults, overrides);
}
