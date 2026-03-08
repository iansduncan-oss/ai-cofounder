import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  process.env.REDIS_URL = "redis://localhost:6379";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
});

// --- Mock @ai-cofounder/shared ---
const mockRequireEnv = vi.fn((name: string) => {
  const vals: Record<string, string> = {
    REDIS_URL: "redis://localhost:6379",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
  };
  if (vals[name]) return vals[name];
  throw new Error(`Missing required env: ${name}`);
});

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  requireEnv: (...args: unknown[]) => mockRequireEnv(...(args as [string])),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// --- Mock @ai-cofounder/db ---
const mockCreateDb = vi.fn().mockReturnValue({});
const mockRunMigrations = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/db", () => ({
  createDb: (...args: unknown[]) => mockCreateDb(...args),
  runMigrations: (...args: unknown[]) => mockRunMigrations(...args),
}));

// --- Mock @ai-cofounder/queue ---
const mockGetRedisConnection = vi.fn().mockReturnValue({});
const mockStartWorkers = vi.fn();
const mockStopWorkers = vi.fn().mockResolvedValue(undefined);
const mockCloseAllQueues = vi.fn().mockResolvedValue(undefined);

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: (...args: unknown[]) => mockGetRedisConnection(...args),
  startWorkers: (...args: unknown[]) => mockStartWorkers(...args),
  stopWorkers: (...args: unknown[]) => mockStopWorkers(...args),
  closeAllQueues: (...args: unknown[]) => mockCloseAllQueues(...args),
}));

// --- Mock @ai-cofounder/llm ---
vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn();
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    AnthropicProvider: class {},
    GroqProvider: class {},
    OpenRouterProvider: class {},
    GeminiProvider: class {},
    createEmbeddingService: vi.fn(),
  };
});

// --- Mock @ai-cofounder/sandbox ---
const mockCreateSandboxService = vi.fn().mockReturnValue({});
vi.mock("@ai-cofounder/sandbox", () => ({
  createSandboxService: (...args: unknown[]) => mockCreateSandboxService(...args),
}));

// --- Mock ../server.js ---
const mockCreateLlmRegistry = vi.fn().mockReturnValue({
  complete: vi.fn(),
  completeDirect: vi.fn(),
  register: vi.fn(),
  getProvider: vi.fn(),
  resolveProvider: vi.fn(),
  listProviders: vi.fn().mockReturnValue([]),
  getProviderHealth: vi.fn().mockReturnValue([]),
});

vi.mock("../server.js", () => ({
  createLlmRegistry: (...args: unknown[]) => mockCreateLlmRegistry(...args),
}));

// --- Mock ../agents/dispatcher.js ---
const mockRunGoal = vi.fn().mockResolvedValue({ status: "completed" });
const mockGetProgress = vi.fn().mockResolvedValue({});

vi.mock("../agents/dispatcher.js", () => ({
  TaskDispatcher: class {
    runGoal = mockRunGoal;
    getProgress = mockGetProgress;
  },
}));

// --- Mock ../services/verification.js ---
vi.mock("../services/verification.js", () => ({
  VerificationService: class {
    verify = vi.fn().mockResolvedValue({});
  },
}));

// --- Mock ../services/workspace.js ---
const mockCreateWorkspaceService = vi.fn().mockReturnValue({});
vi.mock("../services/workspace.js", () => ({
  createWorkspaceService: (...args: unknown[]) => mockCreateWorkspaceService(...args),
}));

// --- Mock ../services/notifications.js ---
const mockCreateNotificationService = vi.fn().mockReturnValue({});
vi.mock("../services/notifications.js", () => ({
  createNotificationService: (...args: unknown[]) => mockCreateNotificationService(...args),
}));

// Import the main function for direct testing (main() is also called at module level)
// We use dynamic import to control timing after mocks are set up.
// Since main() runs at module load time, we test via the exported `main` function directly.
const { main } = await import("../worker.js");

describe("Worker — QUEUE-03: agentTask processor registration", () => {
  it("registers ONLY the agentTask processor (not monitoring/notification/briefing/pipeline)", async () => {
    // Reset call counts and run main() directly (module-level call already happened)
    vi.clearAllMocks();
    await main();

    expect(mockStartWorkers).toHaveBeenCalledOnce();
    const [processors] = mockStartWorkers.mock.calls[0] as [Record<string, unknown>];

    expect(processors).toHaveProperty("agentTask");
    expect(typeof processors.agentTask).toBe("function");

    // Confirm other processors are NOT registered in this worker
    expect(processors).not.toHaveProperty("monitoring");
    expect(processors).not.toHaveProperty("notification");
    expect(processors).not.toHaveProperty("briefing");
    expect(processors).not.toHaveProperty("pipeline");
  });
});

