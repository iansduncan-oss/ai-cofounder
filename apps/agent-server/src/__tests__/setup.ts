import { afterAll, afterEach, vi } from "vitest";
import { snapshotEnv } from "@ai-cofounder/test-utils";
import { _resetSecurityState } from "../plugins/security.js";

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
