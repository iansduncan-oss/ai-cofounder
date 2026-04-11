import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

// --- Controllable mocks ---
const mockUpdateGoalStatus = vi.fn().mockResolvedValue({});

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  updateGoalStatus: (...args: unknown[]) => mockUpdateGoalStatus(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

vi.mock("@ai-cofounder/llm", () => {
  class MockLlmRegistry {
    complete = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Mock response" }],
      model: "test-model",
      stop_reason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 20 },
      provider: "test",
    });
    completeDirect = vi.fn();
    register = vi.fn();
    getProvider = vi.fn();
    resolveProvider = vi.fn();
    listProviders = vi.fn().mockReturnValue([]);
    getProviderHealth = vi.fn().mockReturnValue([]);
  }
  return {
    LlmRegistry: MockLlmRegistry,
    createEmbeddingService: vi.fn(),
  };
});

vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn(),
  closeAllQueues: vi.fn(),
}));

// --- Mock specialist agents ---
const mockSpecialistExecute = vi.fn().mockResolvedValue({
  output: "Stage completed successfully",
  model: "test-model",
  provider: "test",
  usage: { inputTokens: 10, outputTokens: 20 },
});

vi.mock("../agents/specialists/researcher.js", () => ({
  ResearcherAgent: class {
    execute = mockSpecialistExecute;
  },
}));

vi.mock("../agents/specialists/coder.js", () => ({
  CoderAgent: class {
    execute = mockSpecialistExecute;
  },
}));

vi.mock("../agents/specialists/reviewer.js", () => ({
  ReviewerAgent: class {
    execute = mockSpecialistExecute;
  },
}));

vi.mock("../agents/specialists/planner.js", () => ({
  PlannerAgent: class {
    execute = mockSpecialistExecute;
  },
}));

vi.mock("../agents/specialists/debugger.js", () => ({
  DebuggerAgent: class {
    execute = mockSpecialistExecute;
  },
}));

// Mock OpenTelemetry (used by specialist base class)
vi.mock("@opentelemetry/api", () => ({
  trace: { getTracer: vi.fn().mockReturnValue({ startActiveSpan: vi.fn() }) },
  SpanStatusCode: { ERROR: 2, OK: 0 },
}));

const { PipelineExecutor } = await import("../services/pipeline.js");
const { LlmRegistry } = await import("@ai-cofounder/llm");

function makeJob(stages: Array<{ agent: string; prompt: string; dependsOnPrevious: boolean }>) {
  return {
    pipelineId: "pipe-1",
    goalId: "goal-1",
    currentStage: 0,
    stages,
    context: { templateName: "test-template" } as Record<string, unknown>,
  };
}

