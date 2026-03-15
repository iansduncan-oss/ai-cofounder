import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsPage } from "@/routes/notifications";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  usePendingApprovals: vi.fn(),
  useMonitoringStatus: vi.fn(),
  useBudgetStatus: vi.fn(),
}));

import { usePendingApprovals, useMonitoringStatus, useBudgetStatus } from "@/api/queries";

const mockUsePendingApprovals = vi.mocked(usePendingApprovals);
const mockUseMonitoringStatus = vi.mocked(useMonitoringStatus);
const mockUseBudgetStatus = vi.mocked(useBudgetStatus);

const now = new Date().toISOString();
const earlier = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePendingApprovals.mockReturnValue({
      data: [],
    } as ReturnType<typeof usePendingApprovals>);
    mockUseMonitoringStatus.mockReturnValue({
      data: { alerts: [], github: null, vps: null },
    } as ReturnType<typeof useMonitoringStatus>);
    mockUseBudgetStatus.mockReturnValue({
      data: {
        daily: { spentUsd: 0, limitUsd: 10, percentUsed: 50 },
        weekly: { spentUsd: 0, limitUsd: 70, percentUsed: 10 },
      },
    } as ReturnType<typeof useBudgetStatus>);
  });

  it("renders Notifications heading", () => {
    renderWithProviders(<NotificationsPage />);
    expect(screen.getByText("Notifications")).toBeInTheDocument();
  });

  it("renders pending approvals as notification items with 'Approval:' prefix", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        {
          id: "a1",
          taskId: "t1",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Tool 'write_file' requires approval",
          createdAt: now,
        },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<NotificationsPage />);

    expect(screen.getByText(/Approval:/)).toBeInTheDocument();
    expect(screen.getByText(/write_file/)).toBeInTheDocument();
  });

  it("renders monitoring alerts as notification items with 'Alert:' prefix", () => {
    mockUseMonitoringStatus.mockReturnValue({
      data: {
        alerts: [
          {
            id: "alert-1",
            message: "CPU usage high",
            level: "warning",
            timestamp: now,
          },
        ],
        github: null,
        vps: null,
      },
    } as ReturnType<typeof useMonitoringStatus>);

    renderWithProviders(<NotificationsPage />);

    expect(screen.getByText(/Alert:/)).toBeInTheDocument();
    expect(screen.getByText(/CPU usage high/)).toBeInTheDocument();
  });

  it("renders budget warning when percentUsed > 90", () => {
    mockUseBudgetStatus.mockReturnValue({
      data: {
        daily: { spentUsd: 9.5, limitUsd: 10, percentUsed: 95 },
        weekly: { spentUsd: 60, limitUsd: 70, percentUsed: 85 },
      },
    } as ReturnType<typeof useBudgetStatus>);

    renderWithProviders(<NotificationsPage />);

    expect(screen.getByText(/Budget:/)).toBeInTheDocument();
    expect(screen.getByText(/95%/)).toBeInTheDocument();
  });

  it("shows empty state when no notifications", () => {
    renderWithProviders(<NotificationsPage />);

    expect(screen.getByText("No notifications")).toBeInTheDocument();
  });

  it("notifications are sorted by most recent first", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        {
          id: "a1",
          taskId: "t1",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Older approval",
          createdAt: earlier,
        },
        {
          id: "a2",
          taskId: "t2",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Newer approval",
          createdAt: now,
        },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<NotificationsPage />);

    const items = screen.getAllByText(/Approval:/);
    expect(items).toHaveLength(2);
    // Check DOM order — newer should appear first
    const bodyText = document.body.textContent ?? "";
    const newerPos = bodyText.indexOf("Newer approval");
    const olderPos = bodyText.indexOf("Older approval");
    expect(newerPos).toBeGreaterThan(-1);
    expect(olderPos).toBeGreaterThan(-1);
    expect(newerPos).toBeLessThan(olderPos);
  });
});
