import { afterAll } from "vitest";

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

  afterAll(() => {
    restore();
  });

  return restore;
}

/**
 * Flush pending microtasks / fire-and-forget promises.
 * Use instead of `await new Promise(r => setTimeout(r, N))` in tests
 * that need to wait for un-awaited async work to settle.
 */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
