import { afterAll, afterEach, vi } from "vitest";

// Snapshot process.env before any test file mutates it
const envSnapshot = { ...process.env };

// Snapshot globalThis.fetch
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  // Restore process.env to pre-test state
  for (const key of Object.keys(process.env)) {
    if (!(key in envSnapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, envSnapshot);

  // Restore fetch if it was replaced
  if (globalThis.fetch !== originalFetch) {
    globalThis.fetch = originalFetch;
  }
});
