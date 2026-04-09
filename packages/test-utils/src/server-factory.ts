import { vi, afterAll, beforeEach } from "vitest";
import { mockSharedModule } from "./mocks/shared.js";
import { mockLlmModule, textResponse } from "./mocks/llm.js";
import { mockDbModule } from "./mocks/db.js";
import { setupTestEnv } from "./setup.js";

/**
 * Creates a standard mock complete function with a default "Mock response" return.
 * Returns the mock fn directly so tests can override responses per-test via
 * `mockComplete.mockResolvedValueOnce(...)`.
 *
 * Usage:
 * ```typescript
 * const mockComplete = createMockComplete();
 * vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));
 *
 * it("returns custom response", async () => {
 *   mockComplete.mockResolvedValueOnce(textResponse("custom answer"));
 *   // ... test code
 * });
 * ```
 */
export function createMockComplete() {
  return vi.fn().mockResolvedValue(textResponse("Mock response"));
}

export interface MockQueueModule {
  getRedisConnection: ReturnType<typeof vi.fn>;
  startWorkers: ReturnType<typeof vi.fn>;
  stopWorkers: ReturnType<typeof vi.fn>;
  closeAllQueues: ReturnType<typeof vi.fn>;
  setupRecurringJobs: ReturnType<typeof vi.fn>;
  enqueueAgentTask: ReturnType<typeof vi.fn>;
}

/**
 * Returns the factory object for vi.mock("@ai-cofounder/queue").
 * The enqueueAgentTask mock is returned separately for easy per-test overrides.
 *
 * Usage:
 * ```typescript
 * const { queueModule, mockEnqueueAgentTask } = mockQueueModule();
 * vi.mock("@ai-cofounder/queue", () => queueModule);
 * ```
 */
export function mockQueueModule(): { queueModule: MockQueueModule; mockEnqueueAgentTask: ReturnType<typeof vi.fn> } {
  const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-abc");
  return {
    queueModule: {
      getRedisConnection: vi.fn().mockReturnValue({}),
      startWorkers: vi.fn(),
      stopWorkers: vi.fn().mockResolvedValue(undefined),
      closeAllQueues: vi.fn().mockResolvedValue(undefined),
      setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
      enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
    },
    mockEnqueueAgentTask,
  };
}

export interface SetupServerMocksOptions {
  /**
   * Custom mockComplete function. If not provided, one is created via createMockComplete().
   */
  mockComplete?: ReturnType<typeof vi.fn>;
  /**
   * Additional DB mock overrides. Merged on top of mockDbModule() defaults.
   * Use arrow-fn wrappers for mocks you need to control per-test:
   * `{ getGoal: (...args) => mockGetGoal(...args) }`
   */
  dbOverrides?: Record<string, unknown>;
  /**
   * Additional env var overrides passed to setupTestEnv().
   */
  envOverrides?: Record<string, string>;
  /**
   * If true, also sets up @ai-cofounder/queue mocks. Default: false.
   */
  mockQueue?: boolean;
}

export interface SetupServerMocksResult {
  /** The mockComplete fn controlling LLM responses. */
  mockComplete: ReturnType<typeof vi.fn>;
  /** The full DB mock object (for accessing individual mock fns if needed). */
  dbMock: ReturnType<typeof mockDbModule>;
  /** Queue mock (only present if mockQueue: true). */
  queueMock?: { queueModule: MockQueueModule; mockEnqueueAgentTask: ReturnType<typeof vi.fn> };
}

/**
 * Declaratively sets up all standard vi.mock() calls needed for agent-server
 * route tests. Must be called at the **module level** (top of file, outside
 * describe blocks) because vi.mock is hoisted.
 *
 * IMPORTANT: This function returns the mock references, but the actual
 * vi.mock() calls must still be written by the test author because vitest
 * hoists vi.mock() calls to the top of the file — they can't be called
 * inside a function at runtime.
 *
 * Instead, use this as a recipe reference. The real value is `createTestApp()`
 * below, which handles the dynamic import + build + cleanup pattern.
 *
 * For the vi.mock calls themselves, use the existing helpers directly:
 * - `vi.mock("@ai-cofounder/shared", () => mockSharedModule())`
 * - `vi.mock("@ai-cofounder/db", () => ({ ...mockDbModule(), ...overrides }))`
 * - `vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete))`
 */

