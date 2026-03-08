import { screen, waitFor } from "@testing-library/react";
import { OverviewPage } from "@/routes/overview";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useHealth: vi.fn(),
  usePendingApprovals: vi.fn(),
  usePendingTasks: vi.fn(),
  useUsage: vi.fn(),
}));

import { useHealth, usePendingApprovals, usePendingTasks, useUsage } from "@/api/queries";

const mockUseHealth = vi.mocked(useHealth);
const mockUsePendingApprovals = vi.mocked(usePendingApprovals);
const mockUsePendingTasks = vi.mocked(usePendingTasks);
const mockUseUsage = vi.mocked(useUsage);

describe("OverviewPage", () => {
  beforeEach(() => {
    mockUseHealth.mockReturnValue({
      data: { status: "ok", timestamp: new Date().toISOString(), uptime: 7200 },
    } as ReturnType<typeof useHealth>);
    mockUsePendingApprovals.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePendingApprovals>);
    mockUsePendingTasks.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePendingTasks>);
    mockUseUsage.mockReturnValue({
      data: { totalInputTokens: 50000, totalOutputTokens: 30000, totalCostUsd: 1.23, requestCount: 10, period: "today", byProvider: {}, byModel: {}, byAgent: {} },
      isLoading: false,
    } as unknown as ReturnType<typeof useUsage>);
  });

  it("renders the overview title", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("shows stat cards when loaded", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("Pending Tasks")).toBeInTheDocument();
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
    expect(screen.getByText("Today's Tokens")).toBeInTheDocument();
    expect(screen.getByText("System Status")).toBeInTheDocument();
  });

  it("displays token count", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("80k")).toBeInTheDocument();
    expect(screen.getByText("$1.23 estimated")).toBeInTheDocument();
  });

  it("shows healthy system status", () => {
    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Up 2h")).toBeInTheDocument();
  });

  it("shows error state when queries fail", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    } as unknown as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("Failed to load dashboard data")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("shows loading skeletons when loading", () => {
    mockUsePendingTasks.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof usePendingTasks>);

    const { container } = renderWithProviders(<OverviewPage />);
    // CardSkeleton uses animate-pulse
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("displays pending tasks list", () => {
    mockUsePendingTasks.mockReturnValue({
      data: [
        { id: "t1", goalId: "g1", title: "Write tests", status: "pending", orderIndex: 0, assignedAgent: "coder", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePendingTasks>);

    renderWithProviders(<OverviewPage />);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
  });
});
