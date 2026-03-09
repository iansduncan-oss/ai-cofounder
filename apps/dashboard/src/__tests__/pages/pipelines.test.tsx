import { screen, fireEvent } from "@testing-library/react";
import { PipelinesPage } from "@/routes/pipelines";
import { renderWithProviders } from "../test-utils";

vi.mock("@/api/queries", () => ({
  useListPipelines: vi.fn(),
  usePipeline: vi.fn(),
}));

const mockGoalMutate = vi.fn();
const mockCustomMutate = vi.fn();

vi.mock("@/api/mutations", () => ({
  useSubmitGoalPipeline: vi.fn(() => ({
    mutate: mockGoalMutate,
    isPending: false,
  })),
  useSubmitPipeline: vi.fn(() => ({
    mutate: mockCustomMutate,
    isPending: false,
  })),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router")>();
  return {
    ...mod,
    useNavigate: () => mockNavigate,
  };
});

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
    mockGoalMutate.mockReset();
    mockCustomMutate.mockReset();
    mockNavigate.mockReset();
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

describe("Pipeline Trigger", () => {
  beforeEach(() => {
    mockGoalMutate.mockReset();
    mockCustomMutate.mockReset();
    mockNavigate.mockReset();
    mockUseListPipelines.mockReturnValue({
      data: { runs: mockPipelineRuns },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useListPipelines>);
  });

  // TRIGGER-01: Goal-based pipeline form renders and submits
  it("TRIGGER-01: opens dialog in goal mode and submits goal pipeline", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));

    // Dialog is open with goal mode active by default
    expect(screen.getAllByText("Run Pipeline").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /goal pipeline/i })).toBeInTheDocument();

    // Fill in goal ID
    const goalIdInput = screen.getByPlaceholderText(/550e8400/);
    fireEvent.change(goalIdInput, {
      target: { value: "550e8400-e29b-41d4-a716-446655440000" },
    });

    // Submit the form
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    // Assert mutation was called with correct goalId
    expect(mockGoalMutate).toHaveBeenCalledWith(
      { goalId: "550e8400-e29b-41d4-a716-446655440000" },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  // TRIGGER-02: Custom pipeline builder renders, add/remove stages, submits
  it("TRIGGER-02: switches to custom mode and submits pipeline with stages", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));

    // Switch to custom mode
    fireEvent.click(screen.getByRole("button", { name: /custom pipeline/i }));

    // Verify default stage row appears with a role select
    const selects = screen.getAllByRole("combobox");
    // First select should be for stage agent role (planner by default)
    expect(selects.some((s) => (s as HTMLSelectElement).value === "planner")).toBe(true);

    // Click Add Stage
    fireEvent.click(screen.getByRole("button", { name: /add stage/i }));

    // Two stage selects should now exist for agent roles
    const allSelects = screen.getAllByRole("combobox");
    const stageSelects = allSelects.filter((s) =>
      ["planner", "coder", "reviewer", "debugger", "researcher"].includes((s as HTMLSelectElement).value),
    );
    expect(stageSelects.length).toBe(2);

    // Change second stage agent to reviewer
    fireEvent.change(stageSelects[1], { target: { value: "reviewer" } });

    // Add prompt to second stage
    const textareas = screen.getAllByPlaceholderText(/instructions for this stage/i);
    fireEvent.change(textareas[1], { target: { value: "Review the code" } });

    // Fill in the goal ID
    const goalIdInput = screen.getByPlaceholderText(/550e8400/);
    fireEvent.change(goalIdInput, {
      target: { value: "test-goal-uuid-1234" },
    });

    // Submit
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    // Assert custom mutation was called with stages
    expect(mockCustomMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        goalId: "test-goal-uuid-1234",
        stages: expect.arrayContaining([
          expect.objectContaining({ agent: "reviewer", prompt: "Review the code" }),
        ]),
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );

    // Verify 2 stages were submitted
    const callArgs = mockCustomMutate.mock.calls[0][0];
    expect(callArgs.stages).toHaveLength(2);
  });

  // TRIGGER-02b: Remove stage enforces minimum 1
  it("TRIGGER-02b: remove stage works and enforces minimum of 1 stage", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog and switch to custom mode
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    fireEvent.click(screen.getByRole("button", { name: /custom pipeline/i }));

    // Add a second stage
    fireEvent.click(screen.getByRole("button", { name: /add stage/i }));

    // Verify 2 remove buttons exist
    const removeButtons = screen.getAllByRole("button", { name: /remove stage/i });
    expect(removeButtons.length).toBe(2);

    // Click one remove button
    fireEvent.click(removeButtons[1]);

    // Only 1 stage row should remain
    const remainingRemoveButtons = screen.getAllByRole("button", { name: /remove stage/i });
    expect(remainingRemoveButtons.length).toBe(1);

    // The remaining remove button should be disabled
    expect(remainingRemoveButtons[0]).toBeDisabled();
  });

  // TRIGGER-03: onSuccess callback is wired from mutate call
  it("TRIGGER-03: onSuccess callback is wired in goal pipeline mutate call", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog, fill goal ID, submit
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    const goalIdInput = screen.getByPlaceholderText(/550e8400/);
    fireEvent.change(goalIdInput, { target: { value: "test-job-goal" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    // Capture onSuccess callback
    const onSuccess = mockGoalMutate.mock.calls[0][1].onSuccess;
    expect(onSuccess).toBeInstanceOf(Function);

    // Invoke onSuccess with mock data
    onSuccess({ jobId: "test-job-123", status: "waiting", stageCount: 3 });

    // Navigate should have been called (proves onSuccess is wired)
    expect(mockNavigate).toHaveBeenCalled();
  });

  // TRIGGER-04: Navigate called with correct path on success (goal mode)
  it("TRIGGER-04: navigate called with /dashboard/pipelines/:jobId after goal submission", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog, fill goal ID, submit
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    const goalIdInput = screen.getByPlaceholderText(/550e8400/);
    fireEvent.change(goalIdInput, { target: { value: "any-goal-id" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    // Extract and invoke onSuccess
    const onSuccess = mockGoalMutate.mock.calls[0][1].onSuccess;
    onSuccess({ jobId: "new-job-abc", status: "waiting", stageCount: 3 });

    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/pipelines/new-job-abc");
  });

  // TRIGGER-04b: Navigate works for custom pipeline too
  it("TRIGGER-04b: navigate called with /dashboard/pipelines/:jobId after custom submission", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog, switch to custom mode, fill goal ID, submit
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    fireEvent.click(screen.getByRole("button", { name: /custom pipeline/i }));
    const goalIdInput = screen.getByPlaceholderText(/550e8400/);
    fireEvent.change(goalIdInput, { target: { value: "any-goal-id" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    // Extract and invoke onSuccess
    const onSuccess = mockCustomMutate.mock.calls[0][1].onSuccess;
    onSuccess({ jobId: "custom-job-xyz", status: "waiting", stageCount: 2 });

    expect(mockNavigate).toHaveBeenCalledWith("/dashboard/pipelines/custom-job-xyz");
  });

  // Dialog resets on close
  it("dialog resets goal ID when closed and reopened", () => {
    renderWithProviders(<PipelinesPage />, {
      initialEntries: ["/dashboard/pipelines"],
    });

    // Open dialog, type a Goal ID
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));
    const goalIdInput = screen.getByPlaceholderText(/550e8400/);
    fireEvent.change(goalIdInput, { target: { value: "my-goal-id" } });
    expect(goalIdInput).toHaveValue("my-goal-id");

    // Close dialog via Cancel button
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    // Reopen dialog
    fireEvent.click(screen.getByRole("button", { name: /run pipeline/i }));

    // Goal ID input should be reset
    const reopenedInput = screen.getByPlaceholderText(/550e8400/);
    expect(reopenedInput).toHaveValue("");
  });
});
