import { axe } from "vitest-axe";
import { GoalDetailPage } from "@/routes/goal-detail";
import { renderWithProviders } from "../test-utils";

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useParams: () => ({ id: "goal-1" }) };
});

vi.mock("@/api/queries", () => ({
  useGoal: vi.fn(),
  useTasks: vi.fn(),
  useCostByGoal: vi.fn().mockReturnValue({ data: null }),
}));

vi.mock("@/api/mutations", () => ({
  useUpdateGoalStatus: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useApproveGoal: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useRejectGoal: vi.fn().mockReturnValue({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteGoal: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
  useCancelGoal: vi.fn().mockReturnValue({ mutate: vi.fn(), isPending: false }),
}));

import { useGoal, useTasks } from "@/api/queries";

const mockUseGoal = vi.mocked(useGoal);
const mockUseTasks = vi.mocked(useTasks);

describe("GoalDetailPage a11y", () => {
  it("has no accessibility violations with tasks displayed", async () => {
    mockUseGoal.mockReturnValue({
      data: {
        id: "goal-1",
        conversationId: "c-1",
        title: "Test Goal",
        description: "A goal for testing",
        status: "active",
        priority: "medium",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useGoal>);
    mockUseTasks.mockReturnValue({
      data: {
        data: [
          { id: "t1", goalId: "goal-1", title: "Task 1", status: "completed", orderIndex: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          { id: "t2", goalId: "goal-1", title: "Task 2", status: "pending", orderIndex: 1, dependsOn: ["t1"], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);

    const { container } = renderWithProviders(<GoalDetailPage />, {
      initialEntries: ["/dashboard/goals/goal-1"],
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has no accessibility violations in loading state", async () => {
    mockUseGoal.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useGoal>);
    mockUseTasks.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useTasks>);

    const { container } = renderWithProviders(<GoalDetailPage />, {
      initialEntries: ["/dashboard/goals/goal-1"],
    });
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
