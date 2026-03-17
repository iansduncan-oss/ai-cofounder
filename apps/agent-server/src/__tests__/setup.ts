import { afterAll, afterEach, vi } from "vitest";
import { snapshotEnv } from "@ai-cofounder/test-utils";

const restoreEnv = snapshotEnv();

// Snapshot globalThis.fetch
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  restoreEnv();

  if (globalThis.fetch !== originalFetch) {
    globalThis.fetch = originalFetch;
  }
});