describe("Worker — QUEUE-03: processor delegates to dispatcher.runGoal", () => {
  it("calls dispatcher.runGoal with goalId and userId from job data", async () => {
    vi.clearAllMocks();
    await main();

    expect(mockStartWorkers).toHaveBeenCalledOnce();
    const [processors] = mockStartWorkers.mock.calls[0] as [Record<string, Function>];
    const agentTaskProcessor = processors.agentTask;

    const fakeJob = {
      id: "job-1",
      data: { goalId: "g-1", userId: "u-1", prompt: "do something" },
    };

    await agentTaskProcessor(fakeJob);

    expect(mockRunGoal).toHaveBeenCalledWith("g-1", "u-1");
  });
});

describe("Worker — QUEUE-03: processor re-throws on dispatcher failure", () => {
  it("re-throws error so BullMQ can handle retries", async () => {
    vi.clearAllMocks();
    const dispatchError = new Error("Agent execution failed");
    mockRunGoal.mockRejectedValueOnce(dispatchError);

    await main();

    const [processors] = mockStartWorkers.mock.calls[0] as [Record<string, Function>];
    const agentTaskProcessor = processors.agentTask;

    const fakeJob = {
      id: "job-2",
      data: { goalId: "g-fail", userId: "u-1", prompt: "fail me" },
    };

    await expect(agentTaskProcessor(fakeJob)).rejects.toThrow("Agent execution failed");
  });
});

describe("Worker — QUEUE-07: SIGTERM handler registered", () => {
  it("registers SIGTERM and SIGINT handlers on process", async () => {
    vi.clearAllMocks();
    const onSpy = vi.spyOn(process, "on");

    await main();

    const sigTermCalls = onSpy.mock.calls.filter(([signal]) => signal === "SIGTERM");
    const sigIntCalls = onSpy.mock.calls.filter(([signal]) => signal === "SIGINT");

    expect(sigTermCalls).toHaveLength(1);
    expect(typeof sigTermCalls[0][1]).toBe("function");

    expect(sigIntCalls).toHaveLength(1);
    expect(typeof sigIntCalls[0][1]).toBe("function");
  });
});

describe("Worker — QUEUE-07: graceful shutdown sequence", () => {
  it("calls stopWorkers then closeAllQueues in order on SIGTERM", async () => {
    vi.clearAllMocks();

    const callOrder: string[] = [];
    mockStopWorkers.mockImplementation(async () => {
      callOrder.push("stopWorkers");
    });
    mockCloseAllQueues.mockImplementation(async () => {
      callOrder.push("closeAllQueues");
    });

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code?: number | string | null) => {
      throw new Error("process.exit called");
    });

    const onSpy = vi.spyOn(process, "on");

    await main();

    const sigTermCalls = onSpy.mock.calls.filter(([signal]) => signal === "SIGTERM");
    expect(sigTermCalls).toHaveLength(1);
    const sigTermHandler = sigTermCalls[0][1] as () => Promise<void>;

    // Trigger SIGTERM handler and expect it to call exit
    await expect(sigTermHandler()).rejects.toThrow("process.exit called");

    expect(callOrder).toEqual(["stopWorkers", "closeAllQueues"]);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

describe("Worker — bootstrap", () => {
  it("connects to Redis and runs DB migrations on startup", async () => {
    vi.clearAllMocks();
    await main();

    expect(mockGetRedisConnection).toHaveBeenCalledWith("redis://localhost:6379");
    expect(mockCreateDb).toHaveBeenCalledWith("postgres://test:test@localhost:5432/test");
    expect(mockRunMigrations).toHaveBeenCalledOnce();
  });

  it("bootstraps all required services", async () => {
    vi.clearAllMocks();
    await main();

    expect(mockCreateLlmRegistry).toHaveBeenCalledOnce();
    expect(mockCreateSandboxService).toHaveBeenCalledOnce();
    expect(mockCreateWorkspaceService).toHaveBeenCalledOnce();
    expect(mockCreateNotificationService).toHaveBeenCalledOnce();
  });
});
