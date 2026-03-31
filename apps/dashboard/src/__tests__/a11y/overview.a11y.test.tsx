import { axe } from "vitest-axe";
import { OverviewPage } from "@/routes/overview";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useHealth: vi.fn(),
  usePendingApprovals: vi.fn(),
  usePendingTasks: vi.fn(),
  useUsage: vi.fn(),
  useProviderHealth: vi.fn(),
  useGoalAnalytics: vi.fn(),
}));

import { useHealth, usePendingApprovals, usePendingTasks, useUsage, useProviderHealth, useGoalAnalytics } from "@/api/queries";

const mockUseHealth = vi.mocked(useHealth);
const mockUsePendingApprovals = vi.mocked(usePendingApprovals);
const mockUsePendingTasks = vi.mocked(usePendingTasks);
const mockUseUsage = vi.mocked(useUsage);
const mockUseProviderHealth = vi.mocked(useProviderHealth);
const mockUseGoalAnalytics = vi.mocked(useGoalAnalytics);

function mockLoaded() {
  mockUseHealth.mockReturnValue({
    data: { status: "ok", timestamp: new Date().toISOString(), uptime: 7200 },
  } as ReturnType<typeof useHealth>);
  mockUsePendingApprovals.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePendingApprovals>);
  mockUsePendingTasks.mockReturnValue({
    data: [
      { id: "t1", goalId: "g1", title: "Write tests", status: "pending", orderIndex: 0, assignedAgent: "coder", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ],
    isLoading: false,
    error: null,
  } as unknown as ReturnType<typeof usePendingTasks>);
  mockUseUsage.mockReturnValue({
    data: { totalInputTokens: 50000, totalOutputTokens: 30000, totalCostUsd: 1.23, requestCount: 10, period: "today", byProvider: {}, byModel: {}, byAgent: {} },
    isLoading: false,
  } as unknown as ReturnType<typeof useUsage>);
  mockUseProviderHealth.mockReturnValue({ data: { providers: [] } } as unknown as ReturnType<typeof useProviderHealth>);
  mockUseGoalAnalytics.mockReturnValue({ data: null } as unknown as ReturnType<typeof useGoalAnalytics>);
}

function mockLoading() {
  mockUseHealth.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof useHealth>);
  mockUsePendingApprovals.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof usePendingApprovals>);
  mockUsePendingTasks.mockReturnValue({ data: undefined, isLoading: true, error: null } as unknown as ReturnType<typeof usePendingTasks>);
  mockUseUsage.mockReturnValue({ data: undefined, isLoading: true } as unknown as ReturnType<typeof useUsage>);
  mockUseProviderHealth.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useProviderHealth>);
  mockUseGoalAnalytics.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGoalAnalytics>);
}

describe("OverviewPage a11y", () => {
  it("has no accessibility violations in loaded state", async () => {
    mockLoaded();
    const { container } = renderWithProviders(<OverviewPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations in loading state", async () => {
    mockLoading();
    const { container } = renderWithProviders(<OverviewPage />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