describe("PipelineExecutor", () => {
  let executor: InstanceType<typeof PipelineExecutor>;
  const mockNotificationService = { sendBriefing: vi.fn().mockResolvedValue(undefined) };
  const mockJournalService = { writeEntry: vi.fn().mockResolvedValue(undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    const registry = new LlmRegistry();
    executor = new PipelineExecutor(
      registry as never,
      {} as never, // db
      mockNotificationService as never,
      undefined, // embeddingService
      undefined, // sandboxService
      mockJournalService as never,
    );
  });

  it("completes a single-stage pipeline successfully", async () => {
    const job = makeJob([
      { agent: "researcher", prompt: "Research topic", dependsOnPrevious: false },
    ]);

    const result = await executor.execute(job);

    expect(result.status).toBe("completed");
    expect(result.stageResults).toHaveLength(1);
    expect(result.stageResults[0].status).toBe("completed");
    expect(result.stageResults[0].agent).toBe("researcher");
    expect(result.stageResults[0].output).toBe("Stage completed successfully");
  });

  it("runs multi-stage sequential pipeline (each depends on previous)", async () => {
    const job = makeJob([
      { agent: "researcher", prompt: "Research topic", dependsOnPrevious: false },
      { agent: "coder", prompt: "Write code", dependsOnPrevious: true },
      { agent: "reviewer", prompt: "Review code", dependsOnPrevious: true },
    ]);

    const result = await executor.execute(job);

    expect(result.status).toBe("completed");
    expect(result.stageResults).toHaveLength(3);
    expect(result.stageResults.every((r) => r.status === "completed")).toBe(true);
    // Specialist execute should be called once per stage
    expect(mockSpecialistExecute).toHaveBeenCalledTimes(3);
  });

  it("skips remaining stages when a stage fails", async () => {
    // First call succeeds, second call fails, third should be skipped
    mockSpecialistExecute
      .mockResolvedValueOnce({
        output: "Stage 1 done",
        model: "test-model",
        provider: "test",
        usage: { inputTokens: 10, outputTokens: 20 },
      })
      .mockRejectedValueOnce(new Error("LLM call failed"));

    const job = makeJob([
      { agent: "researcher", prompt: "Research", dependsOnPrevious: false },
      { agent: "coder", prompt: "Code", dependsOnPrevious: true },
      { agent: "reviewer", prompt: "Review", dependsOnPrevious: true },
    ]);

    const result = await executor.execute(job);

    expect(result.status).toBe("partial");
    expect(result.stageResults[0].status).toBe("completed");
    expect(result.stageResults[1].status).toBe("failed");
    expect(result.stageResults[1].error).toBe("LLM call failed");
    expect(result.stageResults[2].status).toBe("skipped");
  });

  it("marks goal as completed when all stages succeed", async () => {
    const job = makeJob([
      { agent: "planner", prompt: "Plan work", dependsOnPrevious: false },
      { agent: "coder", prompt: "Implement", dependsOnPrevious: true },
    ]);

    await executor.execute(job);

    // First call sets goal to "active", second call sets it to "completed"
    expect(mockUpdateGoalStatus).toHaveBeenCalledWith({}, "goal-1", "active");
    expect(mockUpdateGoalStatus).toHaveBeenCalledWith({}, "goal-1", "completed");
  });

  it("marks goal as cancelled when no stages complete", async () => {
    mockSpecialistExecute.mockRejectedValue(new Error("All agents down"));

    const job = makeJob([
      { agent: "researcher", prompt: "Research", dependsOnPrevious: false },
      { agent: "coder", prompt: "Code", dependsOnPrevious: true },
    ]);

    await executor.execute(job);

    expect(mockUpdateGoalStatus).toHaveBeenCalledWith({}, "goal-1", "cancelled");
  });

  it("leaves goal as active (partial) when some stages complete", async () => {
    mockSpecialistExecute
      .mockResolvedValueOnce({
        output: "Done",
        model: "test-model",
        provider: "test",
        usage: { inputTokens: 10, outputTokens: 20 },
      })
      .mockRejectedValueOnce(new Error("Stage 2 failed"));

    const job = makeJob([
      { agent: "researcher", prompt: "Research", dependsOnPrevious: false },
      { agent: "coder", prompt: "Code", dependsOnPrevious: true },
    ]);

    const result = await executor.execute(job);

    expect(result.status).toBe("partial");
    // Should NOT be called with "completed" or "cancelled"
    const statusCalls = mockUpdateGoalStatus.mock.calls.map((c) => c[2]);
    expect(statusCalls).toContain("active");
    expect(statusCalls).not.toContain("completed");
    expect(statusCalls).not.toContain("cancelled");
  });

  it("sends notification on pipeline completion", async () => {
    const job = makeJob([{ agent: "researcher", prompt: "Research", dependsOnPrevious: false }]);

    await executor.execute(job);

    expect(mockNotificationService.sendBriefing).toHaveBeenCalledTimes(1);
    expect(mockNotificationService.sendBriefing).toHaveBeenCalledWith(
      expect.stringContaining("pipe-1"),
    );
  });

  it("writes a journal entry on pipeline completion", async () => {
    const job = makeJob([{ agent: "researcher", prompt: "Research", dependsOnPrevious: false }]);

    await executor.execute(job);

    expect(mockJournalService.writeEntry).toHaveBeenCalledTimes(1);
    expect(mockJournalService.writeEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryType: "content_pipeline",
        goalId: "goal-1",
        details: expect.objectContaining({ pipelineId: "pipe-1" }),
      }),
    );
  });

  it("handles unknown agent role gracefully", async () => {
    const job = makeJob([
      { agent: "unknown_agent" as never, prompt: "Do something", dependsOnPrevious: false },
    ]);

    const result = await executor.execute(job);

    expect(result.status).toBe("failed");
    expect(result.stageResults[0].status).toBe("failed");
    expect(result.stageResults[0].error).toContain("No specialist agent for role");
  });

  it("passes previous outputs to dependent stages", async () => {
    const executeCalls: unknown[] = [];
    mockSpecialistExecute.mockImplementation(async (ctx: { previousOutputs?: string[] }) => {
      executeCalls.push(ctx.previousOutputs);
      return {
        output: `Output from stage`,
        model: "test-model",
        provider: "test",
        usage: { inputTokens: 10, outputTokens: 20 },
      };
    });

    const job = makeJob([
      { agent: "researcher", prompt: "Research", dependsOnPrevious: false },
      { agent: "coder", prompt: "Code", dependsOnPrevious: true },
    ]);

    await executor.execute(job);

    // First stage should have no previous outputs (empty array → undefined in context)
    // Second stage should receive the first stage's output
    expect(executeCalls).toHaveLength(2);
    // The second call should have received context with previous outputs
    expect(mockSpecialistExecute).toHaveBeenCalledTimes(2);
    const secondCallCtx = mockSpecialistExecute.mock.calls[1][0];
    expect(secondCallCtx.previousOutputs).toEqual(["Output from stage"]);
  });

  it("works without notification or journal services", async () => {
    const registry = new LlmRegistry();
    const bareExecutor = new PipelineExecutor(registry as never, {} as never);

    const job = makeJob([{ agent: "researcher", prompt: "Research", dependsOnPrevious: false }]);

    const result = await bareExecutor.execute(job);

    expect(result.status).toBe("completed");
    // No errors thrown even without notification/journal services
  });
});
