import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "@/components/common/notification-bell";
import { renderWithProviders } from "../test-utils";

// Mock the query hooks
vi.mock("@/api/queries", () => ({
  usePendingApprovals: vi.fn(),
  usePendingTasks: vi.fn(),
}));

import { usePendingApprovals, usePendingTasks } from "@/api/queries";

const mockUsePendingApprovals = vi.mocked(usePendingApprovals);
const mockUsePendingTasks = vi.mocked(usePendingTasks);

describe("NotificationBell", () => {
  beforeEach(() => {
    mockUsePendingApprovals.mockReturnValue({ data: [] } as ReturnType<typeof usePendingApprovals>);
    mockUsePendingTasks.mockReturnValue({ data: [] } as ReturnType<typeof usePendingTasks>);
  });

  it("renders bell icon", () => {
    renderWithProviders(<NotificationBell />);
    expect(screen.getByLabelText("Notifications")).toBeInTheDocument();
  });

  it("shows no badge when count is 0", () => {
    renderWithProviders(<NotificationBell />);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows badge with approval count", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        { id: "a1", taskId: "t1", requestedBy: "orchestrator", status: "pending", reason: "Test", createdAt: new Date().toISOString() },
        { id: "a2", taskId: "t2", requestedBy: "orchestrator", status: "pending", reason: "Test 2", createdAt: new Date().toISOString() },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<NotificationBell />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows badge with combined count of approvals + failed tasks", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        { id: "a1", taskId: "t1", requestedBy: "orchestrator", status: "pending", reason: "Test", createdAt: new Date().toISOString() },
      ],
    } as ReturnType<typeof usePendingApprovals>);
    mockUsePendingTasks.mockReturnValue({
      data: [
        { id: "t1", goalId: "g1", title: "Failed task", status: "failed", orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
    } as ReturnType<typeof usePendingTasks>);

    renderWithProviders(<NotificationBell />);
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("opens dropdown on click", async () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        { id: "a1", taskId: "t1", requestedBy: "orchestrator", status: "pending", reason: "Needs review", createdAt: new Date().toISOString() },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByText("Approval: Needs review")).toBeInTheDocument();
  });

  it("shows 'No new notifications' when empty", async () => {
    renderWithProviders(<NotificationBell />);
    await userEvent.click(screen.getByLabelText("Notifications"));
    expect(screen.getByText("No new notifications")).toBeInTheDocument();
  });

  it("caps badge at 9+", () => {
    const approvals = Array.from({ length: 10 }, (_, i) => ({
      id: `a${i}`,
      taskId: `t${i}`,
      requestedBy: "orchestrator" as const,
      status: "pending" as const,
      reason: `Test ${i}`,
      createdAt: new Date().toISOString(),
    }));
    mockUsePendingApprovals.mockReturnValue({
      data: approvals,
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<NotificationBell />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });
});
