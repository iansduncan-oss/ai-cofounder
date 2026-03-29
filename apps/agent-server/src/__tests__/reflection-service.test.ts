import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// ── Mock DB ──

const mockInsertReflection = vi.fn().mockResolvedValue({
  id: "ref-1",
  goalId: "goal-1",
  reflectionType: "goal_completion",
  content: "test reflection",
  lessons: [],
  agentPerformance: {},
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
});

const mockListReflections = vi.fn().mockResolvedValue({ data: [], total: 0 });

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  insertReflection: (...args: unknown[]) => mockInsertReflection(...args),
  listReflections: (...args: unknown[]) => mockListReflections(...args),
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

// ── Mock LLM ──

const mockComplete = vi.fn().mockResolvedValue({
  content: [
    {
      type: "text",
      text: `The goal completed successfully with some issues.

LESSONS:
- lesson: Always validate input before processing | category: technical | confidence: 0.9
- lesson: Coder agent works well for straightforward tasks | category: agent | confidence: 0.8
`,
    },
  ],
  model: "test-model",
  stop_reason: "end_turn",
  usage: { inputTokens: 100, outputTokens: 200 },
  provider: "test",
});

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
  return { LlmRegistry: MockLlmRegistry };
});

// ── Mock RAG ──

const mockIngestText = vi.fn().mockResolvedValue({ chunksCreated: 1, sourceId: "ref-1" });
vi.mock("@ai-cofounder/rag", () => ({
  ingestText: (...args: unknown[]) => mockIngestText(...args),
}));

const { ReflectionService } = await import("../services/reflection.js");

