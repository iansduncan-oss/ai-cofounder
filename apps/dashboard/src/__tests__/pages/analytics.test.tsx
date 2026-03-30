import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders } from "../test-utils";

// Mock query hooks
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

// Mock recharts to avoid SVG rendering issues in jsdom
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

const usageData = {
  totalInputTokens: 100000,
  totalOutputTokens: 50000,
  totalCostUsd: 1.2345,
  requestCount: 42,
  byProvider: {
    anthropic: { inputTokens: 80000, outputTokens: 40000, costUsd: 1.0, requests: 30 },
  },
  byModel: {
    "claude-sonnet-4-20250514": { inputTokens: 80000, outputTokens: 40000, costUsd: 1.0 },
  },
  byAgent: {
    orchestrator: { costUsd: 1.0, requests: 30 },
  },
};

const providerHealthData = {
  providers: [
    { provider: "anthropic", available: true, totalRequests: 100, successCount: 95, errorCount: 5, avgLatencyMs: 200 },
    { provider: "groq", available: false, totalRequests: 20, successCount: 18, errorCount: 2, avgLatencyMs: 50 },
  ],
};

const toolStatsData = {
  timestamp: new Date().toISOString(),
  tools: [
    { toolName: "search_web", totalExecutions: 50, successCount: 48, errorCount: 2, avgDurationMs: 1200, p95DurationMs: 2500 },
    { toolName: "save_memory", totalExecutions: 30, successCount: 30, errorCount: 0, avgDurationMs: 50, p95DurationMs: 100 },
  ],
};

function setupDefaultMocks() {
  mockUseUsage.mockReturnValue({ data: usageData, isLoading: false, error: null });
  mockUseProviderHealth.mockReturnValue({ data: providerHealthData });
  mockUseDailyCost.mockReturnValue({ data: { days: [] } });
  mockUseBudgetStatus.mockReturnValue({
    data: {
      daily: { limitUsd: 5, spentUsd: 1.23, percentUsed: 24.6 },
      weekly: { limitUsd: 25, spentUsd: 8.5, percentUsed: 34 },
      optimizationSuggestions: [],
    },
  });
  mockUseTopExpensiveGoals.mockReturnValue({ data: [] });
  mockUseToolStats.mockReturnValue({ data: toolStatsData });
}

async function renderAnalytics() {
  const { AnalyticsPage } = await import("@/routes/analytics");
  return renderWithProviders(<AnalyticsPage />, { initialEntries: ["/dashboard/analytics"] });
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("renders the page title", async () => {
    await renderAnalytics();
    expect(screen.getByText("Analytics")).toBeInTheDocument();
    expect(screen.getByText("Cost, usage, and tool performance insights")).toBeInTheDocument();
  });

  it("renders 3 tab buttons", async () => {
    await renderAnalytics();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Costs")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });

  it("defaults to Overview tab", async () => {
    await renderAnalytics();
    expect(screen.getByText("Today's Cost")).toBeInTheDocument();
    expect(screen.getByText("Today's Tokens")).toBeInTheDocument();
    expect(screen.getByText("Daily Cost Trend")).toBeInTheDocument();
  });

  it("switches to Costs tab", async () => {
    await renderAnalytics();
    fireEvent.click(screen.getByText("Costs"));
    expect(screen.getByText("Total Tokens")).toBeInTheDocument();
    expect(screen.getByText("Total Cost")).toBeInTheDocument();
    expect(screen.getByText("Daily Cost Trend (30 Days)")).toBeInTheDocument();
  });

  it("shows period selector only on Costs tab", async () => {
    await renderAnalytics();
    // Overview: no period selector
    expect(screen.queryByDisplayValue("Today")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Costs"));
    expect(screen.getByDisplayValue("Today")).toBeInTheDocument();
  });

  it("switches to Tools tab and shows tool stats", async () => {
    await renderAnalytics();
    fireEvent.click(screen.getByText("Tools"));
    expect(screen.getByText("Total Executions")).toBeInTheDocument();
    expect(screen.getByText("Avg Success Rate")).toBeInTheDocument();
    expect(screen.getAllByText("Avg Latency").length).toBeGreaterThan(0);
    expect(screen.getByText("Tool Execution Stats")).toBeInTheDocument();
  });

  it("renders loading skeletons when data is loading", async () => {
    mockUseUsage.mockReturnValue({ data: null, isLoading: true, error: null });
    const { container } = await renderAnalytics();
    // CardSkeleton renders animated div placeholders
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders error state when usage fails", async () => {
    mockUseUsage.mockReturnValue({ data: null, isLoading: false, error: new Error("API down") });
    await renderAnalytics();
    expect(screen.getByText("Failed to load usage data")).toBeInTheDocument();
    expect(screen.getByText("API down")).toBeInTheDocument();
  });

  it("renders budget gauges on Overview", async () => {
    await renderAnalytics();
    expect(screen.getByText("Daily Budget")).toBeInTheDocument();
    expect(screen.getByText("Weekly Budget")).toBeInTheDocument();
    expect(screen.getByText("24.6% used")).toBeInTheDocument();
    expect(screen.getByText("34.0% used")).toBeInTheDocument();
  });

  it("renders provider health table on Overview", async () => {
    await renderAnalytics();
    expect(screen.getByText("Provider Health")).toBeInTheDocument();
    expect(screen.getByText("anthropic")).toBeInTheDocument();
    expect(screen.getByText("Online")).toBeInTheDocument();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("renders tool stats table on Tools tab", async () => {
    await renderAnalytics();
    fireEvent.click(screen.getByText("Tools"));
    expect(screen.getByText("search_web")).toBeInTheDocument();
    expect(screen.getByText("save_memory")).toBeInTheDocument();
    expect(screen.getByText("80")).toBeInTheDocument(); // total executions
  });

  it("shows empty state when no tool data", async () => {
    mockUseToolStats.mockReturnValue({ data: { timestamp: "", tools: [] } });
    await renderAnalytics();
    fireEvent.click(screen.getByText("Tools"));
    expect(screen.getByText("No tool execution data yet")).toBeInTheDocument();
  });
});
