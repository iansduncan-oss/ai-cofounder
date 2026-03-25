import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// ── Mock DB ──

const mockInsertReflection = vi.fn().mockResolvedValue({ id: "ref-1" });
const mockListReflections = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockGetDistinctActionUserIds = vi.fn().mockResolvedValue([]);
const mockGetUserActionsForAnalysis = vi.fn().mockResolvedValue([]);
const mockUpsertUserPattern = vi.fn().mockResolvedValue({ id: "up-1", patternType: "time_preference" });
const mockDeleteOldUserActions = vi.fn().mockResolvedValue(0);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  insertReflection: (...args: unknown[]) => mockInsertReflection(...args),
  listReflections: (...args: unknown[]) => mockListReflections(...args),
  getDistinctActionUserIds: (...args: unknown[]) => mockGetDistinctActionUserIds(...args),
  getUserActionsForAnalysis: (...args: unknown[]) => mockGetUserActionsForAnalysis(...args),
  upsertUserPattern: (...args: unknown[]) => mockUpsertUserPattern(...args),
  deleteOldUserActions: (...args: unknown[]) => mockDeleteOldUserActions(...args),
}));

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  optionalEnv: (_name: string, defaultValue: string) => defaultValue,
}));

// ── Mock LLM ──

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
  return { LlmRegistry: MockLlmRegistry };
});

vi.mock("@ai-cofounder/rag", () => ({
  ingestText: vi.fn().mockResolvedValue({ chunksCreated: 1, sourceId: "ref-1" }),
}));

const { ReflectionService } = await import("../services/reflection.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ReflectionService.analyzeUserPatterns", () => {
  const db = {} as any;
  const registry = { complete: mockComplete, completeDirect: mockComplete } as any;

  it("returns empty when no users have actions", async () => {
    mockGetDistinctActionUserIds.mockResolvedValueOnce([]);
    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(result).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("skips users with fewer than 5 actions", async () => {
    mockGetDistinctActionUserIds.mockResolvedValueOnce(["user-1"]);
    mockGetUserActionsForAnalysis.mockResolvedValueOnce([
      { actionType: "chat_message", dayOfWeek: 1, hourOfDay: 10, createdAt: new Date() },
    ]);

    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(result).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("passes userId to upsertUserPattern for per-user analysis", async () => {
    mockGetDistinctActionUserIds.mockResolvedValueOnce(["user-1"]);

    const actions = Array.from({ length: 10 }, (_, i) => ({
      actionType: "chat_message",
      actionDetail: null,
      dayOfWeek: i % 7,
      hourOfDay: 10 + (i % 4),
      createdAt: new Date(Date.now() - i * 3600_000),
    }));
    mockGetUserActionsForAnalysis.mockResolvedValueOnce(actions);

    mockComplete.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify([{
          patternType: "time_preference",
          description: "Active on weekday mornings",
          triggerCondition: { hourRange: [9, 12] },
          suggestedAction: "Check today's goals",
          confidence: 70,
        }]),
      }],
    });

    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(mockComplete).toHaveBeenCalledOnce();
    expect(mockUpsertUserPattern).toHaveBeenCalledOnce();
    expect(mockUpsertUserPattern.mock.calls[0][1]).toMatchObject({
      userId: "user-1",
      patternType: "time_preference",
    });
    expect(result).toHaveLength(1);
  });

  it("computes action-pair sequences in the LLM prompt", async () => {
    mockGetDistinctActionUserIds.mockResolvedValueOnce(["user-1"]);

    const now = Date.now();
    const actions = [
      { actionType: "goal_created", actionDetail: null, dayOfWeek: 1, hourOfDay: 10, createdAt: new Date(now) },
      { actionType: "chat_message", actionDetail: null, dayOfWeek: 1, hourOfDay: 10, createdAt: new Date(now + 60_000) },
      { actionType: "deploy_triggered", actionDetail: null, dayOfWeek: 1, hourOfDay: 10, createdAt: new Date(now + 120_000) },
      { actionType: "goal_created", actionDetail: null, dayOfWeek: 1, hourOfDay: 10, createdAt: new Date(now + 180_000) },
      { actionType: "chat_message", actionDetail: null, dayOfWeek: 1, hourOfDay: 10, createdAt: new Date(now + 240_000) },
    ];
    mockGetUserActionsForAnalysis.mockResolvedValueOnce(actions);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });

    const service = new ReflectionService(db, registry);
    await service.analyzeUserPatterns();

    expect(mockComplete).toHaveBeenCalledOnce();
    const prompt = mockComplete.mock.calls[0][1].messages[0].content;
    expect(prompt).toContain("goal_created → chat_message");
  });

  it("clamps confidence to 0-100 range", async () => {
    mockGetDistinctActionUserIds.mockResolvedValueOnce(["user-1"]);

    const actions = Array.from({ length: 6 }, () => ({
      actionType: "chat_message",
      actionDetail: null,
      dayOfWeek: 1,
      hourOfDay: 10,
      createdAt: new Date(),
    }));
    mockGetUserActionsForAnalysis.mockResolvedValueOnce(actions);

    mockComplete.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify([{
          patternType: "recurring_action",
          description: "Over-confident",
          triggerCondition: { dayOfWeek: 1 },
          suggestedAction: "Do something",
          confidence: 150,
        }]),
      }],
    });

    const service = new ReflectionService(db, registry);
    await service.analyzeUserPatterns();

    expect(mockUpsertUserPattern.mock.calls[0][1].confidence).toBe(100);
  });

  it("cleans up old actions once after all users", async () => {
    mockGetDistinctActionUserIds.mockResolvedValueOnce(["user-1"]);
    mockGetUserActionsForAnalysis.mockResolvedValueOnce(
      Array.from({ length: 6 }, () => ({
        actionType: "chat_message",
        actionDetail: null,
        dayOfWeek: 1,
        hourOfDay: 10,
        createdAt: new Date(),
      })),
    );

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });

    const service = new ReflectionService(db, registry);
    await service.analyzeUserPatterns();

    expect(mockDeleteOldUserActions).toHaveBeenCalledOnce();
  });
});