beforeEach(() => {
  vi.clearAllMocks();
  // Reset default mocks
  mockInsertReflection.mockResolvedValue({
    id: "ref-1",
    goalId: "goal-1",
    reflectionType: "goal_completion",
    content: "test reflection",
    lessons: [],
    agentPerformance: {},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe("ReflectionService", () => {
  const db = {} as any;
  const registry = { complete: mockComplete, completeDirect: mockComplete } as any;
  const mockEmbed = vi.fn().mockResolvedValue(new Array(768).fill(0.1));
  const embeddingService = { embed: mockEmbed } as any;

  describe("reflectOnGoal", () => {
    const taskResults = [
      { id: "t-1", title: "Research APIs", agent: "researcher", status: "completed", output: "Found 3 APIs" },
      { id: "t-2", title: "Write code", agent: "coder", status: "completed", output: "Generated module" },
      { id: "t-3", title: "Review code", agent: "reviewer", status: "failed", output: "Timeout error" },
    ];

    it("generates reflection with LLM and stores in DB", async () => {
      const service = new ReflectionService(db, registry, embeddingService);
      const result = await service.reflectOnGoal("goal-1", "Build API", "completed", taskResults);

      expect(result).toBeDefined();
      expect(result.id).toBe("ref-1");
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(mockInsertReflection).toHaveBeenCalledOnce();

      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.goalId).toBe("goal-1");
      expect(insertCall.reflectionType).toBe("goal_completion");
      expect(insertCall.content).toContain("LESSONS:");
    });

    it("embeds reflection content when embedding service is available", async () => {
      const service = new ReflectionService(db, registry, embeddingService);
      await service.reflectOnGoal("goal-1", "Build API", "completed", taskResults);

      expect(mockEmbed).toHaveBeenCalledOnce();
      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.embedding).toHaveLength(768);
    });

    it("works without embedding service", async () => {
      const service = new ReflectionService(db, registry);
      await service.reflectOnGoal("goal-1", "Build API", "completed", taskResults);

      expect(mockInsertReflection).toHaveBeenCalledOnce();
      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.embedding).toBeUndefined();
    });

    it("sets failure_analysis type when all tasks fail", async () => {
      const failedResults = [
        { id: "t-1", title: "Task 1", agent: "coder", status: "failed", output: "Error" },
        { id: "t-2", title: "Task 2", agent: "researcher", status: "failed", output: "Error" },
      ];

      const service = new ReflectionService(db, registry);
      await service.reflectOnGoal("goal-1", "Broken goal", "failed", failedResults);

      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.reflectionType).toBe("failure_analysis");
    });

    it("tracks agent performance stats", async () => {
      const service = new ReflectionService(db, registry);
      await service.reflectOnGoal("goal-1", "Build API", "completed", taskResults);

      const insertCall = mockInsertReflection.mock.calls[0][1];
      const perf = insertCall.agentPerformance;
      expect(perf.researcher.success).toBe(1);
      expect(perf.coder.success).toBe(1);
      expect(perf.reviewer.fail).toBe(1);
      expect(perf.reviewer.insights).toHaveLength(1);
    });

    it("ingests reflection into RAG when embedding service available", async () => {
      const service = new ReflectionService(db, registry, embeddingService);
      await service.reflectOnGoal("goal-1", "Build API", "completed", taskResults);

      expect(mockIngestText).toHaveBeenCalledOnce();
      expect(mockIngestText.mock.calls[0][2]).toBe("reflection");
      expect(mockIngestText.mock.calls[0][3]).toBe("ref-1"); // reflection ID as sourceId
    });

    it("includes goal metadata in reflection", async () => {
      const service = new ReflectionService(db, registry);
      await service.reflectOnGoal("goal-1", "Build API", "completed", taskResults);

      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.metadata.goalTitle).toBe("Build API");
      expect(insertCall.metadata.goalStatus).toBe("completed");
      expect(insertCall.metadata.totalTasks).toBe(3);
      expect(insertCall.metadata.succeededTasks).toBe(2);
      expect(insertCall.metadata.failedTasks).toBe(1);
    });
  });

  describe("extractWeeklyPatterns", () => {
    it("skips when fewer than 3 reflections available", async () => {
      mockListReflections.mockResolvedValue({
        data: [
          { reflectionType: "goal_completion", content: "test", lessons: [], createdAt: new Date() },
        ],
        total: 1,
      });

      const service = new ReflectionService(db, registry);
      const result = await service.extractWeeklyPatterns();

      expect(result).toBeNull();
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it("skips when no recent reflections (older than 7 days)", async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      mockListReflections.mockResolvedValue({
        data: [
          { reflectionType: "goal_completion", content: "test 1", lessons: [], createdAt: oldDate },
          { reflectionType: "goal_completion", content: "test 2", lessons: [], createdAt: oldDate },
          { reflectionType: "goal_completion", content: "test 3", lessons: [], createdAt: oldDate },
        ],
        total: 3,
      });

      const service = new ReflectionService(db, registry);
      const result = await service.extractWeeklyPatterns();

      expect(result).toBeNull();
    });

    it("generates weekly summary from 3+ recent reflections", async () => {
      const now = new Date();
      mockListReflections.mockResolvedValue({
        data: [
          { reflectionType: "goal_completion", content: "Reflection 1", lessons: [{ lesson: "Lesson A" }], agentPerformance: { coder: { success: 2, fail: 0 } }, createdAt: now },
          { reflectionType: "failure_analysis", content: "Reflection 2", lessons: [{ lesson: "Lesson B" }], agentPerformance: { researcher: { success: 1, fail: 1 } }, createdAt: now },
          { reflectionType: "goal_completion", content: "Reflection 3", lessons: [{ lesson: "Lesson C" }], agentPerformance: { coder: { success: 1, fail: 0 } }, createdAt: now },
        ],
        total: 3,
      });

      mockInsertReflection.mockResolvedValue({
        id: "ref-weekly",
        reflectionType: "weekly_summary",
        content: "Weekly patterns...",
        createdAt: now,
        updatedAt: now,
      });

      const service = new ReflectionService(db, registry);
      const result = await service.extractWeeklyPatterns();

      expect(result).toBeDefined();
      expect(result!.id).toBe("ref-weekly");
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(mockInsertReflection).toHaveBeenCalledOnce();

      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.reflectionType).toBe("weekly_summary");
      expect(insertCall.metadata.reflectionCount).toBe(3);
    });

    it("filters out weekly_summary reflections from input", async () => {
      const now = new Date();
      mockListReflections.mockResolvedValue({
        data: [
          { reflectionType: "goal_completion", content: "R1", lessons: [], createdAt: now },
          { reflectionType: "weekly_summary", content: "Old summary", lessons: [], createdAt: now },
          { reflectionType: "goal_completion", content: "R2", lessons: [], createdAt: now },
        ],
        total: 3,
      });

      const service = new ReflectionService(db, registry);
      const result = await service.extractWeeklyPatterns();

      // Only 2 goal reflections (excluding weekly_summary), so should skip
      expect(result).toBeNull();
    });

    it("aggregates agent performance across reflections", async () => {
      const now = new Date();
      mockListReflections.mockResolvedValue({
        data: [
          { reflectionType: "goal_completion", content: "R1", lessons: [], agentPerformance: { coder: { success: 3, fail: 0, insights: [] } }, createdAt: now },
          { reflectionType: "goal_completion", content: "R2", lessons: [], agentPerformance: { coder: { success: 1, fail: 1, insights: [] } }, createdAt: now },
          { reflectionType: "goal_completion", content: "R3", lessons: [], agentPerformance: { researcher: { success: 2, fail: 0, insights: [] } }, createdAt: now },
        ],
        total: 3,
      });

      mockInsertReflection.mockResolvedValue({ id: "ref-w", reflectionType: "weekly_summary", content: "Weekly", createdAt: now, updatedAt: now });

      const service = new ReflectionService(db, registry);
      await service.extractWeeklyPatterns();

      const insertCall = mockInsertReflection.mock.calls[0][1];
      expect(insertCall.agentPerformance.coder.success).toBe(4);
      expect(insertCall.agentPerformance.coder.fail).toBe(1);
      expect(insertCall.agentPerformance.researcher.success).toBe(2);
    });
  });

  describe("parseLessons", () => {
    it("parses structured lessons from text", () => {
      const service = new ReflectionService(db, registry);
      const text = `Some narrative text.

LESSONS:
- lesson: Always validate input | category: technical | confidence: 0.9
- lesson: Coder agent is reliable | category: agent | confidence: 0.85
- lesson: Plan before coding | category: process | confidence: 0.7`;

      const lessons = service.parseLessons(text);
      expect(lessons).toHaveLength(3);
      expect(lessons[0]).toEqual({ lesson: "Always validate input", category: "technical", confidence: 0.9 });
      expect(lessons[1]).toEqual({ lesson: "Coder agent is reliable", category: "agent", confidence: 0.85 });
      expect(lessons[2]).toEqual({ lesson: "Plan before coding", category: "process", confidence: 0.7 });
    });

    it("returns empty array when no lessons found", () => {
      const service = new ReflectionService(db, registry);
      const lessons = service.parseLessons("No lessons here, just text.");
      expect(lessons).toEqual([]);
    });

    it("clamps confidence to 0-1 range", () => {
      const service = new ReflectionService(db, registry);
      const text = "- lesson: Over-confident | category: technical | confidence: 1.5";
      const lessons = service.parseLessons(text);
      expect(lessons[0].confidence).toBe(1);
    });
  });
});
