import { screen } from "@testing-library/react";
import { AutonomousSessionsPage } from "@/routes/autonomous-sessions";
import { renderWithProviders } from "./test-utils";
import type { WorkSession } from "@ai-cofounder/api-client";

vi.mock("@/api/client", () => ({
  apiClient: {
    listAutonomousSessions: vi.fn().mockResolvedValue({ data: [], count: 0 }),
  },
}));

function makeSession(overrides: Partial<WorkSession>): WorkSession {
  return {
    id: "sess-1",
    trigger: "manual",
    scheduleId: null,
    eventId: null,
    goalId: null,
    status: "completed",
    tokensUsed: 1500,
    durationMs: 90_000,
    actionsTaken: null,
    summary: "Completed a set of tasks successfully.",
    context: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("AutonomousSessionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Autonomous Sessions heading", async () => {
    const { apiClient } = await import("@/api/client");
    vi.mocked(apiClient.listAutonomousSessions).mockResolvedValue({
      data: [],
      count: 0,
    });

    renderWithProviders(<AutonomousSessionsPage />);

    expect(screen.getByText("Autonomous Sessions")).toBeInTheDocument();
  });

  it("shows empty state when no sessions", async () => {
    const { apiClient } = await import("@/api/client");
    vi.mocked(apiClient.listAutonomousSessions).mockResolvedValue({
      data: [],
      count: 0,
    });

    renderWithProviders(<AutonomousSessionsPage />);

    await screen.findByText("No sessions yet");
  });

  it("displays status badges for completed and failed sessions", async () => {
    const { apiClient } = await import("@/api/client");
    const sessions: WorkSession[] = [
      makeSession({
        id: "sess-1",
        status: "completed",
        summary: "Session one summary",
        tokensUsed: 2000,
        durationMs: 120_000,
      }),
      makeSession({
        id: "sess-2",
        status: "failed",
        summary: "Session two failed",
        tokensUsed: 500,
        durationMs: 15_000,
      }),
    ];
    vi.mocked(apiClient.listAutonomousSessions).mockResolvedValue({
      data: sessions,
      count: 2,
    });

    renderWithProviders(<AutonomousSessionsPage />);

    await screen.findByText("Session one summary");

    const badges = screen.getAllByTestId("status-badge");
    expect(badges.length).toBe(2);
    expect(badges[0]).toHaveTextContent("Completed");
    expect(badges[1]).toHaveTextContent("Failed");
  });

  it("formats duration correctly", async () => {
    const { apiClient } = await import("@/api/client");
    const sessions: WorkSession[] = [
      makeSession({
        id: "sess-1",
        status: "completed",
        summary: "Duration test",
        durationMs: 150_000, // 2m 30s
        tokensUsed: 100,
      }),
    ];
    vi.mocked(apiClient.listAutonomousSessions).mockResolvedValue({
      data: sessions,
      count: 1,
    });

    renderWithProviders(<AutonomousSessionsPage />);

    await screen.findByText("Duration test");
    expect(screen.getByText("2m 30s")).toBeInTheDocument();
  });

  it("displays summary text for each session", async () => {
    const { apiClient } = await import("@/api/client");
    const sessions: WorkSession[] = [
      makeSession({
        id: "sess-1",
        status: "completed",
        summary: "This is a meaningful summary of work done.",
        durationMs: 60_000,
        tokensUsed: 300,
      }),
    ];
    vi.mocked(apiClient.listAutonomousSessions).mockResolvedValue({
      data: sessions,
      count: 1,
    });

    renderWithProviders(<AutonomousSessionsPage />);

    await screen.findByText("This is a meaningful summary of work done.");
  });

  it("renders a link to the goal when goalId is present", async () => {
    const { apiClient } = await import("@/api/client");
    const sessions: WorkSession[] = [
      makeSession({
        id: "sess-1",
        status: "completed",
        summary: "Session with goal",
        goalId: "goal-abc-123",
        durationMs: 60_000,
        tokensUsed: 500,
      }),
    ];
    vi.mocked(apiClient.listAutonomousSessions).mockResolvedValue({
      data: sessions,
      count: 1,
    });

    renderWithProviders(<AutonomousSessionsPage />);

    await screen.findByText("Session with goal");
    const link = screen.getByRole("link", { name: /view goal/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/dashboard/goals/goal-abc-123");
  });
});
