import { vi, afterAll, beforeEach } from "vitest";
import { textResponse } from "./mocks/llm.js";
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

// ---------------------------------------------------------------------------
// Queue mock
// ---------------------------------------------------------------------------

export interface MockQueueModule {
  [key: string]: unknown;
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
export function mockQueueModule(): {
  queueModule: MockQueueModule;
  mockEnqueueAgentTask: ReturnType<typeof vi.fn>;
} {
  const mockEnqueueAgentTask = vi.fn().mockResolvedValue("job-abc");
  const mockQueueGetter = () =>
    vi.fn().mockReturnValue({ add: vi.fn(), upsertJobScheduler: vi.fn() });

  return {
    queueModule: {
      RedisPubSub: vi.fn().mockImplementation(() => ({
        subscribe: vi.fn(),
        publish: vi.fn(),
        close: vi.fn(),
      })),
      getRedisConnection: vi.fn().mockReturnValue({}),
      startWorkers: vi.fn(),
      stopWorkers: vi.fn().mockResolvedValue(undefined),
      closeAllQueues: vi.fn().mockResolvedValue(undefined),
      setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
      enqueueAgentTask: (...args: unknown[]) => mockEnqueueAgentTask(...args),
      enqueueRagIngestion: vi.fn().mockResolvedValue(undefined),
      getMonitoringQueue: mockQueueGetter(),
      getNotificationQueue: mockQueueGetter(),
      getAgentTaskQueue: mockQueueGetter(),
      getBriefingQueue: mockQueueGetter(),
      getPipelineQueue: mockQueueGetter(),
      getRagIngestionQueue: mockQueueGetter(),
      getReflectionQueue: mockQueueGetter(),
      getSubagentTaskQueue: mockQueueGetter(),
      getDeployVerificationQueue: mockQueueGetter(),
      getDeadLetterQueue: mockQueueGetter(),
      getMeetingPrepQueue: mockQueueGetter(),
      listDeadLetterJobs: vi.fn().mockResolvedValue([]),
    },
    mockEnqueueAgentTask,
  };
}

// ---------------------------------------------------------------------------
// Sandbox mock
// ---------------------------------------------------------------------------

/**
 * Returns the factory object for vi.mock("@ai-cofounder/sandbox").
 *
 * Usage:
 * ```typescript
 * vi.mock("@ai-cofounder/sandbox", () => mockSandboxModule());
 * ```
 */
export function mockSandboxModule() {
  return {
    createSandboxService: vi.fn().mockReturnValue({ available: false }),
    hashCode: vi.fn().mockReturnValue("hash"),
  };
}

// ---------------------------------------------------------------------------
// createTestApp — builds a test Fastify instance with automatic cleanup
// ---------------------------------------------------------------------------

export interface CreateTestAppOptions {
  /**
   * Extra env overrides applied before building the server.
   * BRIEFING_HOUR defaults to "25" to prevent scheduler from firing.
   */
  envOverrides?: Record<string, string>;
  /**
   * If true, registers beforeEach(() => vi.clearAllMocks()).
   * Default: true.
   */
  clearMocksBeforeEach?: boolean;
}

/**
 * Creates a Fastify app instance for route-level testing with automatic cleanup.
 *
 * Automatically:
 * - Calls `setupTestEnv()` to set ANTHROPIC_API_KEY, DATABASE_URL, NODE_ENV
 * - Registers `afterAll(() => app.close())` for cleanup
 * - Optionally registers `beforeEach(() => vi.clearAllMocks())`
 *
 * **Prerequisites**: The caller MUST have already:
 * 1. Set up vi.mock() calls for `@ai-cofounder/shared`, `@ai-cofounder/db`,
 *    `@ai-cofounder/llm`, and `@ai-cofounder/queue` at module level
 * 2. Dynamically imported buildServer AFTER mocks:
 *    `const { buildServer } = await import("../server.js");`
 *
 * Usage:
 * ```typescript
 * import { mockSharedModule, mockLlmModule, mockDbModule, mockQueueModule,
 *          createMockComplete, createTestApp } from "@ai-cofounder/test-utils";
 *
 * const mockComplete = createMockComplete();
 * vi.mock("@ai-cofounder/shared", () => mockSharedModule());
 * vi.mock("@ai-cofounder/db", () => ({ ...mockDbModule(), getGoal: vi.fn() }));
 * vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));
 * const { queueModule } = mockQueueModule();
 * vi.mock("@ai-cofounder/queue", () => queueModule);
 *
 * const { buildServer } = await import("../server.js");
 * const { app } = await createTestApp(buildServer);
 *
 * describe("my routes", () => {
 *   it("returns 200", async () => {
 *     const res = await app.inject({ method: "GET", url: "/health" });
 *     expect(res.statusCode).toBe(200);
 *   });
 * });
 * ```
 */
export async function createTestApp(
  buildServer: () => {
    app: {
      close: () => Promise<void>;
      ready: () => Promise<void>;
      inject: (opts: unknown) => unknown;
    };
    logger: unknown;
  },
  options: CreateTestAppOptions = {},
) {
  const { envOverrides = {}, clearMocksBeforeEach = true } = options;

  // Ensure standard test env vars are set (idempotent if already set)
  setupTestEnv({
    BRIEFING_HOUR: "25", // Prevent scheduler from consuming mocks by default
    ...envOverrides,
  });

  const { app } = buildServer();

  // Wait for all plugins to finish registering
  await app.ready();

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
 * import { mockSharedModule, mockLlmModule, mockDbModule, mockQueueModule,
 *          createMockComplete, importBuildServer } from "@ai-cofounder/test-utils";
 *
 * const mockComplete = createMockComplete();
 * vi.mock("@ai-cofounder/shared", () => mockSharedModule());
 * vi.mock("@ai-cofounder/db", () => mockDbModule());
 * vi.mock("@ai-cofounder/llm", () => mockLlmModule(mockComplete));
 *
 * const { buildServer } = await importBuildServer(
 *   () => import("../server.js"),
 * );
 *
 * it("my test", async () => {
 *   const { app } = buildServer();
 *   const res = await app.inject({ method: "GET", url: "/health" });
 *   await app.close();
 *   expect(res.statusCode).toBe(200);
 * });
 * ```
 */
export async function importBuildServer(
  importServer: () => Promise<{
    buildServer: (...args: unknown[]) => { app: unknown; logger: unknown };
  }>,
  options: CreateTestAppOptions = {},
) {
  const { envOverrides = {}, clearMocksBeforeEach = true } = options;

  setupTestEnv({
    BRIEFING_HOUR: "25",
    ...envOverrides,
  });

  const { buildServer } = await importServer();

  if (clearMocksBeforeEach) {
    beforeEach(() => {
      vi.clearAllMocks();
    });
  }

  return { buildServer };
}
