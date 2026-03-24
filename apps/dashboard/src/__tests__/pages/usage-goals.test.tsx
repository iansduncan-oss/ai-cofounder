import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils";

const mockUseUsage = vi.fn();
const mockUseProviderHealth = vi.fn();
const mockUseDailyCost = vi.fn();
const mockUseBudgetStatus = vi.fn();
const mockUseTopExpensiveGoals = vi.fn();
const mockUseToolStats = vi.fn();

vi.mock("@/api/queries", () => ({
  useUsage: (...args: unknown[]) => mockUseUsage(...args),
  useProviderHealth: () => mockUseProviderHealth(),
  useDailyCost: () => mockUseDailyCost(),
  useBudgetStatus: () => mockUseBudgetStatus(),
  useTopExpensiveGoals: () => mockUseTopExpensiveGoals(),
  useToolStats: () => mockUseToolStats(),
}));

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: () => <div data-testid="line-chart" />,
  Line: () => null,
  BarChart: () => <div data-testid="bar-chart" />,
  Bar: () => null,
  PieChart: () => <div data-testid="pie-chart" />,
  Pie: () => null,
  Cell: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

describe("AnalyticsPage — Goal Costs Section", () => {
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
    });
    mockUseProviderHealth.mockReturnValue({ data: { providers: [] } });
    mockUseDailyCost.mockReturnValue({ data: { days: [] } });
    mockUseBudgetStatus.mockReturnValue({
      data: {
        daily: { spentUsd: 0, limitUsd: 0, percentUsed: null },
        weekly: { spentUsd: 0, limitUsd: 0, percentUsed: null },
        optimizationSuggestions: [],
      },
    });
    mockUseToolStats.mockReturnValue({ data: { timestamp: "", tools: [] } });
  });

  async function renderCostsTab() {
    const { AnalyticsPage } = await import("@/routes/analytics");
    renderWithProviders(<AnalyticsPage />, { initialEntries: ["/dashboard/analytics"] });
    fireEvent.click(screen.getByText("Costs"));
  }

  it("renders the goal costs table when data is available", async () => {
    mockUseTopExpensiveGoals.mockReturnValue({
      data: [
        { goalId: "g-1", goalTitle: "Build dashboard", totalCostUsd: 0.5, totalInputTokens: 10000, totalOutputTokens: 5000, requestCount: 20 },
        { goalId: "g-2", goalTitle: "Fix authentication", totalCostUsd: 0.2, totalInputTokens: 4000, totalOutputTokens: 2000, requestCount: 8 },
      ],
      isLoading: false,
    });

    await renderCostsTab();

    expect(screen.getByText("Top Expensive Goals")).toBeInTheDocument();
    expect(screen.getByText("Build dashboard")).toBeInTheDocument();
    expect(screen.getByText("Fix authentication")).toBeInTheDocument();
    expect(screen.getByText("$0.5000")).toBeInTheDocument();
    expect(screen.getByText("$0.2000")).toBeInTheDocument();
  });

  it("does not render goal costs section when no data", async () => {
    mockUseTopExpensiveGoals.mockReturnValue({
      data: [],
      isLoading: false,
    });

    await renderCostsTab();

    expect(screen.queryByText("Top Expensive Goals")).not.toBeInTheDocument();
  });

  it("does not render goal costs section when data is undefined", async () => {
    mockUseTopExpensiveGoals.mockReturnValue({
      data: undefined,
      isLoading: true,
    });

    await renderCostsTab();

    expect(screen.queryByText("Top Expensive Goals")).not.toBeInTheDocument();
  });
});
