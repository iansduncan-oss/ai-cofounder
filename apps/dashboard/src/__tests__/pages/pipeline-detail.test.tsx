vi.mock("@/api/queries", () => ({
  useListPipelines: vi.fn(),
  usePipeline: vi.fn(),
  useGoal: vi.fn(() => ({ data: null })),
}));

vi.mock("@/api/mutations", () => ({
  useSubmitGoalPipeline: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useCancelPipeline: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useRetryPipeline: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useParams: vi.fn(() => ({ jobId: "job-test-1234" })), useNavigate: () => mockNavigate };
});

import { screen, fireEvent } from "@testing-library/react";
import { usePipeline } from "@/api/queries";
import { PipelineDetailPage } from "@/routes/pipeline-detail";
import { renderWithProviders } from "../test-utils";

const mockUsePipeline = vi.mocked(usePipeline);

const mockPipelineDetail = {
  jobId: "job-test-1234",
  pipelineId: "pipe-test-abcdef12",
  goalId: "goal-test-abcdef12",
  stages: [
    { agent: "planner", prompt: "Create a plan", dependsOnPrevious: false },
    { agent: "coder", prompt: "Implement the plan", dependsOnPrevious: true },
    { agent: "reviewer", prompt: "Review the code", dependsOnPrevious: true },
  ],
  currentStage: 3,
  context: {},
  state: "completed" as const,
  createdAt: "2026-03-09T10:00:00Z",
  finishedAt: "2026-03-09T10:05:30Z",
  failedReason: null,
  result: {
    pipelineId: "pipe-test-abcdef12",
    goalId: "goal-test-abcdef12",
    status: "completed" as const,
    stageResults: [
      { stageIndex: 0, agent: "planner", status: "completed" as const, output: "Here is the plan..." },
      { stageIndex: 1, agent: "coder", status: "completed" as const, output: "Here is the code..." },
      { stageIndex: 2, agent: "reviewer", status: "completed" as const, output: "LGTM" },
    ],
  },
};

const mockActivePipeline = {
  ...mockPipelineDetail,
  state: "active" as const,
  currentStage: 1,
  finishedAt: null,
  result: null,
};

const mockFailedPipeline = {
  ...mockPipelineDetail,
  state: "failed" as const,
  failedReason: "Stage 2 timed out",
  result: {
    ...mockPipelineDetail.result!,
    status: "failed" as const,
    stageResults: [
      { stageIndex: 0, agent: "planner", status: "completed" as const, output: "Here is the plan..." },
      { stageIndex: 1, agent: "coder", status: "failed" as const, error: "Execution timed out after 30s" },
      { stageIndex: 2, agent: "reviewer", status: "skipped" as const },
    ],
  },
};

describe("PipelineDetailPage", () => {
  beforeEach(() => {
    mockUsePipeline.mockReturnValue({
      data: mockPipelineDetail,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePipeline>);
  });

  it("shows stage status indicators for each stage (DETAIL-01)", () => {
    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    const stageButtons = screen.getAllByRole("button", { hidden: true });
    // Filter to those with aria-expanded attribute (our stage rows)
    const stageRows = stageButtons.filter((btn) => btn.hasAttribute("aria-expanded"));
    expect(stageRows).toHaveLength(3);
    // Agent names should be visible (Tailwind capitalize is CSS-only, so text is lowercase in DOM)
    expect(screen.getByText("planner")).toBeInTheDocument();
    expect(screen.getByText("coder")).toBeInTheDocument();
    expect(screen.getByText("reviewer")).toBeInTheDocument();
  });

  it("shows active stage status for active pipeline (DETAIL-01)", () => {
    mockUsePipeline.mockReturnValue({
      data: mockActivePipeline,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePipeline>);

    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    // Stage 2 (index 1) should show "active" status text
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("expands stage to show output text (DETAIL-02)", () => {
    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });

    // Output should not be visible initially
    expect(screen.queryByText("Here is the plan...")).not.toBeInTheDocument();

    // Click the first stage row (planner)
    const stageRows = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.hasAttribute("aria-expanded"),
    );
    fireEvent.click(stageRows[0]);

    // Output should now be visible
    expect(screen.getByText("Here is the plan...")).toBeInTheDocument();

    // Click again to collapse
    fireEvent.click(stageRows[0]);

    // Output should be hidden again
    expect(screen.queryByText("Here is the plan...")).not.toBeInTheDocument();
  });

  it("expands stage to show error details (DETAIL-02)", () => {
    mockUsePipeline.mockReturnValue({
      data: mockFailedPipeline,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePipeline>);

    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });

    // Click the second stage (coder, index 1)
    const stageRows = screen.getAllByRole("button", { hidden: true }).filter(
      (btn) => btn.hasAttribute("aria-expanded"),
    );
    fireEvent.click(stageRows[1]);

    // Error text should be visible
    expect(screen.getByText("Execution timed out after 30s")).toBeInTheDocument();
  });

  it("shows pipeline duration for completed pipeline (DETAIL-03)", () => {
    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    // createdAt: 10:00:00, finishedAt: 10:05:30 → 5m 30s
    expect(screen.getByText("Duration: 5m 30s")).toBeInTheDocument();
  });

  it("shows metadata: state badge, goal link, timestamps (DETAIL-04)", () => {
    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });

    // State badge — PipelineStateBadge renders "Completed" for state="completed"
    expect(screen.getByText("Completed")).toBeInTheDocument();

    // Goal link — first 8 chars of "goal-test-abcdef12" is "goal-tes"
    const goalLink = screen.getByRole("link", { name: "goal-tes" });
    expect(goalLink).toBeInTheDocument();
    expect(goalLink.getAttribute("href")).toContain("/dashboard/goals/goal-test-abcdef12");

    // Timestamps should appear (formatDate output)
    expect(screen.getByText(/Created:/)).toBeInTheDocument();
    expect(screen.getByText(/Finished:/)).toBeInTheDocument();
  });

  it("shows failed reason in metadata (DETAIL-04)", () => {
    mockUsePipeline.mockReturnValue({
      data: mockFailedPipeline,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePipeline>);

    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    expect(screen.getByText(/Stage 2 timed out/)).toBeInTheDocument();
  });

  it("shows auto-refresh indicator for active pipeline (DETAIL-05)", () => {
    mockUsePipeline.mockReturnValue({
      data: mockActivePipeline,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof usePipeline>);

    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    expect(screen.getByText("Auto-refreshing every 5s")).toBeInTheDocument();
  });

  it("hides auto-refresh indicator for completed pipeline (DETAIL-05)", () => {
    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    expect(screen.queryByText("Auto-refreshing every 5s")).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    mockUsePipeline.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof usePipeline>);

    const { container } = renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows error state", () => {
    mockUsePipeline.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Not found"),
    } as unknown as ReturnType<typeof usePipeline>);

    renderWithProviders(<PipelineDetailPage />, {
      initialEntries: ["/dashboard/pipelines/job-test-1234"],
    });
    expect(screen.getByText(/Failed to load pipeline/)).toBeInTheDocument();
    expect(screen.getByText(/Not found/)).toBeInTheDocument();
  });
});
