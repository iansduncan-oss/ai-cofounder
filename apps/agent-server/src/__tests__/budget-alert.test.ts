import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @ai-cofounder/shared before any imports ──
let mockDailyBudget = "0";
let mockWeeklyBudget = "0";

vi.mock("@ai-cofounder/shared", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
  optionalEnv: (name: string, defaultValue: string) => {
    if (name === "DAILY_BUDGET_USD") return mockDailyBudget;
    if (name === "WEEKLY_BUDGET_USD") return mockWeeklyBudget;
    return defaultValue;
  },
}));

// ── Mock @ai-cofounder/db ──
import { mockDbModule } from "@ai-cofounder/test-utils";

const mockGetUsageSummary = vi.fn();
const mockGetCostByDay = vi.fn();

vi.mock("@ai-cofounder/db", () => ({
  ...mockDbModule(),
  getUsageSummary: (...args: unknown[]) => mockGetUsageSummary(...args),
  getCostByDay: (...args: unknown[]) => mockGetCostByDay(...args),
}));

// ── Import service after mocks ──
import { BudgetAlertService } from "../services/budget-alert.js";
import type { Db } from "@ai-cofounder/db";

// ── Mock NotificationService ──
const mockSendBriefing = vi.fn().mockResolvedValue(undefined);
const mockNotificationService = {
  sendBriefing: mockSendBriefing,
};

// ── Mock db instance ──
const mockDb = {} as Db;

function makeService(): BudgetAlertService {
  return new BudgetAlertService(
    mockDb,
    mockNotificationService as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  );
}

describe("BudgetAlertService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDailyBudget = "0";
    mockWeeklyBudget = "0";
    // Default usage: zero cost
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 0,
      requestCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      byProvider: {},
      byModel: {},
      byAgent: {},
    });
  });

  // ── checkBudgets ──

  it("does not fire notification when DAILY_BUDGET_USD=0 (disabled)", async () => {
    mockDailyBudget = "0";
    mockWeeklyBudget = "0";
    const svc = makeService();
    await svc.checkBudgets();
    expect(mockSendBriefing).not.toHaveBeenCalled();
  });

  it("fires sendBriefing when daily spend >= DAILY_BUDGET_USD threshold", async () => {
    mockDailyBudget = "1.00"; // $1 daily limit
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 1.50, // exceeded
      requestCount: 10,
      totalInputTokens: 5000,
      totalOutputTokens: 2000,
      byProvider: {},
      byModel: {},
      byAgent: {},
    });
    const svc = makeService();
    await svc.checkBudgets();
    expect(mockSendBriefing).toHaveBeenCalledTimes(1);
    expect(mockSendBriefing.mock.calls[0][0]).toContain("daily");
  });

  it("fires sendBriefing when weekly spend >= WEEKLY_BUDGET_USD threshold", async () => {
    mockWeeklyBudget = "5.00"; // $5 weekly limit
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 6.00, // exceeded
      requestCount: 50,
      totalInputTokens: 25000,
      totalOutputTokens: 10000,
      byProvider: {},
      byModel: {},
      byAgent: {},
    });
    const svc = makeService();
    await svc.checkBudgets();
    expect(mockSendBriefing).toHaveBeenCalledTimes(1);
    expect(mockSendBriefing.mock.calls[0][0]).toContain("weekly");
  });

  it("does NOT fire duplicate alert for same calendar day", async () => {
    mockDailyBudget = "1.00";
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 2.00,
      requestCount: 10,
      totalInputTokens: 5000,
      totalOutputTokens: 2000,
      byProvider: {},
      byModel: {},
      byAgent: {},
    });
    const svc = makeService();
    // First call should fire
    await svc.checkBudgets();
    // Second call on same day should NOT fire again
    await svc.checkBudgets();
    expect(mockSendBriefing).toHaveBeenCalledTimes(1);
  });

  it("does not fire when daily spend is below threshold", async () => {
    mockDailyBudget = "10.00"; // $10 daily limit
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 0.50, // under limit
      requestCount: 5,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      byProvider: {},
      byModel: {},
      byAgent: {},
    });
    const svc = makeService();
    await svc.checkBudgets();
    expect(mockSendBriefing).not.toHaveBeenCalled();
  });

  // ── generateOptimizationSuggestions ──

  it("returns suggestion when claude-opus used for >10 requests", async () => {
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 5.00,
      requestCount: 50,
      totalInputTokens: 20000,
      totalOutputTokens: 10000,
      byProvider: {},
      byModel: {
        "claude-opus-4-20250514": { inputTokens: 10000, outputTokens: 5000, costUsd: 4.00, requests: 15 },
        "gpt-4o-mini": { inputTokens: 10000, outputTokens: 5000, costUsd: 1.00, requests: 35 },
      },
      byAgent: {},
    });
    const svc = makeService();
    const suggestions = await svc.generateOptimizationSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.toLowerCase().includes("opus") || s.toLowerCase().includes("expensive"))).toBe(true);
  });

  it("returns 'no opportunities' when usage is modest", async () => {
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 0.10,
      requestCount: 5,
      totalInputTokens: 1000,
      totalOutputTokens: 500,
      byProvider: {},
      byModel: {
        "claude-haiku-3": { inputTokens: 1000, outputTokens: 500, costUsd: 0.10, requests: 5 },
      },
      byAgent: {},
    });
    const svc = makeService();
    const suggestions = await svc.generateOptimizationSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toContain("No optimization opportunities");
  });

  it("returns suggestion when orchestrator agent has very high cost", async () => {
    mockGetUsageSummary.mockResolvedValue({
      totalCostUsd: 20.00,
      requestCount: 100,
      totalInputTokens: 50000,
      totalOutputTokens: 20000,
      byProvider: {},
      byModel: {},
      byAgent: {
        orchestrator: { inputTokens: 40000, outputTokens: 15000, costUsd: 15.00, requests: 80 },
        coder: { inputTokens: 10000, outputTokens: 5000, costUsd: 5.00, requests: 20 },
      },
    });
    const svc = makeService();
    const suggestions = await svc.generateOptimizationSuggestions();
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.toLowerCase().includes("orchestrator") || s.toLowerCase().includes("agent"))).toBe(true);
  });
});
