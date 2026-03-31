import { axe } from "vitest-axe";
import { AnalyticsPage } from "@/routes/analytics";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useUsage: vi.fn(),
  useProviderHealth: vi.fn(),
  useDailyCost: vi.fn(),
  useBudgetStatus: vi.fn(),
  useTopExpensiveGoals: vi.fn(),
  useToolStats: vi.fn(),
  useGoalAnalytics: vi.fn(),
}));

import {
  useUsage,
  useProviderHealth,
  useDailyCost,
  useBudgetStatus,
  useTopExpensiveGoals,
  useToolStats,
  useGoalAnalytics,
} from "@/api/queries";

const mockUseUsage = vi.mocked(useUsage);
const mockUseProviderHealth = vi.mocked(useProviderHealth);
const mockUseDailyCost = vi.mocked(useDailyCost);
const mockUseBudgetStatus = vi.mocked(useBudgetStatus);
const mockUseTopExpensiveGoals = vi.mocked(useTopExpensiveGoals);
const mockUseToolStats = vi.mocked(useToolStats);
const mockUseGoalAnalytics = vi.mocked(useGoalAnalytics);

function mockLoaded() {
  mockUseUsage.mockReturnValue({
    data: {
      totalInputTokens: 50000,
      totalOutputTokens: 30000,
      totalCostUsd: 1.23,
      requestCount: 10,
      period: "today",
      byProvider: {},
      byModel: {},
      byAgent: {},
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useUsage>);
  mockUseProviderHealth.mockReturnValue({
    data: {
      providers: [
        { provider: "anthropic", available: true, totalRequests: 100, successCount: 98, errorCount: 2, avgLatencyMs: 200 },
      ],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useProviderHealth>);
  mockUseDailyCost.mockReturnValue({
    data: { days: [{ date: "2026-03-22", costUsd: 0.5 }] },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useDailyCost>);
  mockUseBudgetStatus.mockReturnValue({
    data: {
      daily: { limitUsd: 10, spentUsd: 1.23, percentUsed: 12.3 },
      weekly: { limitUsd: 50, spentUsd: 5, percentUsed: 10 },
      optimizationSuggestions: [],
    },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useBudgetStatus>);
  mockUseTopExpensiveGoals.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useTopExpensiveGoals>);
  mockUseToolStats.mockReturnValue({
    data: { tools: [] },
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useToolStats>);
  mockUseGoalAnalytics.mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof useGoalAnalytics>);
}

function mockLoading() {
  mockUseUsage.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useUsage>);
  mockUseProviderHealth.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useProviderHealth>);
  mockUseDailyCost.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useDailyCost>);
  mockUseBudgetStatus.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useBudgetStatus>);
  mockUseTopExpensiveGoals.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useTopExpensiveGoals>);
  mockUseToolStats.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useToolStats>);
  mockUseGoalAnalytics.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useGoalAnalytics>);
}

describe("AnalyticsPage a11y", () => {
  it("has no accessibility violations in loaded state", async () => {
    mockLoaded();
    const { container } = renderWithProviders(<AnalyticsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations in loading state", async () => {
    mockLoading();
    const { container } = renderWithProviders(<AnalyticsPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
