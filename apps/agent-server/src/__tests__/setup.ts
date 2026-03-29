import { afterAll, afterEach, vi } from "vitest";
import { snapshotEnv } from "@ai-cofounder/test-utils";
import { _resetSecurityState } from "../plugins/security.js";

// Many test files share a vitest worker process. Dependencies (postgres.js, ioredis, etc.)
// register process.on("exit") cleanup handlers that accumulate across files, exceeding the
// default limit of 10. This is expected behavior, not a leak.
process.setMaxListeners(0);

const restoreEnv = snapshotEnv();

// Snapshot globalThis.fetch
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.clearAllMocks();
  _resetSecurityState();
});

afterAll(() => {
  restoreEnv();

  if (globalThis.fetch !== originalFetch) {
    globalThis.fetch = originalFetch;
  }
});
