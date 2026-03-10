import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { mockDbModule } from "@ai-cofounder/test-utils";

beforeAll(() => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
});

// ── Mock DB ──

const mockInsertReflection = vi.fn().mockResolvedValue({ id: "ref-1" });
const mockListReflections = vi.fn().mockResolvedValue({ data: [], total: 0 });
const mockGetUserActionsSince = vi.fn().mockResolvedValue([]);
const mockUpsertUserPattern = vi.fn().mockResolvedValue({ id: "up-1", patternType: "time_preference" });
const mockDeleteOldUserActions = vi.fn().mockResolvedValue(0);

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  insertReflection: (...args: unknown[]) => mockInsertReflection(...args),
  listReflections: (...args: unknown[]) => mockListReflections(...args),
  getUserActionsSince: (...args: unknown[]) => mockGetUserActionsSince(...args),
  upsertUserPattern: (...args: unknown[]) => mockUpsertUserPattern(...args),
  deleteOldUserActions: (...args: unknown[]) => mockDeleteOldUserActions(...args),
  // Expose userActions table for the direct query in analyzeUserPatterns
  userActions: {
    createdAt: "created_at",
  },
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
  // Create a mock db that supports .select().from().where().orderBy() chain
  const createMockDb = (actions: unknown[]) => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue(actions),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue(actions),
          }),
        }),
      }),
    };
    return chain as any;
  };

  const registry = { complete: mockComplete, completeDirect: mockComplete } as any;

  it("returns empty when fewer than 5 actions", async () => {
    const db = createMockDb([
      { actionType: "chat_message", dayOfWeek: 1, hourOfDay: 10, userId: "u1", createdAt: new Date() },
    ]);
    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(result).toEqual([]);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("calls LLM with action summary when enough actions exist", async () => {
    const actions = Array.from({ length: 10 }, (_, i) => ({
      actionType: "chat_message",
      actionDetail: null,
      dayOfWeek: i % 7,
      hourOfDay: 10 + (i % 4),
      userId: "u1",
      createdAt: new Date(),
    }));

    const db = createMockDb(actions);

    mockComplete.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              patternType: "time_preference",
              description: "Active on weekday mornings",
              triggerCondition: { hourRange: [9, 12] },
              suggestedAction: "Check today's goals",
              confidence: 70,
            },
          ]),
        },
      ],
    });

    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(mockComplete).toHaveBeenCalledOnce();
    expect(mockUpsertUserPattern).toHaveBeenCalledOnce();
    expect(mockUpsertUserPattern.mock.calls[0][1]).toMatchObject({
      patternType: "time_preference",
      description: "Active on weekday mornings",
      suggestedAction: "Check today's goals",
      confidence: 70,
    });
    expect(result).toHaveLength(1);
  });

  it("clamps confidence to 0-100 range", async () => {
    const actions = Array.from({ length: 6 }, () => ({
      actionType: "chat_message",
      actionDetail: null,
      dayOfWeek: 1,
      hourOfDay: 10,
      userId: "u1",
      createdAt: new Date(),
    }));

    const db = createMockDb(actions);

    mockComplete.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify([{
          patternType: "recurring_action",
          description: "Over-confident pattern",
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

  it("returns empty array when LLM returns no patterns", async () => {
    const actions = Array.from({ length: 6 }, () => ({
      actionType: "chat_message",
      actionDetail: null,
      dayOfWeek: 3,
      hourOfDay: 14,
      userId: "u1",
      createdAt: new Date(),
    }));

    const db = createMockDb(actions);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });

    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(result).toEqual([]);
    expect(mockUpsertUserPattern).not.toHaveBeenCalled();
  });

  it("cleans up old actions (> 90 days)", async () => {
    const actions = Array.from({ length: 6 }, () => ({
      actionType: "chat_message",
      actionDetail: null,
      dayOfWeek: 1,
      hourOfDay: 10,
      userId: "u1",
      createdAt: new Date(),
    }));

    const db = createMockDb(actions);

    mockComplete.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });

    const service = new ReflectionService(db, registry);
    await service.analyzeUserPatterns();

    expect(mockDeleteOldUserActions).toHaveBeenCalledOnce();
  });

  it("handles multiple patterns from LLM", async () => {
    const actions = Array.from({ length: 10 }, (_, i) => ({
      actionType: i % 2 === 0 ? "chat_message" : "deploy_triggered",
      actionDetail: null,
      dayOfWeek: 5, // Friday
      hourOfDay: 15,
      userId: "u1",
      createdAt: new Date(),
    }));

    const db = createMockDb(actions);

    mockComplete.mockResolvedValue({
      content: [{
        type: "text",
        text: JSON.stringify([
          {
            patternType: "recurring_action",
            description: "Deploys on Fridays around 3 PM",
            triggerCondition: { dayOfWeek: 5, hourRange: [14, 16] },
            suggestedAction: "Run the test suite before deploying",
            confidence: 85,
          },
          {
            patternType: "time_preference",
            description: "Most active on Friday afternoons",
            triggerCondition: { dayOfWeek: 5, hourRange: [13, 17] },
            suggestedAction: "Review pending approvals",
            confidence: 60,
          },
        ]),
      }],
    });

    const service = new ReflectionService(db, registry);
    const result = await service.analyzeUserPatterns();

    expect(result).toHaveLength(2);
    expect(mockUpsertUserPattern).toHaveBeenCalledTimes(2);
  });
});
