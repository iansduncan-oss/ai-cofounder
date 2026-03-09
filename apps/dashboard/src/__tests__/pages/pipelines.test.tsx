import { screen } from "@testing-library/react";
import { PipelinesPage } from "@/routes/pipelines";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useListPipelines: vi.fn(),
  usePipeline: vi.fn(),
}));

vi.mock("@/api/mutations", () => ({
  useSubmitGoalPipeline: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

import { useListPipelines } from "@/api/queries";

const mockUseListPipelines = vi.mocked(useListPipelines);

const mockPipelineRuns = [
  {
    jobId: "job-completed-1234",
    pipelineId: "pipe-completed-abcdef12",
    goalId: "goal-completed-abcdef12",
    stageCount: 3,
    state: "completed" as const,
    createdAt: "2026-03-09T10:00:00Z",
    finishedAt: "2026-03-09T10:05:30Z",
    failedReason: null,
    result: null,
  },
  {
    jobId: "job-active-5678",
    pipelineId: "pipe-active-abcdef12",
    goalId: "goal-active-abcdef12",
    stageCount: 3,
    state: "active" as const,
    createdAt: "2026-03-09T11:00:00Z",
    finishedAt: null,
    failedReason: null,
    result: null,
  },
  {
    jobId: "job-failed-9012",
    pipelineId: "pipe-failed-abcdef12",
    goalId: "goal-failed-abcdef12",
    stageCount: 3,
    state: "failed" as const,
    createdAt: "2026-03-09T09:00:00Z",
    finishedAt: "2026-03-09T09:01:00Z",
    failedReason: "Stage 2 timed out",
    result: null,
  },
];

describe("PipelinesPage", () => {
  beforeEach(() => {
    mockUseListPipelines.mockReturnValue({
      data: { runs: mockPipelineRuns },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useListPipelines>);
  });

  it("renders the Pipelines page title", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    expect(screen.getByText("Pipelines")).toBeInTheDocument();
  });

  it("shows pipeline runs when loaded", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    // Each row shows first 8 chars of pipelineId
    expect(screen.getByText("Pipeline pipe-com")).toBeInTheDocument();
    expect(screen.getByText("Pipeline pipe-act")).toBeInTheDocument();
    expect(screen.getByText("Pipeline pipe-fai")).toBeInTheDocument();
  });

  it("displays state badges for each run", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    // Use getAllByText since "Completed" may appear in both select options and badges
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Failed").length).toBeGreaterThanOrEqual(1);
  });

  it("shows stage count for each run", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    const stageTexts = screen.getAllByText(/3 stages/);
    expect(stageTexts.length).toBeGreaterThanOrEqual(3);
  });

  it("renders pipeline rows as links to detail page", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    const links = screen.getAllByRole("link");
    // Filter links that go to pipeline detail pages
    const pipelineLinks = links.filter((link) =>
      link.getAttribute("href")?.includes("/dashboard/pipelines/"),
    );
    expect(pipelineLinks.length).toBe(3);
    expect(pipelineLinks[0].getAttribute("href")).toContain(
      "/dashboard/pipelines/job-completed-1234",
    );
  });

  it("shows loading skeleton when loading", () => {
    mockUseListPipelines.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useListPipelines>);

    const { container } = renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });

  it("shows error state on failure", () => {
    mockUseListPipelines.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Network error"),
    } as unknown as ReturnType<typeof useListPipelines>);

    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    expect(screen.getByText(/Failed to load pipelines/)).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it("shows empty state when no runs", () => {
    mockUseListPipelines.mockReturnValue({
      data: { runs: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useListPipelines>);

    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    expect(screen.getByText("No pipeline runs")).toBeInTheDocument();
  });

  it("filters runs by state when filter is applied", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines?state=completed"],
    });
    // Only the completed run should show
    expect(screen.getByText("Pipeline pipe-com")).toBeInTheDocument();
    expect(screen.queryByText("Pipeline pipe-act")).not.toBeInTheDocument();
    expect(screen.queryByText("Pipeline pipe-fai")).not.toBeInTheDocument();
  });

  it("shows auto-refresh indicator", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });
    expect(screen.getByText("Auto-refreshing every 10s")).toBeInTheDocument();
  });
});
