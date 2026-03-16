import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// Mock Orchestrator constructor — capture constructor args
const mockOrchestratorRun = vi.fn().mockResolvedValue({
  response: "done",
  usage: { inputTokens: 5, outputTokens: 10 },
});
const MockOrchestrator = vi.fn().mockImplementation(() => ({
  run: mockOrchestratorRun,
}));

vi.mock("../agents/orchestrator.js", () => ({
  Orchestrator: MockOrchestrator,
}));

const mockListDueSchedules = vi.fn().mockResolvedValue([]);
const mockDecayAllMemoryImportance = vi.fn();
const mockGetTodayTokenTotal = vi.fn().mockResolvedValue(0);
const mockGetLatestUserMessageTime = vi.fn().mockResolvedValue(null);
const mockListPendingApprovals = vi.fn().mockResolvedValue([]);
const mockListActiveGoals = vi.fn().mockResolvedValue([]);

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  listDueSchedules: (...args: unknown[]) => mockListDueSchedules(...args),
  decayAllMemoryImportance: (...args: unknown[]) => mockDecayAllMemoryImportance(...args),
  getTodayTokenTotal: (...args: unknown[]) => mockGetTodayTokenTotal(...args),
  getLatestUserMessageTime: (...args: unknown[]) => mockGetLatestUserMessageTime(...args),
  listPendingApprovals: (...args: unknown[]) => mockListPendingApprovals(...args),
  listActiveGoals: (...args: unknown[]) => mockListActiveGoals(...args),
  updateScheduleLastRun: vi.fn(),
  createWorkSession: vi.fn().mockResolvedValue({ id: "ws-1" }),
  completeWorkSession: vi.fn(),
  createConversation: vi.fn().mockResolvedValue({ id: "conv-1" }),
  findOrCreateUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}));

vi.mock("@ai-cofounder/llm", () => {
  const mockComplete = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: "done" }],
    model: "test-model",
    stop_reason: "end_turn",
    usage: { inputTokens: 5, outputTokens: 10 },
    provider: "test",
  });
  class MockLlmRegistry {
    complete = mockComplete;
    completeDirect = mockComplete;
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

// Mock cron-parser
vi.mock("cron-parser", () => ({
  CronExpressionParser: {
    parse: vi.fn().mockReturnValue({
      next: vi.fn().mockReturnValue({ toDate: () => new Date(Date.now() + 60_000) }),
    }),
  },
}));

const { startScheduler } = await import("../services/scheduler.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

const makeDueSchedule = () => ({
  id: "sched-1",
  actionPrompt: "Run a test task",
  cronExpression: "* * * * *",
  description: "Test Schedule",
  nextRunAt: new Date(Date.now() - 1000),
  lastRunAt: null,
});

describe("Scheduler autonomyTierService wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default return values after clearAllMocks
    mockGetTodayTokenTotal.mockResolvedValue(0);
    mockListPendingApprovals.mockResolvedValue([]);
    mockListActiveGoals.mockResolvedValue([]);
    mockGetLatestUserMessageTime.mockResolvedValue(null);
    mockOrchestratorRun.mockResolvedValue({
      response: "done",
      usage: { inputTokens: 5, outputTokens: 10 },
    });
  });

  afterEach(() => {
    MockOrchestrator.mockClear();
  });

  it("passes autonomyTierService to Orchestrator constructor when provided", async () => {
    vi.useFakeTimers();

    const schedule = makeDueSchedule();
    mockListDueSchedules.mockResolvedValueOnce([schedule]);

    const mockAutonomyTierService = {
      getTier: vi.fn(),
      listConfig: vi.fn(),
    };

    const handle = startScheduler({
      db: {} as any,
      llmRegistry: new (LlmRegistry as any)(),
      n8nService: {} as any,
      sandboxService: {} as any,
      workspaceService: {} as any,
      autonomyTierService: mockAutonomyTierService as any,
      pollIntervalMs: 60_000,
      briefingHour: 25, // impossible hour — prevents briefing side-effects
    });

    // Advance enough for the initial async tick to settle (flushes promises/microtasks)
    await vi.advanceTimersByTimeAsync(1000);

    handle.stop();
    vi.useRealTimers();

    expect(MockOrchestrator).toHaveBeenCalled();

    const options = MockOrchestrator.mock.calls[0][0];
    expect(options.autonomyTierService).toBe(mockAutonomyTierService);
  });

  it("passes undefined for autonomyTierService when not provided (backward compatibility)", async () => {
    vi.useFakeTimers();

    const schedule = makeDueSchedule();
    mockListDueSchedules.mockResolvedValueOnce([schedule]);

    const handle = startScheduler({
      db: {} as any,
      llmRegistry: new (LlmRegistry as any)(),
      n8nService: {} as any,
      sandboxService: {} as any,
      workspaceService: {} as any,
      // autonomyTierService not passed
      pollIntervalMs: 60_000,
      briefingHour: 25,
    });

    await vi.advanceTimersByTimeAsync(1000);

    handle.stop();
    vi.useRealTimers();

    expect(MockOrchestrator).toHaveBeenCalled();

    const options = MockOrchestrator.mock.calls[0][0];
    expect(options.autonomyTierService).toBeUndefined();
  });
});
