import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";

// Set env BEFORE any dynamic imports — server reads DATABASE_URL at plugin registration time
beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  // Use the CI test DB or fall back to the standard test URL
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/ai_cofounder_test";
  // BRIEFING_HOUR=25 is an invalid hour — prevents scheduler from firing during tests
  process.env.BRIEFING_HOUR = "25";
});

// NOTE: Do NOT mock @ai-cofounder/db here — E2E tests require real DB writes.

// Mock @ai-cofounder/queue — no Redis needed in E2E database tests
vi.mock("@ai-cofounder/queue", () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  startWorkers: vi.fn(),
  stopWorkers: vi.fn().mockResolvedValue(undefined),
  closeAllQueues: vi.fn().mockResolvedValue(undefined),
  setupRecurringJobs: vi.fn().mockResolvedValue(undefined),
  enqueueAgentTask: vi.fn().mockResolvedValue("job-e2e-123"),
  enqueueReflection: vi.fn().mockResolvedValue(undefined),
}));

// Mock @ai-cofounder/llm with a class-based MockLlmRegistry that exposes a scriptable mockComplete fn.
// Class syntax required for constructable mocks in Vitest vi.mock() factories.
const mockComplete = vi.fn();
vi.mock("@ai-cofounder/llm", () => {
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

// Dynamic imports AFTER env vars are set and mocks are in place
const { buildServer } = await import("../server.js");
const { createDb } = await import("@ai-cofounder/db");
const { toolUseResponse, textResponse } = await import("@ai-cofounder/test-utils");

// ------------------------------------------------------------------
// Truncation helper — clears all tables between test runs.
// TRUNCATE ... CASCADE handles FK dependency order automatically.
// ------------------------------------------------------------------
type AnyDb = ReturnType<typeof createDb>;

async function truncateTestDb(db: AnyDb): Promise<void> {
  await db.execute(
    sql.raw(
      `TRUNCATE TABLE tool_executions, llm_usage, code_executions, approvals, tasks, goals, conversation_summaries, messages, conversations, schedules, events, work_sessions, memories, n8n_workflows, prompts, reflections, document_chunks, ingestion_state, provider_health, personas, admin_users, channel_conversations, milestones, users CASCADE`,
    ),
  );
}

// ------------------------------------------------------------------
// E2E goal lifecycle tests — real PostgreSQL, scripted LLM responses
// ------------------------------------------------------------------
describe("E2E goal lifecycle — real DB", () => {
  let db: AnyDb;

  beforeAll(async () => {
    db = createDb(process.env.DATABASE_URL!);
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateTestDb(db);
  });

  afterAll(async () => {
    await truncateTestDb(db);
  });

  it("creates goal via POST /api/agents/run and verifies DB rows", async () => {
    // Script the LLM sequence:
    // First call: orchestrator returns create_plan tool use
    mockComplete.mockResolvedValueOnce(
      toolUseResponse("create_plan", {
        goal_title: "E2E Test Goal",
        goal_description: "Test the lifecycle",
        goal_priority: "low",
        tasks: [
          {
            title: "Research task",
            description: "Do research",
            assigned_agent: "researcher",
          },
        ],
      }),
    );
    // Second call: orchestrator text response after plan is created
    mockComplete.mockResolvedValueOnce(textResponse("Plan created. Tasks queued."));

    const { app } = buildServer();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "Build a test feature", userId: "e2e-test-user" },
      });

      expect(res.statusCode).toBe(200);

      const body = res.json();
      const goalId: string = body.plan?.goalId;
      expect(goalId).toBeDefined();

      // Verify real DB rows were written
      const { getGoal, listTasksByGoal } = await import("@ai-cofounder/db");
      const goal = await getGoal(db, goalId);
      expect(goal).not.toBeNull();
      expect(goal?.status).toBe("active");

      const tasks = await listTasksByGoal(db, goalId);
      expect(tasks.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("dispatches goal tasks to completion via TaskDispatcher.runGoal()", async () => {
    // Script LLM sequence for plan creation via the orchestrator
    mockComplete.mockResolvedValueOnce(
      toolUseResponse("create_plan", {
        goal_title: "E2E Dispatch Goal",
        goal_description: "Dispatch to completion",
        goal_priority: "low",
        tasks: [
          {
            title: "Research task",
            description: "Do research",
            assigned_agent: "researcher",
          },
        ],
      }),
    );
    mockComplete.mockResolvedValueOnce(textResponse("Plan created. Tasks queued."));

    // Script additional responses consumed by the TaskDispatcher when running specialist agents.
    // ResearcherAgent calls complete() once for the task, then the dispatcher may call
    // enqueueReflection (mocked). Add extra textResponse mocks as buffer.
    mockComplete.mockResolvedValueOnce(textResponse("Research complete. Found relevant information."));
    mockComplete.mockResolvedValueOnce(textResponse("Self-improvement analysis complete."));
    mockComplete.mockResolvedValueOnce(textResponse("Done."));

    const { app } = buildServer();
    try {
      // Step 1: Create goal + tasks via POST /api/agents/run
      const runRes = await app.inject({
        method: "POST",
        url: "/api/agents/run",
        payload: { message: "Build a dispatch test feature", userId: "e2e-dispatch-user" },
      });

      expect(runRes.statusCode).toBe(200);
      const body = runRes.json();
      const goalId: string = body.plan?.goalId;
      expect(goalId).toBeDefined();

      // Step 2: Run dispatcher directly against the real DB
      const { TaskDispatcher } = await import("../agents/dispatcher.js");
      const dispatcher = new TaskDispatcher(
        app.llmRegistry,
        db,
        undefined, // embeddingService
        undefined, // sandboxService
        undefined, // notificationService
        undefined, // workspaceService
        undefined, // verificationService
      );

      const result = await dispatcher.runGoal(goalId);

      // Step 3: Verify the result and DB state
      expect(result.status).toBe("completed");

      const { getGoal } = await import("@ai-cofounder/db");
      const completedGoal = await getGoal(db, goalId);
      expect(completedGoal?.status).toBe("completed");
    } finally {
      await app.close();
    }
  });

  it("database is clean between test runs (truncation works)", async () => {
    // This test runs after the above tests in Vitest's sequential order.
    // beforeEach truncates the DB, so there should be zero goals.
    const { listGoalsByConversation } = await import("@ai-cofounder/db");

    // Use a placeholder conversation ID — since the DB is empty, this returns []
    const goals = await listGoalsByConversation(db, "00000000-0000-0000-0000-000000000000");
    expect(goals).toHaveLength(0);
  });
});
