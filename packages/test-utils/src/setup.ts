/**
 * Returns a function that restores process.env to the state
 * captured at the time of the call.
 */
export function snapshotEnv(): () => void {
  const snapshot = { ...process.env };
  return () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in snapshot)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, snapshot);
  };
}

/**
 * Sets common test environment variables.
 * Automatically snapshots and restores env in beforeAll/afterAll.
 * Call at module scope (outside describe blocks).
 */
export function setupTestEnv(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    ANTHROPIC_API_KEY: "test-key-not-real",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    NODE_ENV: "test",
  };

  const restore = snapshotEnv();

  Object.assign(process.env, defaults, overrides);

  // If vitest globals are available, register cleanup
  if (typeof afterAll === "function") {
    afterAll(() => {
      restore();
    });
  }

  return restore;
}

// Support vitest globals when available
declare const afterAll: ((fn: () => void) => void) | undefined;
