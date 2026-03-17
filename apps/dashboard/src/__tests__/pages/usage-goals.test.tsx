import { screen } from "@testing-library/react";
import { UsagePage } from "@/routes/usage";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useUsage: vi.fn(),
  useProviderHealth: vi.fn(),
  useDailyCost: vi.fn(),
  useBudgetStatus: vi.fn(),
  useTopExpensiveGoals: vi.fn(),
}));

import { useUsage, useProviderHealth, useDailyCost, useBudgetStatus, useTopExpensiveGoals } from "@/api/queries";

const mockUseUsage = vi.mocked(useUsage);
const mockUseProviderHealth = vi.mocked(useProviderHealth);
const mockUseDailyCost = vi.mocked(useDailyCost);
const mockUseBudgetStatus = vi.mocked(useBudgetStatus);
const mockUseTopExpensiveGoals = vi.mocked(useTopExpensiveGoals);

describe("UsagePage — Goal Costs Section", () => {
  beforeEach(() => {
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
      data: { providers: [] },
    } as unknown as ReturnType<typeof useProviderHealth>);
    mockUseDailyCost.mockReturnValue({
      data: { days: [] },
    } as unknown as ReturnType<typeof useDailyCost>);
    mockUseBudgetStatus.mockReturnValue({
      data: { daily: { spentUsd: 0, limitUsd: 0, percentUsed: null }, weekly: { spentUsd: 0, limitUsd: 0, percentUsed: null }, optimizationSuggestions: [] },
    } as unknown as ReturnType<typeof useBudgetStatus>);
  });

  it("renders the goal costs table when data is available", () => {
    mockUseTopExpensiveGoals.mockReturnValue({
      data: [
        { goalId: "g-1", goalTitle: "Build dashboard", totalCostUsd: 0.5, totalInputTokens: 10000, totalOutputTokens: 5000, requestCount: 20 },
        { goalId: "g-2", goalTitle: "Fix authentication", totalCostUsd: 0.2, totalInputTokens: 4000, totalOutputTokens: 2000, requestCount: 8 },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useTopExpensiveGoals>);

    renderWithProviders(<UsagePage />);

    expect(screen.getByText("Top Expensive Goals")).toBeInTheDocument();
    expect(screen.getByText("Build dashboard")).toBeInTheDocument();
    expect(screen.getByText("Fix authentication")).toBeInTheDocument();
    expect(screen.getByText("$0.5000")).toBeInTheDocument();
    expect(screen.getByText("$0.2000")).toBeInTheDocument();
  });

  it("does not render goal costs section when no data", () => {
    mockUseTopExpensiveGoals.mockReturnValue({
      data: [],
      isLoading: false,
    } as unknown as ReturnType<typeof useTopExpensiveGoals>);

    renderWithProviders(<UsagePage />);

    expect(screen.queryByText("Top Expensive Goals")).not.toBeInTheDocument();
  });

  it("does not render goal costs section when data is undefined", () => {
    mockUseTopExpensiveGoals.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useTopExpensiveGoals>);

    renderWithProviders(<UsagePage />);

    expect(screen.queryByText("Top Expensive Goals")).not.toBeInTheDocument();
  });
});
