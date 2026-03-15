import { screen } from "@testing-library/react";
import { ApprovalsPage } from "@/routes/approvals";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  usePendingApprovals: vi.fn(),
  useToolTierConfig: vi.fn(),
}));

vi.mock("@/api/mutations", () => ({
  useResolveApproval: vi.fn(),
}));

import { usePendingApprovals, useToolTierConfig } from "@/api/queries";
import { useResolveApproval } from "@/api/mutations";

const mockUsePendingApprovals = vi.mocked(usePendingApprovals);
const mockUseToolTierConfig = vi.mocked(useToolTierConfig);
const mockUseResolveApproval = vi.mocked(useResolveApproval);

const mockMutate = vi.fn();

describe("ApprovalsPage tier badges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseResolveApproval.mockReturnValue({
      mutate: mockMutate,
      isPending: false,
    } as ReturnType<typeof useResolveApproval>);
    mockUseToolTierConfig.mockReturnValue({
      data: [
        { toolName: "write_file", tier: "yellow", timeoutMs: 30000, updatedBy: null, updatedAt: "2025-01-01T00:00:00Z" },
        { toolName: "git_push", tier: "red", timeoutMs: 30000, updatedBy: null, updatedAt: "2025-01-01T00:00:00Z" },
        { toolName: "read_file", tier: "green", timeoutMs: 30000, updatedBy: null, updatedAt: "2025-01-01T00:00:00Z" },
      ],
    } as ReturnType<typeof useToolTierConfig>);
  });

  it("renders a tier badge on each approval card", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        {
          id: "a1",
          taskId: "t1",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Tool 'write_file' requires approval",
          createdAt: new Date().toISOString(),
        },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<ApprovalsPage />);

    // The tier badge should be visible (yellow or warning style)
    expect(screen.getByTestId("tier-badge-a1")).toBeInTheDocument();
  });

  it("shows correct color badge for yellow-tier tool (write_file)", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        {
          id: "a1",
          taskId: "t1",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Tool 'write_file' requires approval",
          createdAt: new Date().toISOString(),
        },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<ApprovalsPage />);

    const badge = screen.getByTestId("tier-badge-a1");
    expect(badge).toHaveTextContent("yellow");
  });

  it("shows correct color badge for red-tier tool (git_push)", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        {
          id: "a2",
          taskId: "t2",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Tool 'git_push' requires approval",
          createdAt: new Date().toISOString(),
        },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<ApprovalsPage />);

    const badge = screen.getByTestId("tier-badge-a2");
    expect(badge).toHaveTextContent("red");
  });

  it("still renders approve and reject buttons for pending approvals", () => {
    mockUsePendingApprovals.mockReturnValue({
      data: [
        {
          id: "a1",
          taskId: "t1",
          requestedBy: "orchestrator",
          status: "pending",
          reason: "Tool 'write_file' requires approval",
          createdAt: new Date().toISOString(),
        },
      ],
    } as ReturnType<typeof usePendingApprovals>);

    renderWithProviders(<ApprovalsPage />);

    expect(screen.getByRole("button", { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reject/i })).toBeInTheDocument();
  });
});