export interface CreateTestAppOptions {
  /**
   * Extra env overrides applied before importing the server.
   * Common: `{ BRIEFING_HOUR: "25" }` to prevent scheduler from firing.
   */
  envOverrides?: Record<string, string>;
  /**
   * If true, registers beforeEach(() => vi.clearAllMocks()).
   * Default: true.
   */
  clearMocksBeforeEach?: boolean;
}

/**
 * Creates a Fastify app instance via the agent-server's `buildServer()`,
 * dynamically imported so that vi.mock() calls have already taken effect.
 *
 * Automatically:
 * - Calls `setupTestEnv()` to set ANTHROPIC_API_KEY, DATABASE_URL, NODE_ENV
 * - Registers `afterAll(() => app.close())` for cleanup
 * - Optionally registers `beforeEach(() => vi.clearAllMocks())`
 *
 * **Prerequisites**: The caller MUST have already set up vi.mock() calls for
 * `@ai-cofounder/shared`, `@ai-cofounder/db`, and `@ai-cofounder/llm`
 * before calling this function. Those mocks are hoisted and must be at
 * module level.
 *
 * Usage:
 * ```typescript
 * import { mockSharedModule, mockLlmModule, mockDbModule, createMockComplete, createTestApp } from "@ai-cofounder/test-utils";
 *
 * const mockComplete = createMockComplete();
 * vi.mock("@ai-cofounder/shared", () => mockSharedModule());
 * vi.mock("@ai-cofounder/db", () => ({ ...mockDbModule(), getGoal: vi.fn() }));
 * vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));
 *
 * const { app, buildServer } = await createTestApp();
 *
 * describe("my routes", () => {
 *   it("returns 200", async () => {
 *     const res = await app.inject({ method: "GET", url: "/health" });
 *     expect(res.statusCode).toBe(200);
 *   });
 * });
 * ```
 */
export async function createTestApp(options: CreateTestAppOptions = {}) {
  const { envOverrides = {}, clearMocksBeforeEach = true } = options;

  // Ensure standard test env vars are set (idempotent if already set)
  setupTestEnv({
    BRIEFING_HOUR: "25", // Prevent scheduler from consuming mocks by default
    ...envOverrides,
  });

  // Dynamic import so vi.mock() hoisting has already taken effect
  const { buildServer } = await import("../../../apps/agent-server/src/server.js");
  const { app } = buildServer();

  afterAll(async () => {
    await app.close();
  });

  if (clearMocksBeforeEach) {
    beforeEach(() => {
      vi.clearAllMocks();
    });
  }

  return { app, buildServer };
}

/**
 * Like createTestApp, but returns only buildServer so each test can create
 * its own app instance. Useful for tests that need a fresh server per test
 * (e.g., security tests).
 *
 * The caller is responsible for calling `await app.close()` after each test.
 *
 * Usage:
 * ```typescript
 * const { buildServer } = await importBuildServer();
 *
 * it("my test", async () => {
 *   const { app } = buildServer();
 *   const res = await app.inject({ method: "GET", url: "/health" });
 *   await app.close();
 *   expect(res.statusCode).toBe(200);
 * });
 * ```
 */
export async function importBuildServer(options: CreateTestAppOptions = {}) {
  const { envOverrides = {}, clearMocksBeforeEach = true } = options;

  setupTestEnv({
    BRIEFING_HOUR: "25",
    ...envOverrides,
  });

  const { buildServer } = await import("../../../apps/agent-server/src/server.js");

  if (clearMocksBeforeEach) {
    beforeEach(() => {
      vi.clearAllMocks();
    });
  }

  return { buildServer };
}
